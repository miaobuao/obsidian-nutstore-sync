import type { App } from 'obsidian'

import {
	findAgent,
	findParentAgent,
	getAgentDepth,
} from '~/ai/chat/agents/agent-tree'
import { MASTER_AGENT_ID } from '~/ai/chat/agents/registry'
import type { ChatSession } from '~/ai/chat/domain'
import {
	getMasterAgent,
	getSessionSubagents,
	isTerminalAgent,
} from '~/ai/chat/domain'
import { extractErrorMessage } from '~/ai/chat/error-utils'
import {
	ContextCompressionFailedError,
	runContextCompression,
	shouldAutoCompressAgent,
} from '~/ai/chat/runtime/context-compression'
import {
	ContextCompactionCoordinator,
	createContextCompactionRevision,
	type ContextCompactionRequest,
} from '~/ai/chat/runtime/context-compaction-coordinator'
import {
	type AgentRunResult,
	AgentRunner,
} from '~/ai/chat/runtime/agent-runner'
import { MAX_CONCURRENT_TASKS_PER_SESSION } from '~/ai/chat/prompts'
import type { ChatState } from '~/ai/chat/runtime/chat-state'
import type { Selection } from '~/ai/chat/runtime/selection'
import type { ToolExecutor } from '~/ai/chat/runtime/tool-executor'
import type { SessionStore } from '~/ai/chat/session/session-store'
import type { ChatAgentState } from '~/ai/chat/types'
import type { AIModelConfig, AIProviderConfig } from '~/ai/core/types'
import type { ToolCallRepeatState } from '~/ai/core/tool-call-repeat'
import { BASH_TMP_MOUNT_POINT } from '~/ai/tools/bash/mount-points'
import { writeBashTmpText } from '~/ai/tools/bash/tmp-fs'
import { consumePendingInputs } from '~/ai/chat/messages/ui-message'
import i18n from '~/i18n'
import createId, { createUniqueWordId } from '~/utils/create-id'
import type { DispatchTaskParams, DispatchTaskResult } from '~/ai/tools/task'

export class TaskManager {
	private wakeAgent: (sessionId: string, agentId: string) => void = () => {}

	constructor(
		private app: App,
		private ensureProviderReady: (provider: AIProviderConfig) => Promise<void>,
		private state: ChatState,
		private selection: Selection,
		private store: SessionStore,
		private notify: () => void,
		private toolExecutor: ToolExecutor,
		private messageFactory: import('~/ai/chat/messages/message-factory').MessageFactory,
		private agentRunner: AgentRunner,
		compactionCoordinator?: ContextCompactionCoordinator,
	) {
		this.compactionCoordinator =
			compactionCoordinator ??
			new ContextCompactionCoordinator(this.store, this.messageFactory)
	}

	private readonly compactionCoordinator: ContextCompactionCoordinator

	setWakeAgentHandler(handler: (sessionId: string, agentId: string) => void) {
		this.wakeAgent = handler
	}

	async runAgent(session: ChatSession, agent: ChatAgentState) {
		const selectedModel = this.state.taskModelSelection.get(agent.id)
		if (!selectedModel?.providerId || !selectedModel.modelId) {
			await this.finishAgentAsFailed(
				session,
				agent,
				i18n.t('chatbox.errors.taskSessionUnavailable'),
			)
			return
		}

		agent.status = 'running'
		agent.startedAt ??= Date.now()
		try {
			const provider = this.selection.getProviderByIdOrThrow(
				selectedModel.providerId,
			)
			await this.ensureProviderReady(provider)
			const model = this.selection.getModelByIdsOrThrow(
				provider,
				selectedModel.modelId,
			)
			let result: AgentRunResult
			let continuation: ToolCallRepeatState | undefined
			do {
				result = await this.runBackgroundTaskLoop(
					agent,
					session,
					provider,
					model,
					continuation,
				)
				continuation =
					result.status === 'suspended' ? result.continuation : undefined
			} while (result.status === 'suspended')

			if (result.status === 'cancelled') {
				await this.finishAgentAsCancelled(session, agent)
				return
			}
			if (result.status === 'failed') {
				await this.finishAgentAsFailed(session, agent, result.error)
				return
			}
			if (agent.pendingInputs.length > 0) {
				void this.store.persistSession(session)
				void this.runAgent(session, agent)
				return
			}
			if (this.hasActiveChildAgents(agent)) {
				agent.status = 'idle'
				void this.store.persistSession(session)
				this.notify()
				return
			}

			await this.finishAgentAsCompleted(session, agent, result.text)
		} catch (error) {
			await this.finishAgentAsFailed(
				session,
				agent,
				extractErrorMessage(error, i18n.t('chatbox.requestFailed')),
			)
		}
	}

	private async runBackgroundTaskLoop(
		agent: ChatAgentState,
		session: ChatSession,
		provider: AIProviderConfig,
		model: AIModelConfig,
		continuation?: ToolCallRepeatState,
	): Promise<AgentRunResult> {
		consumePendingInputs(agent)

		const isCancelled = () =>
			agent.status === 'cancelled' ||
			this.state.deletedSessionIds.has(session.id)
		if (isCancelled()) return { status: 'cancelled' }
		const compactionRequest = this.createCompactionRequest(
			session,
			agent,
			provider,
			model,
			isCancelled,
		)
		this.compactionCoordinator.startIfNeeded(compactionRequest)
		if (this.compactionCoordinator.hasJob(compactionRequest)) {
			const compactionResult =
				await this.compactionCoordinator.commitReady(compactionRequest)
			if (compactionResult === 'committed') {
				return this.runBackgroundTaskLoop(
					agent,
					session,
					provider,
					model,
					continuation,
				)
			}
			if (compactionResult === 'failed') {
				throw new ContextCompressionFailedError(
					i18n.t('chatbox.errors.contextCompressionFailed'),
				)
			}
		}

		if (
			shouldAutoCompressAgent(agent, model, session.inferenceParams?.maxTokens)
		) {
			const compactionResult =
				await this.compactionCoordinator.waitAndCommit(compactionRequest)
			if (compactionResult === 'failed' || compactionResult === 'stale') {
				throw new ContextCompressionFailedError(
					i18n.t('chatbox.errors.contextCompressionFailed'),
				)
			}
			if (compactionResult !== 'committed') {
				const fallbackResult = await runContextCompression({
					provider,
					model,
					session,
					agent,
					store: this.store,
					messageFactory: this.messageFactory,
					...(await this.agentRunner.resolveSummaryContext(
						agent,
						session,
						model,
					)),
					isCancelled,
				})
				if (fallbackResult !== 'committed' && fallbackResult !== 'cancelled') {
					throw new ContextCompressionFailedError(
						i18n.t('chatbox.errors.contextCompressionFailed'),
					)
				}
			}
		}

		return this.agentRunner.runTurn({
			session,
			agent,
			provider,
			model,
			depth: getAgentDepth(getMasterAgent(session), agent.id),
			assistantMeta: {
				providerId: provider.id,
				providerName: provider.name,
				modelId: model.id,
				modelName: model.name,
			},
			isCancelled,
			isDeleted: () => this.state.deletedSessionIds.has(session.id),
			continuation,
			shouldSuspendAfterToolStep: () =>
				isCancelled() ||
				this.compactionCoordinator.shouldSuspendAtSafePoint(compactionRequest),
		})
	}

	private createCompactionRequest(
		session: ChatSession,
		agent: ChatAgentState,
		provider: AIProviderConfig,
		model: AIModelConfig,
		isCancelled: () => boolean,
	): ContextCompactionRequest {
		const selectedModel = this.state.taskModelSelection.get(agent.id)
		// Capture primitive ids at request creation. The selection object can be
		// mutated in place when settings change; retaining the object reference
		// would make the stale-job check observe the new values as if they were
		// the original configuration.
		const selectedProviderId = selectedModel?.providerId
		const selectedModelId = selectedModel?.modelId
		const revision = createContextCompactionRevision(session, provider, model)
		return {
			session,
			agent,
			provider,
			model,
			revision,
			ensureProviderReady: () => this.ensureProviderReady(provider),
			resolveSummaryContext: () =>
				this.agentRunner.resolveSummaryContext(agent, session, model),
			isCancelled,
			isCurrent: () => {
				const currentSelection = this.state.taskModelSelection.get(agent.id)
				return (
					currentSelection?.providerId === selectedProviderId &&
					currentSelection?.modelId === selectedModelId &&
					createContextCompactionRevision(session, provider, model) === revision
				)
			},
		}
	}

	async dispatchTask(params: DispatchTaskParams): Promise<DispatchTaskResult> {
		const session = this.state.loadedSessions.get(params.sessionId)
		if (!session) throw new Error(i18n.t('chatbox.errors.sessionNotFound'))
		const parent = findAgent(getMasterAgent(session), params.callerAgentId)
		if (!parent) {
			throw new Error(`Caller agent not found: ${params.callerAgentId}`)
		}
		const definition = this.toolExecutor.getAgentDefinition(params.subagentType)
		if (!definition.dispatchable) {
			throw new Error(
				i18n.t('chatbox.errors.agentNotDispatchable', {
					agentType: params.subagentType,
				}),
			)
		}

		const shouldQueue =
			this.countRunningAgentsForSession(session) >=
			MAX_CONCURRENT_TASKS_PER_SESSION
		const now = Date.now()
		const agentId = await this.createAgentId(session, definition.id)
		const agent: ChatAgentState = {
			id: agentId,
			type: definition.id,
			status: shouldQueue ? 'queued' : 'running',
			createdAt: now,
			startedAt: shouldQueue ? undefined : now,
			timeline: [
				{
					id: createId('message'),
					role: 'user',
					metadata: {
						createdAt: now,
					},
					parts: [{ type: 'text', text: params.prompt }],
				},
			],
			pendingInputs: [],
			operations: {},
			toolTimings: {},
			subagents: {},
		}
		parent.subagents[agent.id] = agent
		this.state.taskModelSelection.set(agent.id, session.model)
		void this.store.persistSession(session)
		this.notify()
		if (shouldQueue) this.startQueuedAgentsForSession(session)
		else void this.runAgent(session, agent)

		return {
			taskId: agent.id,
			subagentType: definition.id,
			status: 'dispatched',
		}
	}

	private async createAgentId(session: ChatSession, agentType: string) {
		return createUniqueWordId(agentType, (id) =>
			Boolean(findAgent(getMasterAgent(session), id)),
		)
	}

	private async afterAgentSettled(
		session: ChatSession,
		agent: ChatAgentState,
		resultPath: string,
	) {
		this.compactionCoordinator.cancel(session.id, agent.id)
		const master = getMasterAgent(session)
		const parent = findParentAgent(master, agent.id) ?? master
		parent.pendingInputs.push({
			id: createId('input'),
			role: 'user',
			metadata: { createdAt: Date.now() },
			parts: [
				{
					type: 'data-system-notification',
					data: {
						kind: 'task-result-ready',
						taskId: agent.id,
						resultPath,
					},
				},
			],
		})
		await this.store.persistSession(session)
		if (parent.id === MASTER_AGENT_ID) {
			this.wakeAgent(session.id, parent.id)
		} else this.wakeSubagent(session, parent.id)
		this.cleanupAgentTracking(agent.id)
		this.startQueuedAgentsForSession(session)
		this.notify()
	}

	private async persistAgentResult(
		session: ChatSession,
		agent: ChatAgentState,
		resultText: string,
	) {
		const resultPath = `${BASH_TMP_MOUNT_POINT}/${session.id}/tasks/${agent.id}.txt`
		await writeBashTmpText(this.app, resultPath, resultText)
		return resultPath
	}

	private wakeSubagent(session: ChatSession, agentId: string) {
		const agent = findAgent(getMasterAgent(session), agentId)
		if (!agent || agent.status === 'running' || isTerminalAgent(agent)) return
		agent.status = 'running'
		agent.startedAt ??= Date.now()
		void this.store.persistSession(session)
		void this.runAgent(session, agent)
	}

	private hasActiveChildAgents(agent: ChatAgentState) {
		return Object.values(agent.subagents).some(
			(child) => !isTerminalAgent(child),
		)
	}

	async finishAgentAsCompleted(
		session: ChatSession,
		agent: ChatAgentState,
		summary: string,
	) {
		if (agent.status !== 'running') return
		const text = summary || i18n.t('chatbox.task.emptyResult')
		const resultPath = await this.persistAgentResult(session, agent, text)
		agent.status = 'completed'
		agent.finishedAt = Date.now()
		await this.afterAgentSettled(session, agent, resultPath)
	}

	async finishAgentAsFailed(
		session: ChatSession,
		agent: ChatAgentState,
		message: string,
	) {
		if (agent.status !== 'queued' && agent.status !== 'running') return
		const resultPath = await this.persistAgentResult(session, agent, message)
		agent.status = 'failed'
		agent.finishedAt = Date.now()
		await this.afterAgentSettled(session, agent, resultPath)
	}

	async finishAgentAsCancelled(session: ChatSession, agent: ChatAgentState) {
		if (agent.status !== 'queued' && agent.status !== 'running') return
		const text = i18n.t('chatbox.task.cancelledSummary', { task: agent.id })
		const resultPath = await this.persistAgentResult(session, agent, text)
		agent.status = 'cancelled'
		agent.finishedAt = Date.now()
		await this.afterAgentSettled(session, agent, resultPath)
	}

	countRunningAgentsForSession(session: ChatSession) {
		return getSessionSubagents(session).filter(
			(agent) => agent.status === 'running',
		).length
	}

	startQueuedAgentsForSession(session: ChatSession) {
		if (this.state.deletedSessionIds.has(session.id)) return
		while (
			this.countRunningAgentsForSession(session) <
			MAX_CONCURRENT_TASKS_PER_SESSION
		) {
			const nextAgent = getSessionSubagents(session)
				.filter((agent) => agent.status === 'queued')
				.sort((left, right) => left.createdAt - right.createdAt)[0]
			if (!nextAgent) return
			nextAgent.status = 'running'
			nextAgent.startedAt ??= Date.now()
			void this.store.persistSession(session)
			this.notify()
			void this.runAgent(session, nextAgent)
		}
	}

	cancelAllNonTerminalAgents(session: ChatSession) {
		let changed = false
		for (const agent of getSessionSubagents(session)) {
			if (isTerminalAgent(agent)) continue
			agent.status = 'cancelled'
			agent.finishedAt = Date.now()
			this.cleanupAgentTracking(agent.id)
			changed = true
		}
		return changed
	}

	cleanupSessionAgentTracking(session: ChatSession) {
		for (const agent of getSessionSubagents(session))
			this.cleanupAgentTracking(agent.id)
	}

	private cleanupAgentTracking(agentId: string) {
		this.state.taskModelSelection.delete(agentId)
	}
}
