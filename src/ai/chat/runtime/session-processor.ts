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
	ContextCompactionCoordinator,
	createContextCompactionRevision,
	type ContextCompactionRequest,
} from '~/ai/chat/runtime/context-compaction-coordinator'
import { runAgentLoop, type AgentLoopError } from '~/ai/chat/runtime/agent-loop'
import { hasQueuedSubmission } from '~/ai/chat/runtime/pending-submission'
import { createAbortError, isAbortError } from '~/ai/transport/abort'
import i18n from '~/i18n'
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
			const resolvedProvider = this.selection.getProviderOrThrow(session)
			provider = resolvedProvider
			const resolvedModel = this.selection.getModelOrThrow(
				resolvedProvider,
				session,
			)
			model = resolvedModel
			const agent = this.messageFactory.getActiveAgent(session)
			if (consumePendingInputs(agent)) {
				session.updatedAt = Date.now()
				await this.store.persistSession(session)
			}
			const lastMessage = agent.timeline[agent.timeline.length - 1]

			if (!lastMessage || lastMessage.role !== 'user') {
				const flushed = await this.flushPendingMessages(session)
				if (!flushed) {
					runtime.runState = 'idle'
					this.notify()
					return
				}
			}

			const assistantMeta = {
				providerId: resolvedProvider.id,
				providerName: resolvedProvider.name,
				modelId: resolvedModel.id,
				modelName: resolvedModel.name,
			}
			const isCancelled = () =>
				runtime.stopRequested === true ||
				this.state.deletedSessionIds.has(session.id)
			const loopResult = await runAgentLoop({
				compactionCoordinator: this.compactionCoordinator,
				createCompactionRequest: () => {
					consumePendingInputs(agent)
					return this.createCompactionRequest(
						session,
						agent,
						resolvedProvider,
						resolvedModel,
					)
				},
				isCancelled,
				onStateChange: (state) => {
					if (state === 'compacting') runtime.runState = 'compressing'
					if (state === 'running-turn') runtime.runState = 'thinking'
					this.notify()
				},
				runTurn: async (continuation, shouldSuspendAtSafePoint) => {
					await this.ensureProviderReady(resolvedProvider)
					if (isCancelled()) throw createAbortError('Agent loop cancelled')
					const abortController = this.runtimeStates.createAbortController(
						session.id,
					)
					try {
						return await this.agentRunner.runTurn({
							session,
							agent,
							provider: resolvedProvider,
							model: resolvedModel,
							depth: 0,
							assistantMeta,
							runtime,
							isCancelled,
							isDeleted: () => this.state.deletedSessionIds.has(session.id),
							continuation,
							abortSignal: abortController.signal,
							buildMessages: (a, tools) => this.buildMessagesForAgent(a, tools),
							shouldSuspendAfterToolStep: shouldSuspendAtSafePoint,
						})
					} finally {
						this.runtimeStates.clearAbortController(session.id, abortController)
					}
				},
			})

			if (this.state.deletedSessionIds.has(session.id)) {
				runtime.stopRequested = false
				runtime.runState = 'idle'
				return
			}

			if (loopResult.status === 'cancelled') {
				this.messageFactory.finishStoppedSessionRun(session, agent)
				await this.store.persistSession(session)
				return
			}

			if (loopResult.status === 'failed') {
				this.messageFactory.reportFatalError(
					session,
					this.agentLoopErrorMessage(loopResult.error),
					assistantMeta,
					agent,
				)
				runtime.runState = 'idle'
				await this.store.persistSession(session)
				return
			}
			runtime.runState = 'idle'
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

	private agentLoopErrorMessage(error: AgentLoopError) {
		if (error.type !== 'turn-failed') {
			return i18n.t('chatbox.errors.contextCompressionFailed')
		}
		return extractErrorMessage(error.cause, i18n.t('chatbox.requestFailed'))
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
