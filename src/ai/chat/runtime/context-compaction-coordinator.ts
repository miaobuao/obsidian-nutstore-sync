import type { ModelMessage, ToolSet } from 'ai'
import type { ChatSession } from '~/ai/chat/domain'
import type { MessageFactory } from '~/ai/chat/messages/message-factory'
import {
	commitContextCompression,
	createContextCompressionPlan,
	generateContextCompression,
	shouldAutoCompressAgent,
	shouldStartContextCompaction,
	type ContextCompressionPlan,
} from '~/ai/chat/runtime/context-compression'
import type { SessionStore } from '~/ai/chat/session/session-store'
import type { AppUIMessage, ChatAgentState } from '~/ai/chat/types'
import type { AIModelConfig, AIProviderConfig } from '~/ai/core/types'

export interface ContextCompactionRequest {
	session: ChatSession
	agent: ChatAgentState
	provider: AIProviderConfig
	model: AIModelConfig
	ensureProviderReady?: () => Promise<void>
	resolveSummaryContext: () => Promise<{ system?: string; tools?: ToolSet }>
	buildMessages?: (
		messages: AppUIMessage[],
		tools: ToolSet,
	) => Promise<ModelMessage[]>
	isCancelled: () => boolean
	/** Immutable identity of the model, prompt, and tool configuration. */
	revision: string
	/** Reject a result when the model, system prompt, or session has changed. */
	isCurrent?: () => boolean
}

type ContextCompactionJob = {
	sessionId: string
	agentId: string
	state: 'generating' | 'ready' | 'failed' | 'stale'
	controller: AbortController
	completion: Promise<void>
	revision: string
	plan?: ContextCompressionPlan
	summary?: string
}

export type ContextCompactionCommitResult =
	| 'committed'
	| 'pending'
	| 'unavailable'
	| 'failed'
	| 'stale'

export function createContextCompactionRevision(
	session: ChatSession,
	provider: AIProviderConfig,
	model: AIModelConfig,
) {
	return JSON.stringify({
		providerId: provider.id,
		modelId: model.id,
		systemPrompt: session.systemPrompt ?? null,
		disabledMcpServers: session.disabledMcpServers ?? [],
	})
}

/**
 * Owns one optimistic, snapshot-based compaction job for each agent. The
 * caller only observes at safe points; this module never mutates a live
 * timeline from a background promise.
 */
export class ContextCompactionCoordinator {
	private jobs = new Map<string, ContextCompactionJob>()

	constructor(
		private store: SessionStore,
		private messageFactory: MessageFactory,
	) {}

	startIfNeeded(request: ContextCompactionRequest) {
		if (!shouldStartContextCompaction(request.agent, request.model)) {
			return false
		}
		const key = this.keyFor(request)
		const existing = this.jobs.get(key)
		if (existing && existing.revision !== request.revision) {
			existing.controller.abort()
			this.jobs.delete(key)
		}
		const current = this.jobs.get(key)
		if (current) return false

		const controller = new AbortController()
		const job: ContextCompactionJob = {
			sessionId: request.session.id,
			agentId: request.agent.id,
			state: 'generating',
			controller,
			completion: Promise.resolve(),
			revision: request.revision,
		}
		job.completion = this.generate(request, job)
		this.jobs.set(key, job)
		return true
	}

	hasJob(request: ContextCompactionRequest) {
		return this.jobs.has(this.keyFor(request))
	}

	/** Commit an already-generated summary without waiting for remote work. */
	async commitReady(
		request: ContextCompactionRequest,
	): Promise<ContextCompactionCommitResult> {
		const key = this.keyFor(request)
		const job = this.jobs.get(key)
		if (job?.state === 'failed' || job?.state === 'stale') {
			this.jobs.delete(key)
			return job.state
		}
		if (!job) return 'unavailable'
		if (job.state !== 'ready') return 'pending'
		if (!job.plan || !job.summary) {
			this.jobs.delete(key)
			return 'failed'
		}
		this.jobs.delete(key)
		if (job.revision !== request.revision || !this.isCurrent(request)) {
			return 'stale'
		}
		const committed = await commitContextCompression({
			session: request.session,
			agent: request.agent,
			plan: job.plan,
			summary: job.summary,
			store: this.store,
			messageFactory: this.messageFactory,
		})
		return committed ? 'committed' : 'stale'
	}

	/**
	 * Used only at the hard water mark. It waits for the already-started job,
	 * then commits if its snapshot is still current.
	 */
	async waitAndCommit(
		request: ContextCompactionRequest,
	): Promise<ContextCompactionCommitResult> {
		this.startIfNeeded(request)
		const job = this.jobs.get(this.keyFor(request))
		if (!job) return 'unavailable'
		await job.completion
		return this.commitReady(request)
	}

	/** A tool loop must rebuild its prompt when a result is ready or pressure is hard. */
	shouldSuspendAtSafePoint(request: ContextCompactionRequest) {
		this.startIfNeeded(request)
		const job = this.jobs.get(this.keyFor(request))
		return (
			job?.state === 'ready' ||
			shouldAutoCompressAgent(request.agent, request.model)
		)
	}

	cancel(sessionId: string, agentId?: string) {
		for (const [key, job] of this.jobs) {
			if (job.sessionId !== sessionId) continue
			if (agentId && job.agentId !== agentId) continue
			job.controller.abort()
			this.jobs.delete(key)
		}
	}

	private async generate(
		request: ContextCompactionRequest,
		job: ContextCompactionJob,
	) {
		try {
			// createContextCompressionPlan captures the selected context before its
			// first await, so later appended turns are outside this snapshot.
			const plan = await createContextCompressionPlan(
				request.agent,
				request.model,
			)
			if (!plan || !this.isCurrent(request)) {
				job.state = 'stale'
				return
			}
			job.plan = plan
			await request.ensureProviderReady?.()
			if (!this.isCurrent(request)) {
				job.state = 'stale'
				return
			}
			const summaryContext = await request.resolveSummaryContext()
			const summary = await generateContextCompression({
				provider: request.provider,
				model: request.model,
				session: request.session,
				plan,
				...summaryContext,
				buildMessages: request.buildMessages,
				isCancelled: () => !this.isCurrent(request),
				abortSignal: job.controller.signal,
			})
			if (!this.isCurrent(request)) {
				job.state = 'stale'
				return
			}
			if (!summary) {
				job.state = 'failed'
				return
			}
			job.summary = summary
			job.state = 'ready'
		} catch {
			job.state = request.isCancelled() ? 'stale' : 'failed'
		}
	}

	private isCurrent(request: ContextCompactionRequest) {
		return !request.isCancelled() && (request.isCurrent?.() ?? true)
	}

	private keyFor(request: Pick<ContextCompactionRequest, 'session' | 'agent'>) {
		return `${request.session.id}:${request.agent.id}`
	}
}
