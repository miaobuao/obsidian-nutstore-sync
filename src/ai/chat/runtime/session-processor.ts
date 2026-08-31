import type { ModelMessage, ToolSet } from 'ai'
import type { ChatSession } from '~/ai/chat/domain'

import type { ChatAgentState } from '~/ai/chat/types'
import type {
	ChatState,
	SessionRuntimeState,
} from '~/ai/chat/runtime/chat-state'
import { extractErrorMessage } from '~/ai/chat/error-utils'
import { deriveTitle } from '~/ai/chat/messages/message-utils'
import type { MessageFactory } from '~/ai/chat/messages/message-factory'
import type { RuntimeStates } from '~/ai/chat/runtime/runtime-state'
import type { Selection } from '~/ai/chat/runtime/selection'
import type { SessionStore } from '~/ai/chat/session/session-store'
import type { UserContextManager } from '~/ai/chat/context/user-context-manager'
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
import { hasQueuedSubmission } from '~/ai/chat/runtime/pending-submission'
import { isAbortError } from '~/ai/transport/abort'
import i18n from '~/i18n'
import type { ToolCallRepeatState } from '~/ai/core/tool-call-repeat'
import type { AIModelConfig, AIProviderConfig } from '~/ai/core/types'
import { AgentRunner } from '~/ai/chat/runtime/agent-runner'
import {
	buildAgentMessages,
	consumePendingInputs,
} from '~/ai/chat/messages/ui-message'

export class SessionProcessor {
	constructor(
		private ensureProviderReady: (provider: AIProviderConfig) => Promise<void>,
		private state: ChatState,
		private runtimeStates: RuntimeStates,
		private store: SessionStore,
		private notify: () => void,
		private selection: Selection,
		private messageFactory: MessageFactory,
		private userContextManager: UserContextManager,
		private agentRunner: AgentRunner,
		compactionCoordinator?: ContextCompactionCoordinator,
	) {
		this.compactionCoordinator =
			compactionCoordinator ??
			new ContextCompactionCoordinator(this.store, this.messageFactory)
	}

	private readonly compactionCoordinator: ContextCompactionCoordinator

	async start(sessionId: string) {
		const runtime = this.runtimeStates.get(sessionId)
		if (runtime.processing) {
			return runtime.processing
		}

		runtime.processing = this.run(sessionId).finally(() => {
			const latestRuntime = this.runtimeStates.get(sessionId)
			latestRuntime.processing = undefined
			const latestSession = this.state.loadedSessions.get(sessionId)
			const hasAgentInput = Boolean(
				latestSession &&
				this.messageFactory.getActiveAgent(latestSession).pendingInputs.length,
			)
			if (
				latestRuntime.runState === 'idle' &&
				(hasQueuedSubmission(latestRuntime) || hasAgentInput)
			) {
				void this.start(sessionId)
				return
			}
			if (latestRuntime.runState === 'idle') {
				this.notify()
			}
		})
		return runtime.processing
	}

	private async run(sessionId: string) {
		const runtime = this.runtimeStates.get(sessionId)
		const session = this.state.loadedSessions.get(sessionId)
		if (!session) {
			runtime.runState = 'idle'
			return
		}

		let provider: AIProviderConfig | undefined
		let model: AIModelConfig | undefined
		try {
			const initialAgent = this.messageFactory.getActiveAgent(session)
			if (this.messageFactory.removeIncompleteToolCalls(initialAgent)) {
				const now = Date.now()
				session.updatedAt = now
				await this.store.persistSession(session)
			}
			provider = this.selection.getProviderOrThrow(session)
			model = this.selection.getModelOrThrow(provider, session)
			let agentContinuation: ToolCallRepeatState | undefined
			while (true) {
				const agent = this.messageFactory.getActiveAgent(session)
				if (consumePendingInputs(agent)) {
					session.updatedAt = Date.now()
					await this.store.persistSession(session)
				}
				const compactionRequest = this.createCompactionRequest(
					session,
					agent,
					provider,
					model,
				)
				this.compactionCoordinator.startIfNeeded(compactionRequest)
				if (this.compactionCoordinator.hasJob(compactionRequest)) {
					const compactionResult =
						await this.compactionCoordinator.commitReady(compactionRequest)
					if (compactionResult === 'committed') continue
					if (compactionResult === 'failed') {
						throw new ContextCompressionFailedError(
							i18n.t('chatbox.errors.contextCompressionFailed'),
						)
					}
				}
				const lastMessage = agent.timeline[agent.timeline.length - 1]

				if (
					!agentContinuation &&
					(!lastMessage || lastMessage.role !== 'user')
				) {
					const flushed = await this.flushPendingMessages(session)
					if (!flushed) {
						runtime.runState = 'idle'
						this.notify()
						return
					}
				}

				if (
					shouldAutoCompressAgent(
						agent,
						model,
						session.inferenceParams?.maxTokens,
					)
				) {
					if (
						!(await this.completeRequiredCompaction(
							compactionRequest,
							session,
							agent,
							provider,
							model,
						))
					)
						return
					continue
				}

				await this.ensureProviderReady(provider)
				if (runtime.stopRequested) {
					this.messageFactory.finishStoppedSessionRun(session, agent)
					await this.store.persistSession(session)
					return
				}
				const assistantMeta = {
					providerId: provider.id,
					providerName: provider.name,
					modelId: model.id,
					modelName: model.name,
				}
				const abortController = this.runtimeStates.createAbortController(
					session.id,
				)
				const turnResult = await (async () => {
					try {
						return await this.agentRunner.runTurn({
							session,
							agent,
							provider,
							model,
							depth: 0,
							assistantMeta,
							runtime,
							isCancelled: () =>
								runtime.stopRequested ||
								this.state.deletedSessionIds.has(session.id),
							isDeleted: () => this.state.deletedSessionIds.has(session.id),
							continuation: agentContinuation,
							abortSignal: abortController.signal,
							buildMessages: (a, tools) => this.buildMessagesForAgent(a, tools),
							shouldSuspendAfterToolStep: () =>
								runtime.stopRequested ||
								this.state.deletedSessionIds.has(session.id) ||
								this.compactionCoordinator.shouldSuspendAtSafePoint(
									compactionRequest,
								),
						})
					} finally {
						this.runtimeStates.clearAbortController(session.id, abortController)
					}
				})()

				if (this.state.deletedSessionIds.has(session.id)) {
					runtime.stopRequested = false
					runtime.runState = 'idle'
					return
				}

				if (runtime.stopRequested) {
					this.messageFactory.finishStoppedSessionRun(session, agent)
					await this.store.persistSession(session)
					return
				}

				if (turnResult.status === 'failed') {
					this.messageFactory.reportFatalError(
						session,
						turnResult.error,
						assistantMeta,
						agent,
					)
					runtime.runState = 'idle'
					await this.store.persistSession(session)
					return
				}
				agentContinuation =
					turnResult.status === 'suspended'
						? turnResult.continuation
						: undefined
				if (turnResult.status === 'completed') runtime.runState = 'idle'
				continue
			}
		} catch (error) {
			await this.handleRunError(error, session, runtime, provider, model)
		}
	}

	private async handleRunError(
		error: unknown,
		session: ChatSession,
		runtime: SessionRuntimeState,
		provider?: AIProviderConfig,
		model?: AIModelConfig,
	) {
		if (this.state.deletedSessionIds.has(session.id)) {
			runtime.runState = 'idle'
			return
		}
		const activeAgent = this.messageFactory.getActiveAgent(session)
		if (isAbortError(error) && runtime.stopRequested) {
			this.messageFactory.finishStoppedSessionRun(session, activeAgent)
			await this.store.persistSession(session)
			return
		}
		this.messageFactory.removeIncompleteToolCalls(activeAgent)
		const lastMessage = activeAgent.timeline.at(-1)
		if (
			lastMessage?.role === 'assistant' &&
			lastMessage.parts.every((part) => part.type === 'step-start')
		) {
			activeAgent.timeline.pop()
		}
		this.messageFactory.reportFatalError(
			session,
			extractErrorMessage(error, i18n.t('chatbox.requestFailed')),
			{
				providerId: provider?.id,
				providerName: provider?.name,
				modelId: model?.id,
				modelName: model?.name,
			},
			activeAgent,
		)
		runtime.runState = 'idle'
		await this.store.persistSession(session)
	}

	private async compressContext(
		session: ChatSession,
		agent: ChatAgentState,
		provider: AIProviderConfig,
		model: AIModelConfig,
	) {
		const runtime = this.runtimeStates.get(session.id)
		runtime.runState = 'compressing'
		this.notify()
		await this.ensureProviderReady(provider)
		if (!runtime.stopRequested) {
			const abortController = this.runtimeStates.createAbortController(
				session.id,
			)
			try {
				const result = await runContextCompression({
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
					buildMessages: (messages, tools) =>
						this.buildMessagesForAgent(agent, tools, messages),
					isCancelled: () =>
						this.runtimeStates.get(session.id).stopRequested ||
						this.state.deletedSessionIds.has(session.id),
					abortSignal: abortController.signal,
				})
				if (result !== 'committed' && result !== 'cancelled') {
					throw new ContextCompressionFailedError(
						i18n.t('chatbox.errors.contextCompressionFailed'),
					)
				}
			} finally {
				this.runtimeStates.clearAbortController(session.id, abortController)
			}
		}
		if (this.state.deletedSessionIds.has(session.id)) {
			runtime.stopRequested = false
			runtime.runState = 'idle'
			return false
		}
		if (runtime.stopRequested) {
			runtime.runState = 'idle'
			await this.store.persistSession(session)
			this.notify()
			return false
		}
		this.notify()
		return true
	}

	private async completeRequiredCompaction(
		request: ContextCompactionRequest,
		session: ChatSession,
		agent: ChatAgentState,
		provider: AIProviderConfig,
		model: AIModelConfig,
	) {
		const runtime = this.runtimeStates.get(session.id)
		runtime.runState = 'compressing'
		this.notify()
		const result = await this.compactionCoordinator.waitAndCommit(request)
		if (result === 'committed') {
			this.notify()
			return true
		}
		if (result === 'failed' || result === 'stale') {
			throw new ContextCompressionFailedError(
				i18n.t('chatbox.errors.contextCompressionFailed'),
			)
		}
		return this.compressContext(session, agent, provider, model)
	}

	private async flushPendingMessages(session: ChatSession) {
		const runtime = this.runtimeStates.get(session.id)
		if (!hasQueuedSubmission(runtime)) {
			return false
		}

		const agent = this.messageFactory.getActiveAgent(session)
		const pendingSubmissions = runtime.pending.splice(0)
		let appended = false
		for (const submission of pendingSubmissions) {
			const preparedContext =
				await this.userContextManager.prepareUserContextForMessage(
					submission.userContext,
				)
			const normalizedText = submission.text.trim()
			if (!normalizedText && preparedContext.dedupedItems.length === 0) {
				continue
			}
			await this.messageFactory.appendUserMessage(
				agent,
				normalizedText,
				session,
				preparedContext.dedupedItems.length > 0
					? preparedContext.dedupedItems
					: undefined,
			)
			appended = true
		}
		if (!appended) {
			this.notify()
			return false
		}
		this.store.upsertSessionIndexItem(session, deriveTitle(session))
		void this.store.persistSession(session)
		void this.store.persistMetaAndIndex()
		this.notify()
		return true
	}

	private async buildMessagesForAgent(
		agent: ChatAgentState,
		tools: ToolSet,
		timeline?: ChatAgentState['timeline'],
	): Promise<ModelMessage[]> {
		return buildAgentMessages(agent, tools, this.userContextManager, timeline)
	}

	private createCompactionRequest(
		session: ChatSession,
		agent: ChatAgentState,
		provider: AIProviderConfig,
		model: AIModelConfig,
	): ContextCompactionRequest {
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
			buildMessages: (messages, tools) =>
				this.buildMessagesForAgent(agent, tools, messages),
			isCancelled: () =>
				this.runtimeStates.get(session.id).stopRequested === true ||
				this.state.deletedSessionIds.has(session.id),
			isCurrent: () =>
				this.state.loadedSessions.get(session.id) === session &&
				session.model?.providerId === provider.id &&
				session.model?.modelId === model.id &&
				createContextCompactionRevision(session, provider, model) === revision,
		}
	}
}
