import { Notice } from 'obsidian'
import {
	getModelById,
	getProviderById,
	resolveInitialSelection,
} from '~/ai/config'
import { assertProviderUsable, generateAssistantTurn } from '~/ai/runtime'
import {
	REPEATED_TOOL_CALL_THRESHOLD,
	ToolCallRepeatState,
	updateToolCallRepeatState,
} from '~/ai/tool-call-repeat'
import { createAITools } from '~/ai/tools'
import {
	AIMessage,
	AIMessageContentPart,
	AIProviderConfig,
	AIToolCall,
	AIToolDefinition,
	AIToolExecutionContext,
	ChatMessageRecord,
	ChatSession,
	ChatTaskRecord,
} from '~/ai/types'
import {
	ChatFragment,
	ChatMessage,
	ChatPendingMessage,
	ChatRunState,
	ChatSessionIndexItem,
	cloneMessage,
	cloneSession,
	createQueuedTask,
	createRunningTask,
	isTerminalTask,
	mutateTaskRecord,
	QueuedChatTask,
	toCancelledTask,
	toCompletedTask,
	toFailedTask,
	toRunningTask,
} from '~/chat/domain'
import type { ChatboxProps, ChatProviderOption } from '~/chatbox/types'
import i18n from '~/i18n'
import { chatMetaKV, chatSessionKV, type ChatMetaRecord } from '~/storage'
import createId from '~/utils/create-id'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'

const MAX_TASK_DEPTH = 2
const MAX_CONCURRENT_TASKS_PER_SESSION = 3
const CHAT_META_KEY = 'chat_meta'
const CHAT_INDEX_KEY = 'chat_index'
const INTERRUPTED_TASK_CANCEL_REASON = 'interrupted_by_restart'
const INTERRUPTED_TASK_FAILURE_STAGE = 'interrupted_by_restart'
const COMPRESSION_PROMPT = [
	'Summarize the conversation above for continuation in a fresh context.',
	'Return a compact but information-dense handoff covering:',
	'1. Confirmed facts and file paths.',
	'2. Decisions already made.',
	'3. Constraints, caveats, and user preferences.',
	'4. Unfinished work and the next concrete step.',
	'5. Any tool results that remain relevant.',
	'Write the summary as a user message that can be pasted into a new chat segment.',
].join(' ')

interface ResolvedToolResult {
	payload: string | Record<string, unknown>
	isError: boolean
}

interface DeferredTaskCompletion {
	promise: Promise<Record<string, unknown>>
	resolve: (payload: Record<string, unknown>) => void
	settled: boolean
}

interface AgentRunResult {
	status: 'completed' | 'failed' | 'cancelled'
	summary?: string
	error?: string
	failureStage?: string
	sourceCount: number
}

interface SessionRuntimeState {
	runState: ChatRunState
	processing?: Promise<void>
	stopRequested?: boolean
	pendingMessages: ChatPendingMessage[]
}

function toTextParts(text: string): AIMessageContentPart[] {
	return [{ type: 'text', text }]
}

function messageToText(message: Pick<ChatMessage, 'content'> | AIMessage) {
	if (!message.content) {
		return ''
	}
	return message.content
		.filter(
			(part): part is Extract<AIMessageContentPart, { type: 'text' }> =>
				part.type === 'text',
		)
		.map((part) => part.text)
		.join('\n')
}

function getAssistantToolCalls(message: ChatMessage) {
	return message.role === 'assistant' ? message.tool_calls : undefined
}

function deriveTitle(session: Pick<ChatSession, 'fragments'>) {
	for (const fragment of session.fragments) {
		const firstUser = fragment.messages.find(
			(item) => item.message.role === 'user',
		)
		const content = firstUser ? messageToText(firstUser.message).trim() : ''
		if (content) {
			return content
		}
	}
	return i18n.t('chatbox.newChat')
}

function createVaultToolGuidance() {
	return [
		'Choose tools based on the user intent instead of repeating the same lookup strategy.',
		'When an initial lookup returns no results, broaden the search method before concluding that information is missing.',
		'For requests about locating notes or files, prefer iterative discovery and verification over early failure.',
	].join(' ')
}

function createMainSystemPrompt(maxDepth: number) {
	return [
		'You are an Obsidian chat assistant with access to vault tools.',
		'Use vault tools directly for focused file operations.',
		createVaultToolGuidance(),
		`Use the spawn tool only for large independent tasks that should run in the background. Maximum task depth is ${maxDepth}.`,
	].join(' ')
}

function createSubagentSystemPrompt(canSpawn: boolean) {
	return [
		'You are a focused background subagent working inside an Obsidian vault.',
		createVaultToolGuidance(),
		canSpawn &&
			'Use spawn when this task must be split into smaller independent background tasks.',
		'When you finish, return a concise final answer. If the task fails, explain the failure clearly.',
	]
		.filter(Boolean)
		.join(' ')
}

function createSessionPlaceholder(item: ChatSessionIndexItem): ChatSession {
	return {
		id: item.id,
		title: item.title,
		createdAt: item.createdAt,
		fragments: [],
		activeFragmentId: '',
		tasks: [],
	}
}

export default class ChatService {
	private readonly loadedSessions = new Map<string, ChatSession>()
	private sessionIndex: ChatSessionIndexItem[] = []
	private readonly deletedSessionIds = new Set<string>()
	private pendingProviderId?: string
	private pendingModelId?: string
	private activeSessionId?: string
	private listeners = new Set<() => void>()
	private readonly runtimeBySessionId = new Map<string, SessionRuntimeState>()
	private readonly taskModelSelection = new Map<
		string,
		{
			providerId?: string
			modelId?: string
		}
	>()
	private readonly pendingTaskCompletions = new Map<
		string,
		DeferredTaskCompletion
	>()
	private initialization?: Promise<void>

	constructor(private plugin: NutstorePlugin) {}

	async initialize() {
		if (this.initialization) {
			return this.initialization
		}

		this.initialization = this.initializeInternal().catch((error) => {
			this.initialization = undefined
			throw error
		})
		return this.initialization
	}

	private async initializeInternal() {
		await this.loadSessionIndex()

		if (this.sessionIndex.length === 0) {
			const session = this.createEmptySession()
			this.activeSessionId = session.id
			this.loadedSessions.set(session.id, session)
			this.upsertSessionIndexItem(session)
			await this.persistSession(session)
			await this.persistMetaAndIndex()
			return
		}

		const fallbackSessionId =
			this.activeSessionId &&
			this.sessionIndex.some((item) => item.id === this.activeSessionId)
				? this.activeSessionId
				: this.sessionIndex[0]?.id
		this.activeSessionId = fallbackSessionId
		if (fallbackSessionId) {
			await this.loadSessionById(fallbackSessionId)
			await this.persistMetaAndIndex()
		}
	}

	subscribe(listener: () => void) {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	async handleSettingsChanged() {
		await this.initialize()
		const persisted: Promise<unknown>[] = []
		this.syncPendingSelectionWithSettings()
		for (const session of this.loadedSessions.values()) {
			if (this.sanitizeSessionSelection(session)) {
				persisted.push(this.persistSession(session))
			}
		}

		if (persisted.length > 0) {
			await Promise.all(persisted)
		}
		this.notify()
	}

	getViewProps(): ChatboxProps {
		const activeSession = this.getLoadedActiveSession()
		const activeRuntime = activeSession
			? this.getRuntime(activeSession.id)
			: { runState: 'idle' as const, pendingMessages: [] }
		const fallbackSelection = resolveInitialSelection(
			this.plugin.settings.providers,
			this.plugin.settings.defaultProviderId,
			this.plugin.settings.defaultModelId,
		)
		const emptyStateSelection = this.getEmptyStateSelection()
		const providerIdForView = activeSession
			? activeSession.providerId
			: emptyStateSelection.providerId || fallbackSelection.providerId
		const modelIdForView = activeSession
			? activeSession.modelId
			: emptyStateSelection.modelId || fallbackSelection.modelId
		const selectedProvider = getProviderById(
			this.plugin.settings.providers,
			providerIdForView,
		)
		const selectedModel = getModelById(selectedProvider, modelIdForView)

		return {
			title:
				activeSession?.title ||
				this.sessionIndex.find((item) => item.id === this.activeSessionId)
					?.title ||
				i18n.t('chatbox.newChat'),
			sessionHistory: this.sessionIndex.map((item) => ({
				...item,
			})),
			activeSessionId: this.activeSessionId,
			timeline: activeSession ? this.buildTimeline(activeSession) : [],
			currentSessionTasks: activeSession
				? activeSession.tasks
						.slice()
						.sort((left, right) => right.createdAt - left.createdAt)
				: [],
			otherSessionTasks: this.collectOtherSessionTasks(),
			providers: this.plugin.settings.providers.map<ChatProviderOption>(
				(provider) => ({
					id: provider.id,
					name: provider.name || i18n.t('settings.ai.unnamedProvider'),
					models: provider.models.map((model) => ({
						id: model.id,
						name: model.name || i18n.t('settings.ai.unnamedModel'),
					})),
				}),
			),
			selectedProviderId: selectedProvider?.id,
			selectedModelId: selectedModel?.id,
			runState: activeRuntime.runState,
			pendingMessages: activeRuntime.pendingMessages.map((item) => ({
				...item,
			})),
			canSend: true,
			canCreateFragment: !!activeSession && activeRuntime.runState === 'idle',
			canCompress:
				!!activeSession &&
				activeRuntime.runState === 'idle' &&
				this.getActiveFragment(activeSession).messages.length > 0,
			onNewSession: () => {
				void this.createSession()
			},
			onNewFragment: () => {
				this.createFragmentForActiveSession()
			},
			onCompressContext: async () => {
				await this.compressContext()
			},
			onSwitchSession: (sessionId: string) => {
				void this.switchSession(sessionId)
			},
			onDeleteSession: async (sessionId: string) => {
				await this.deleteSession(sessionId)
			},
			onSelectProvider: (providerId: string) => {
				this.selectProvider(providerId)
			},
			onSelectModel: (modelId: string) => {
				this.selectModel(modelId)
			},
			onSendMessage: async (text: string) => {
				await this.sendMessage(text)
			},
			onStopActiveRun: () => {
				this.stopActiveSessionRun()
			},
			onCancelTask: (taskId: string) => {
				this.cancelTask(taskId)
			},
		}
	}

	async ensureSession() {
		await this.initialize()
	}

	async createSession() {
		await this.initialize()
		const session = this.createEmptySession()
		this.loadedSessions.set(session.id, session)
		this.activeSessionId = session.id
		this.upsertSessionIndexItem(session, true)
		this.getRuntime(session.id)
		await this.persistSession(session)
		await this.persistMetaAndIndex()
		this.notify()
		return session
	}

	async switchSession(sessionId: string) {
		await this.initialize()
		if (!this.sessionIndex.some((item) => item.id === sessionId)) {
			return
		}

		await this.loadSessionById(sessionId)
		this.activeSessionId = sessionId
		await this.persistMetaAndIndex()
		this.notify()
	}

	async deleteSession(sessionId: string) {
		await this.initialize()
		if (!this.sessionIndex.some((item) => item.id === sessionId)) {
			return
		}

		this.deletedSessionIds.add(sessionId)
		const session = this.loadedSessions.get(sessionId)
		if (session) {
			await this.stopSessionRun(session)
			this.cancelAllNonTerminalTasks(session, 'user_cancelled')
			this.cleanupSessionTaskTracking(session)
		}

		this.sessionIndex = this.sessionIndex.filter(
			(item) => item.id !== sessionId,
		)
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = this.sessionIndex[0]?.id
		}

		this.loadedSessions.delete(sessionId)
		this.runtimeBySessionId.delete(sessionId)
		await chatSessionKV.unset(sessionId)
		await this.persistMetaAndIndex()
		this.notify()
		new Notice(i18n.t('chatbox.sessionDeleted'))
	}

	selectProvider(providerId: string) {
		const session = this.getLoadedActiveSession()
		if (!session) {
			if (!providerId) {
				this.pendingProviderId = undefined
				this.pendingModelId = undefined
				this.notify()
				return
			}

			const provider = getProviderById(
				this.plugin.settings.providers,
				providerId,
			)
			if (!provider) {
				return
			}

			this.pendingProviderId = provider.id
			this.pendingModelId = provider.models[0]?.id
			this.notify()
			return
		}

		if (this.getRuntime(session.id).runState !== 'idle') {
			return
		}
		if (!providerId) {
			session.providerId = undefined
			session.modelId = undefined
			void this.persistSession(session)
			this.notify()
			return
		}

		const provider = getProviderById(this.plugin.settings.providers, providerId)
		if (!provider) {
			return
		}

		session.providerId = provider.id
		session.modelId = provider.models[0]?.id
		void this.persistSession(session)
		this.notify()
	}

	selectModel(modelId: string) {
		const session = this.getLoadedActiveSession()
		if (!session) {
			if (!modelId) {
				this.pendingModelId = undefined
				this.notify()
				return
			}

			const provider = getProviderById(
				this.plugin.settings.providers,
				this.pendingProviderId,
			)
			const model = getModelById(provider, modelId)
			if (!model) {
				return
			}

			this.pendingModelId = model.id
			this.notify()
			return
		}

		if (this.getRuntime(session.id).runState !== 'idle') {
			return
		}
		if (!modelId) {
			session.modelId = undefined
			void this.persistSession(session)
			this.notify()
			return
		}

		const provider = getProviderById(
			this.plugin.settings.providers,
			session.providerId,
		)
		const model = getModelById(provider, modelId)
		if (!model) {
			return
		}

		session.modelId = model.id
		void this.persistSession(session)
		this.notify()
	}

	async sendMessage(text: string) {
		await this.initialize()
		const normalizedText = text.trim()
		if (!normalizedText) {
			return
		}

		const session =
			this.getLoadedActiveSession() || (await this.createSession())
		if (!session || !this.validateSessionSelection(session)) {
			return
		}

		const runtime = this.getRuntime(session.id)
		if (runtime.runState !== 'idle' || runtime.processing) {
			runtime.pendingMessages.push(this.createPendingMessage(normalizedText))
			this.notify()
			return
		}

		this.appendUserMessage(this.getActiveFragment(session), normalizedText)
		session.title = deriveTitle(session)
		this.upsertSessionIndexItem(session)
		runtime.runState = 'thinking'
		await this.persistSession(session)
		await this.persistMetaAndIndex()
		this.notify()
		await this.startSessionProcessor(session.id)
	}

	createFragmentForActiveSession() {
		const session = this.getLoadedActiveSession()
		if (!session) {
			return
		}

		const runtime = this.getRuntime(session.id)
		if (runtime.runState !== 'idle' || runtime.processing) {
			return
		}

		this.createFragment(session)
		void this.persistSession(session)
		this.notify()
	}

	async compressContext() {
		await this.initialize()
		const session = this.getLoadedActiveSession()
		if (!session) {
			return
		}

		const runtime = this.getRuntime(session.id)
		if (runtime.runState !== 'idle' || runtime.processing) {
			return
		}
		if (!this.validateSessionSelection(session)) {
			return
		}

		const sourceFragment = this.getActiveFragment(session)
		runtime.runState = 'compressing'
		this.notify()

		const task = (async () => {
			try {
				if (sourceFragment.messages.length > 0) {
					const provider = this.getProviderOrThrow(session)
					const model = this.getModelOrThrow(provider, session)
					const response = await generateAssistantTurn({
						provider,
						model: model.name,
						messages: [
							...sourceFragment.messages.map((item) => item.message),
							{
								role: 'user',
								content: toTextParts(COMPRESSION_PROMPT),
							},
						],
						tools: [],
					})

					if (this.deletedSessionIds.has(session.id) || runtime.stopRequested) {
						return
					}

					const summary =
						messageToText(response.message).trim() || COMPRESSION_PROMPT
					const targetFragment = this.createFragment(session)
					this.appendUserMessage(targetFragment, summary)
					session.title = deriveTitle(session)
					this.upsertSessionIndexItem(session)
					await this.persistSession(session)
					await this.persistMetaAndIndex()
				}
			} catch (error) {
				const provider = getProviderById(
					this.plugin.settings.providers,
					session.providerId,
				)
				const model = getModelById(provider, session.modelId)
				this.reportFatalError(
					session,
					error instanceof Error
						? error.message
						: i18n.t('chatbox.requestFailed'),
					{
						providerId: provider?.id,
						providerName: provider?.name,
						modelId: model?.id,
						modelName: model?.name,
					},
					sourceFragment,
				)
				await this.persistSession(session)
			} finally {
				runtime.processing = undefined
				if (runtime.pendingMessages.length > 0) {
					runtime.runState = 'idle'
					this.notify()
					void this.startSessionProcessor(session.id)
				} else {
					runtime.runState = 'idle'
					this.notify()
				}
			}
		})()

		runtime.processing = task
		await task
	}

	cancelTask(taskId: string) {
		const session = this.findLoadedSessionByTaskId(taskId)
		const rootTask = session?.tasks.find((item) => item.id === taskId)
		if (!session || !rootTask) {
			return
		}

		const terminalTasks = session.tasks.filter(
			(item) =>
				item.id === taskId || this.isTaskDescendantOf(session, item, taskId),
		)
		let changed = false

		for (const task of terminalTasks) {
			if (this.isTaskTerminal(task)) {
				continue
			}
			mutateTaskRecord(
				task,
				toCancelledTask(
					task,
					task.id === taskId ? 'user_cancelled' : 'ancestor_cancelled',
					i18n.t('chatbox.task.cancelledSummary', {
						task: task.label,
					}),
					Date.now(),
				),
			)
			this.resolveTaskCompletion(task.id, this.buildTaskToolPayload(task))
			this.cleanupTaskTracking(task.id)
			changed = true
		}

		if (changed) {
			void this.persistSession(session)
			this.notify()
			this.startQueuedTasksForSession(session)
		}
	}

	stopActiveSessionRun() {
		const session = this.getLoadedActiveSession()
		if (!session) {
			return
		}

		void this.stopSessionRun(session)
	}

	private async stopSessionRun(session: ChatSession) {
		const runtime = this.getRuntime(session.id)
		if (
			runtime.runState !== 'thinking' &&
			runtime.runState !== 'waiting_for_tools' &&
			runtime.runState !== 'compressing'
		) {
			return
		}

		runtime.stopRequested = true

		const changed = this.cancelAllNonTerminalTasks(session, 'user_cancelled')

		if (changed) {
			void this.persistSession(session)
			this.notify()
			this.startQueuedTasksForSession(session)
		}

		await runtime.processing
	}

	private async loadSessionIndex() {
		const [metaRaw, indexRaw] = await Promise.all([
			chatMetaKV.get(CHAT_META_KEY),
			chatMetaKV.get(CHAT_INDEX_KEY),
		])
		const meta = this.isChatMetaRecord(metaRaw)
			? metaRaw
			: { orderedSessionIds: [] }
		const index = Array.isArray(indexRaw)
			? indexRaw.filter(
					(item): item is ChatSessionIndexItem =>
						!!item &&
						typeof item.id === 'string' &&
						typeof item.title === 'string' &&
						typeof item.createdAt === 'number',
				)
			: []

		const indexById = new Map(index.map((item) => [item.id, item]))
		this.sessionIndex = meta.orderedSessionIds
			.map((sessionId) => indexById.get(sessionId))
			.filter((item): item is ChatSessionIndexItem => !!item)
		for (const item of index) {
			if (!meta.orderedSessionIds.includes(item.id)) {
				this.sessionIndex.push(item)
			}
		}
		this.activeSessionId = meta.activeSessionId
	}

	private async loadSessionById(sessionId: string) {
		const cached = this.loadedSessions.get(sessionId)
		if (cached) {
			return cached
		}

		const stored = await chatSessionKV.get(sessionId)
		if (!stored) {
			throw new Error(i18n.t('chatbox.errors.sessionNotFound'))
		}

		const { session, changed } = this.rehydrateSession(stored)
		this.loadedSessions.set(sessionId, session)
		const runtime = this.getRuntime(sessionId)
		runtime.pendingMessages = []
		this.upsertSessionIndexItem(session)
		if (changed) {
			await this.persistSession(session)
			await this.persistMetaAndIndex()
		}
		return session
	}

	private async persistSession(session: ChatSession) {
		if (this.deletedSessionIds.has(session.id)) {
			return
		}
		await chatSessionKV.set(session.id, cloneSession(session))
	}

	private async persistMetaAndIndex() {
		const meta: ChatMetaRecord = {
			activeSessionId: this.activeSessionId,
			orderedSessionIds: this.sessionIndex.map((item) => item.id),
		}
		await Promise.all([
			chatMetaKV.set(CHAT_META_KEY, meta),
			chatMetaKV.set(
				CHAT_INDEX_KEY,
				this.sessionIndex.map((item) => ({ ...item })),
			),
		])
	}

	private rehydrateSession(session: ChatSession) {
		const rehydrated = this.normalizeSession(session)
		let changed = this.sanitizeSessionSelection(rehydrated)

		for (const task of rehydrated.tasks) {
			if (task.status !== 'queued' && task.status !== 'running') {
				continue
			}
			mutateTaskRecord(
				task,
				toCancelledTask(
					task,
					INTERRUPTED_TASK_CANCEL_REASON,
					i18n.t('chatbox.task.cancelledSummary', {
						task: task.label,
					}),
					Date.now(),
				),
			)
			changed = true
		}

		return {
			session: rehydrated,
			changed,
		}
	}

	private normalizeSession(session: ChatSession): ChatSession {
		const normalized: ChatSession = {
			id: session.id,
			createdAt: session.createdAt,
			title: session.title || i18n.t('chatbox.newChat'),
			providerId: session.providerId,
			modelId: session.modelId,
			fragments:
				Array.isArray(session.fragments) && session.fragments.length > 0
					? session.fragments.map((fragment) => ({
							id: fragment.id,
							createdAt: fragment.createdAt,
							messages: Array.isArray(fragment.messages)
								? fragment.messages.map((message) => ({
										...message,
										message: cloneMessage(message.message),
										meta: message.meta
											? {
													...message.meta,
													usage: message.meta.usage
														? {
																...message.meta.usage,
															}
														: undefined,
												}
											: undefined,
									}))
								: [],
						}))
					: [
							{
								id: createId('fragment'),
								createdAt: Date.now(),
								messages: [],
							},
						],
			activeFragmentId: session.activeFragmentId,
			tasks: Array.isArray(session.tasks)
				? session.tasks.map((task) => ({ ...task }))
				: [],
		}

		if (
			!normalized.fragments.some(
				(item) => item.id === normalized.activeFragmentId,
			)
		) {
			normalized.activeFragmentId =
				normalized.fragments[normalized.fragments.length - 1].id
		}
		if (!normalized.title.trim()) {
			normalized.title = deriveTitle(normalized)
		}
		return normalized
	}

	private isChatMetaRecord(value: unknown): value is ChatMetaRecord {
		return (
			!!value &&
			typeof value === 'object' &&
			Array.isArray((value as ChatMetaRecord).orderedSessionIds)
		)
	}

	private upsertSessionIndexItem(session: ChatSession, prepend = false) {
		if (this.deletedSessionIds.has(session.id)) {
			return
		}
		const item: ChatSessionIndexItem = {
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
		}
		const existingIndex = this.sessionIndex.findIndex(
			(entry) => entry.id === session.id,
		)
		if (existingIndex === -1) {
			this.sessionIndex = prepend
				? [item, ...this.sessionIndex]
				: [...this.sessionIndex, item]
			return
		}

		const nextIndex = this.sessionIndex.slice()
		nextIndex[existingIndex] = item
		if (prepend && existingIndex > 0) {
			nextIndex.splice(existingIndex, 1)
			nextIndex.unshift(item)
		}
		this.sessionIndex = nextIndex
	}

	private buildTimeline(session: ChatSession): ChatboxProps['timeline'] {
		const flattenedMessages = session.fragments.flatMap(
			(fragment) => fragment.messages,
		)

		return session.fragments.flatMap((fragment) => {
			const items = fragment.messages.flatMap((message) => {
				const toolMessage =
					message.message.role === 'tool' ? message.message : undefined
				if (
					message.message.role === 'assistant' &&
					!messageToText(message.message).trim() &&
					message.message.content?.every((part) => part.type === 'text') !==
						false &&
					Array.isArray(message.message.tool_calls) &&
					message.message.tool_calls.length > 0
				) {
					return []
				}

				return [
					{
						id: `message:${message.id}`,
						kind: 'message' as const,
						createdAt: message.createdAt,
						message,
						toolCall: toolMessage
							? flattenedMessages
									.slice(
										0,
										flattenedMessages.findIndex(
											(item) => item.id === message.id,
										),
									)
									.reverse()
									.flatMap((item) => getAssistantToolCalls(item.message) || [])
									.find((toolCall) => toolCall.id === toolMessage.tool_call_id)
							: undefined,
					},
				]
			})

			return [
				{
					id: `fragment:${fragment.id}`,
					kind: 'fragment' as const,
					createdAt: fragment.createdAt,
				},
				...items,
			]
		})
	}

	private collectOtherSessionTasks() {
		return Array.from(this.loadedSessions.values())
			.filter((session) => session.id !== this.activeSessionId)
			.flatMap((session) => session.tasks)
			.sort((left, right) => right.createdAt - left.createdAt)
	}

	private getLoadedActiveSession() {
		return this.activeSessionId
			? this.loadedSessions.get(this.activeSessionId)
			: undefined
	}

	private async startSessionProcessor(sessionId: string) {
		const runtime = this.getRuntime(sessionId)
		if (runtime.processing) {
			return runtime.processing
		}

		runtime.processing = this.runSessionProcessor(sessionId).finally(() => {
			const latestRuntime = this.getRuntime(sessionId)
			latestRuntime.processing = undefined
			if (
				latestRuntime.runState === 'idle' &&
				latestRuntime.pendingMessages.length
			) {
				void this.startSessionProcessor(sessionId)
				return
			}
			if (latestRuntime.runState === 'idle') {
				this.notify()
			}
		})
		return runtime.processing
	}

	private async runSessionProcessor(sessionId: string) {
		const runtime = this.getRuntime(sessionId)
		const session = this.loadedSessions.get(sessionId)
		if (!session) {
			runtime.runState = 'idle'
			return
		}

		try {
			const provider = this.getProviderOrThrow(session)
			const model = this.getModelOrThrow(provider, session)
			let repeatState: ToolCallRepeatState = {
				consecutiveCount: 0,
				isRepeatedTooManyTimes: false,
			}

			while (true) {
				const fragment = this.getActiveFragment(session)
				const lastMessage =
					fragment.messages[fragment.messages.length - 1]?.message

				if (
					!lastMessage ||
					(lastMessage.role !== 'user' && lastMessage.role !== 'tool')
				) {
					const flushed = this.flushPendingMessages(session)
					if (!flushed) {
						runtime.runState = 'idle'
						this.notify()
						return
					}
				}

				runtime.runState = 'thinking'
				this.notify()

				const tools = this.createToolsForContext(session, 0, MAX_TASK_DEPTH)
				const response = await generateAssistantTurn({
					provider,
					model: model.name,
					messages: this.buildMessagesForFragment(fragment),
					tools,
				})

				if (this.deletedSessionIds.has(session.id)) {
					runtime.stopRequested = false
					runtime.runState = 'idle'
					return
				}

				if (runtime.stopRequested) {
					fragment.messages.push(
						this.createMessageRecord(response.message, {
							...response.meta,
							modelId: model.id,
						}),
					)
					this.finishStoppedSessionRun(session, fragment)
					await this.persistSession(session)
					return
				}

				fragment.messages.push(
					this.createMessageRecord(response.message, {
						...response.meta,
						modelId: model.id,
					}),
				)
				await this.persistSession(session)
				this.notify()

				const assistantToolCalls = getAssistantToolCalls(response.message)
				if (!assistantToolCalls?.length) {
					runtime.runState = 'idle'
					continue
				}

				repeatState = updateToolCallRepeatState(repeatState, assistantToolCalls)
				if (repeatState.isRepeatedTooManyTimes) {
					this.reportFatalError(
						session,
						i18n.t('chatbox.repeatedToolCallsStopped', {
							count: REPEATED_TOOL_CALL_THRESHOLD,
						}),
						{
							providerId: provider.id,
							providerName: provider.name,
							modelId: model.id,
							modelName: model.name,
						},
						fragment,
					)
					runtime.runState = 'idle'
					await this.persistSession(session)
					return
				}

				runtime.runState = 'waiting_for_tools'
				this.notify()

				const toolMessages = await this.resolveToolCalls(
					assistantToolCalls,
					tools,
					{
						session,
						depth: 0,
						maxDepth: MAX_TASK_DEPTH,
					},
				)

				if (runtime.stopRequested) {
					this.finishStoppedSessionRun(session, fragment)
					await this.persistSession(session)
					return
				}

				for (const item of toolMessages) {
					fragment.messages.push(
						this.createMessageRecord(item.message, {
							isError: item.isError,
						}),
					)
				}
				await this.persistSession(session)
				this.notify()
			}
		} catch (error) {
			if (this.deletedSessionIds.has(session.id)) {
				runtime.runState = 'idle'
				return
			}
			const activeProvider = getProviderById(
				this.plugin.settings.providers,
				session.providerId,
			)
			const activeModel = getModelById(activeProvider, session.modelId)
			this.reportFatalError(
				session,
				error instanceof Error
					? error.message
					: i18n.t('chatbox.requestFailed'),
				{
					providerId: activeProvider?.id,
					providerName: activeProvider?.name,
					modelId: activeModel?.id,
					modelName: activeModel?.name,
				},
				this.getActiveFragment(session),
			)
			runtime.runState = 'idle'
			await this.persistSession(session)
		}
	}

	private flushPendingMessages(session: ChatSession) {
		const runtime = this.getRuntime(session.id)
		if (runtime.pendingMessages.length === 0) {
			return false
		}

		const mergedText = runtime.pendingMessages
			.map((item) => item.text.trim())
			.filter(Boolean)
			.join('\n\n')
		runtime.pendingMessages = []
		if (!mergedText) {
			this.notify()
			return false
		}

		const fragment = this.getActiveFragment(session)
		this.appendUserMessage(fragment, mergedText)
		session.title = deriveTitle(session)
		this.upsertSessionIndexItem(session)
		void this.persistSession(session)
		void this.persistMetaAndIndex()
		this.notify()
		return true
	}

	private getRuntime(sessionId: string): SessionRuntimeState {
		let runtime = this.runtimeBySessionId.get(sessionId)
		if (!runtime) {
			runtime = {
				runState: 'idle',
				pendingMessages: [],
			}
			this.runtimeBySessionId.set(sessionId, runtime)
		}
		return runtime
	}

	private createPendingMessage(text: string): ChatPendingMessage {
		return {
			id: createId('pending'),
			createdAt: Date.now(),
			text,
		}
	}

	private createFragment(session: ChatSession): ChatFragment {
		const fragment: ChatFragment = {
			id: createId('fragment'),
			createdAt: Date.now(),
			messages: [],
		}
		session.fragments = [...session.fragments, fragment]
		session.activeFragmentId = fragment.id
		return fragment
	}

	private getActiveFragment(session: ChatSession) {
		return (
			session.fragments.find((item) => item.id === session.activeFragmentId) ||
			session.fragments[session.fragments.length - 1]
		)
	}

	private appendUserMessage(fragment: ChatFragment, text: string) {
		fragment.messages.push(
			this.createMessageRecord({
				role: 'user',
				content: toTextParts(text),
			}),
		)
	}

	private finishStoppedSessionRun(
		session: ChatSession,
		fragment: ChatFragment,
	) {
		const runtime = this.getRuntime(session.id)
		this.removeUnmatchedToolCalls(fragment)
		runtime.stopRequested = false
		runtime.runState = 'idle'
		this.notify()
	}

	private cancelAllNonTerminalTasks(
		session: ChatSession,
		cancelReason: string,
	) {
		let changed = false
		for (const task of session.tasks) {
			if (this.isTaskTerminal(task)) {
				continue
			}
			mutateTaskRecord(
				task,
				toCancelledTask(
					task,
					cancelReason,
					i18n.t('chatbox.task.cancelledSummary', {
						task: task.label,
					}),
					Date.now(),
				),
			)
			this.resolveTaskCompletion(task.id, this.buildTaskToolPayload(task))
			this.cleanupTaskTracking(task.id)
			changed = true
		}
		return changed
	}

	private cleanupSessionTaskTracking(session: ChatSession) {
		for (const task of session.tasks) {
			this.cleanupTaskTracking(task.id)
		}
	}

	private async runTask(task: ChatTaskRecord) {
		const session = this.loadedSessions.get(task.sessionId)
		const selection = this.taskModelSelection.get(task.id)
		if (!session || !selection?.providerId || !selection.modelId) {
			this.finishTaskAsFailed(
				task,
				i18n.t('chatbox.errors.taskSessionUnavailable'),
				'session_invalid',
			)
			return
		}

		try {
			const provider = this.getProviderByIdOrThrow(selection.providerId)
			const model = this.getModelByIdsOrThrow(provider, selection.modelId)
			const result = await this.runBackgroundTaskLoop(
				task,
				session,
				provider,
				model,
			)

			if (task.status === 'cancelled') {
				return
			}

			if (result.status === 'completed') {
				this.finishTaskAsCompleted(
					task,
					result.summary || '',
					result.sourceCount,
				)
				return
			}
			if (result.status === 'cancelled') {
				this.finishTaskAsCancelled(task, 'user_cancelled')
				return
			}
			this.finishTaskAsFailed(
				task,
				result.error || i18n.t('chatbox.requestFailed'),
				result.failureStage,
				result.sourceCount,
			)
		} catch (error) {
			if (task.status === 'cancelled') {
				return
			}
			this.finishTaskAsFailed(
				task,
				error instanceof Error
					? error.message
					: i18n.t('chatbox.requestFailed'),
				'runtime_error',
			)
		}
	}

	private async runBackgroundTaskLoop(
		task: ChatTaskRecord,
		session: ChatSession,
		provider: AIProviderConfig,
		model: { id: string; name: string },
	): Promise<AgentRunResult> {
		const tools = this.createToolsForContext(
			session,
			task.depth,
			task.maxDepth,
			task.id,
		)
		const messages: AIMessage[] = [
			{
				role: 'system',
				content: toTextParts(
					createSubagentSystemPrompt(task.depth < task.maxDepth),
				),
			},
			{
				role: 'user',
				content: toTextParts(task.task),
			},
		]
		let sourceCount = 0
		let repeatState: ToolCallRepeatState = {
			consecutiveCount: 0,
			isRepeatedTooManyTimes: false,
		}

		while (true) {
			if (task.status === 'cancelled') {
				return {
					status: 'cancelled',
					sourceCount,
				}
			}

			const response = await generateAssistantTurn({
				provider,
				model: model.name,
				messages,
				tools,
			})
			messages.push(response.message)

			const assistantToolCalls = getAssistantToolCalls(response.message)
			if (!assistantToolCalls?.length) {
				return {
					status: 'completed',
					summary:
						messageToText(response.message).trim() ||
						i18n.t('chatbox.task.emptyResult'),
					sourceCount,
				}
			}

			repeatState = updateToolCallRepeatState(repeatState, assistantToolCalls)
			if (repeatState.isRepeatedTooManyTimes) {
				return {
					status: 'failed',
					error: i18n.t('chatbox.repeatedToolCallsStopped', {
						count: REPEATED_TOOL_CALL_THRESHOLD,
					}),
					failureStage: 'repeated_tool_calls',
					sourceCount,
				}
			}

			const toolMessages = await this.resolveToolCalls(
				assistantToolCalls,
				tools,
				{
					session,
					depth: task.depth,
					maxDepth: task.maxDepth,
					parentTaskId: task.id,
				},
			)

			for (const item of toolMessages) {
				messages.push(item.message)
				sourceCount += 1
			}
		}
	}

	private async resolveToolCalls(
		toolCalls: AIToolCall[],
		tools: AIToolDefinition[],
		context: AIToolExecutionContext,
	) {
		const results = await Promise.all(
			toolCalls.map((toolCall) =>
				this.resolveSingleToolCall(toolCall, tools, context),
			),
		)

		return toolCalls.map((toolCall, index) => ({
			message: {
				role: 'tool' as const,
				content: toTextParts(
				typeof results[index].payload === 'string'
					? results[index].payload
					: JSON.stringify(results[index].payload, null, 2),
			),
				name: toolCall.function.name,
				tool_call_id: toolCall.id,
			},
			isError: results[index].isError,
		}))
	}

	private async resolveSingleToolCall(
		toolCall: AIToolCall,
		tools: AIToolDefinition[],
		context: AIToolExecutionContext,
	): Promise<ResolvedToolResult> {
		if (toolCall.function.name === 'spawn') {
			const payload = await this.startSpawnedTask(
				toolCall.function.arguments || '{}',
				context,
			)
			return {
				payload,
				isError: payload.status !== 'completed',
			}
		}

		const payload = await this.executeToolCall(
			tools,
			toolCall.function.name,
			toolCall.function.arguments || '{}',
			context,
		)
		return {
			payload,
			isError: typeof payload === 'object' && !!payload.error,
		}
	}

	private startSpawnedTask(
		rawArgs: string,
		context: AIToolExecutionContext,
	): Promise<Record<string, unknown>> {
		try {
			const params = JSON.parse(rawArgs) as Record<string, unknown>
			const taskText = this.requireToolString(params.task, 'task')
			const label =
				typeof params.label === 'string' && params.label.trim()
					? params.label.trim()
					: undefined
			return this.spawnTask({
				task: taskText,
				label,
				parentTaskId: context.parentTaskId,
				depth: context.depth + 1,
				maxDepth: context.maxDepth,
				sessionId: context.session.id,
			})
		} catch (error) {
			return Promise.resolve({
				task_id: null,
				parent_task_id: context.parentTaskId ?? null,
				label: null,
				task: null,
				status: 'failed',
				result_summary: null,
				error_summary: error instanceof Error ? error.message : String(error),
				failure_stage: 'invalid_arguments',
				cancel_reason: null,
				depth: context.depth + 1,
				max_depth: context.maxDepth,
				started_at: null,
				finished_at: Date.now(),
				source_count: null,
			})
		}
	}

	private spawnTask(params: {
		task: string
		label?: string
		parentTaskId?: string
		depth: number
		maxDepth: number
		sessionId: string
	}) {
		const session = this.loadedSessions.get(params.sessionId)
		if (!session) {
			return Promise.resolve(
				this.buildImmediateTaskFailurePayload(
					params,
					i18n.t('chatbox.errors.sessionNotFound'),
					'session_invalid',
				),
			)
		}
		if (params.depth > params.maxDepth) {
			return Promise.resolve(
				this.buildImmediateTaskFailurePayload(
					params,
					i18n.t('chatbox.errors.taskDepthExceeded'),
					'depth_limit',
				),
			)
		}

		const shouldQueue =
			this.countRunningTasksForSession(session) >=
			MAX_CONCURRENT_TASKS_PER_SESSION

		const taskId = createId('task')
		const taskBase = {
			id: taskId,
			sessionId: session.id,
			parentTaskId: params.parentTaskId,
			depth: params.depth,
			maxDepth: params.maxDepth,
			label: params.label || params.task.slice(0, 48),
			task: params.task,
			createdAt: Date.now(),
		}
		const task: ChatTaskRecord = shouldQueue
			? createQueuedTask(taskBase)
			: createRunningTask(taskBase, Date.now())
		const deferred = this.createDeferredTaskCompletion()

		session.tasks = [task, ...session.tasks]
		this.taskModelSelection.set(task.id, {
			providerId: session.providerId,
			modelId: session.modelId,
		})
		this.pendingTaskCompletions.set(task.id, deferred)
		void this.persistSession(session)
		this.notify()

		if (shouldQueue) {
			this.startQueuedTasksForSession(session)
		} else {
			void this.runTask(task)
		}

		return deferred.promise
	}

	private finishTaskAsCompleted(
		task: ChatTaskRecord,
		summary: string,
		sourceCount: number,
	) {
		if (task.status !== 'running') {
			return
		}
		mutateTaskRecord(
			task,
			toCompletedTask(
				task,
				summary || i18n.t('chatbox.task.emptyResult'),
				sourceCount,
				Date.now(),
			),
		)
		const session = this.loadedSessions.get(task.sessionId)
		if (session) {
			void this.persistSession(session)
		}
		this.notify()
		this.resolveTaskCompletion(task.id, this.buildTaskToolPayload(task))
		this.cleanupTaskTracking(task.id)
		if (session) {
			this.startQueuedTasksForSession(session)
		}
	}

	private finishTaskAsFailed(
		task: ChatTaskRecord,
		message: string,
		failureStage?: string,
		sourceCount?: number,
	) {
		if (task.status !== 'queued' && task.status !== 'running') {
			return
		}
		mutateTaskRecord(
			task,
			toFailedTask(
				task,
				message,
				message,
				Date.now(),
				failureStage,
				sourceCount,
			),
		)
		const session = this.loadedSessions.get(task.sessionId)
		if (session) {
			void this.persistSession(session)
		}
		this.notify()
		this.resolveTaskCompletion(task.id, this.buildTaskToolPayload(task))
		this.cleanupTaskTracking(task.id)
		if (session) {
			this.startQueuedTasksForSession(session)
		}
	}

	private finishTaskAsCancelled(task: ChatTaskRecord, cancelReason: string) {
		if (task.status === 'queued' || task.status === 'running') {
			mutateTaskRecord(
				task,
				toCancelledTask(
					task,
					cancelReason,
					i18n.t('chatbox.task.cancelledSummary', {
						task: task.label,
					}),
					Date.now(),
				),
			)
		}
		const session = this.loadedSessions.get(task.sessionId)
		if (session) {
			void this.persistSession(session)
		}
		this.notify()
		this.resolveTaskCompletion(task.id, this.buildTaskToolPayload(task))
		this.cleanupTaskTracking(task.id)
		if (session) {
			this.startQueuedTasksForSession(session)
		}
	}

	private countRunningTasksForSession(session: ChatSession) {
		return session.tasks.filter((item) => item.status === 'running').length
	}

	private startQueuedTasksForSession(session: ChatSession) {
		if (this.deletedSessionIds.has(session.id)) {
			return
		}
		while (
			this.countRunningTasksForSession(session) <
			MAX_CONCURRENT_TASKS_PER_SESSION
		) {
			const nextTask = session.tasks
				.filter((item) => item.status === 'queued')
				.sort((left, right) => left.createdAt - right.createdAt)[0]

			if (!nextTask) {
				return
			}

			mutateTaskRecord(
				nextTask,
				toRunningTask(nextTask as QueuedChatTask, Date.now()),
			)
			void this.persistSession(session)
			this.notify()
			void this.runTask(nextTask)
		}
	}

	private createToolsForContext(
		session: ChatSession,
		depth: number,
		maxDepth: number,
		parentTaskId?: string,
	) {
		const allowSpawn = depth < maxDepth
		return createAITools(this.plugin.app, {
			allowSpawn,
			spawnTask: async (params) => ({
				task_id: null,
				parent_task_id: parentTaskId || params.parentTaskId || null,
				label: params.label || params.task.slice(0, 48),
				task: params.task,
				status: 'running',
				depth: params.depth,
				max_depth: params.maxDepth,
				async: true,
			}),
		})
	}

	private async executeToolCall(
		tools: AIToolDefinition[],
		name: string,
		args: string,
		context: AIToolExecutionContext,
	) {
		const tool = new Map(tools.map((item) => [item.name, item])).get(name)
		let result: string | Record<string, unknown>

		try {
			if (!tool) {
				throw new Error(
					i18n.t('chatbox.errors.unknownTool', {
						name,
					}),
				)
			}
			const parsedArgs = JSON.parse(args) as Record<string, unknown>
			const params = tool.inputSchema.parse(parsedArgs)
			result = await tool.execute(params, context)
		} catch (error) {
			logger.error(error)
			result = {
				error: error instanceof Error ? error.message : String(error),
			}
		}

		return result
	}

	private buildMessagesForFragment(fragment: ChatFragment): AIMessage[] {
		return [
			{
				role: 'system',
				content: toTextParts(createMainSystemPrompt(MAX_TASK_DEPTH)),
			},
			...fragment.messages.map((item) => item.message),
		]
	}

	private removeUnmatchedToolCalls(fragment: ChatFragment) {
		const resolvedToolCallIds = new Set(
			fragment.messages.flatMap((item) =>
				item.message.role === 'tool' && item.message.tool_call_id
					? [item.message.tool_call_id]
					: [],
			),
		)

		fragment.messages = fragment.messages.filter((record) => {
			if (
				record.message.role !== 'assistant' ||
				!record.message.tool_calls?.length
			) {
				return true
			}

			const nextToolCalls = record.message.tool_calls.filter((toolCall) =>
				resolvedToolCallIds.has(toolCall.id),
			)
			const hasText = !!messageToText(record.message).trim()
			if (!hasText && nextToolCalls.length === 0) {
				return false
			}

			record.message =
				nextToolCalls.length > 0
					? {
							role: 'assistant',
							content: hasText
								? record.message.content || toTextParts('')
								: null,
							tool_calls: nextToolCalls,
						}
					: {
							role: 'assistant',
							content: record.message.content || toTextParts(''),
						}
			return true
		})
	}

	private buildTaskToolPayload(task: ChatTaskRecord) {
		return {
			task_id: task.id,
			parent_task_id: task.parentTaskId ?? null,
			label: task.label,
			task: task.task,
			status: task.status,
			result_summary:
				task.status === 'completed' ? (task.summary ?? null) : null,
			error_summary:
				task.status === 'failed' ? task.error || task.summary || null : null,
			failure_stage:
				task.status === 'failed' ? (task.failureStage ?? null) : null,
			cancel_reason:
				task.status === 'cancelled' ? (task.cancelReason ?? null) : null,
			depth: task.depth,
			max_depth: task.maxDepth,
			started_at: 'startedAt' in task ? (task.startedAt ?? null) : null,
			finished_at: 'finishedAt' in task ? (task.finishedAt ?? null) : null,
			source_count:
				task.status === 'completed'
					? task.sourceCount
					: task.status === 'failed'
						? (task.sourceCount ?? null)
						: null,
		}
	}

	private buildImmediateTaskFailurePayload(
		params: {
			task: string
			label?: string
			parentTaskId?: string
			depth: number
			maxDepth: number
		},
		message: string,
		failureStage: string,
	) {
		return {
			task_id: null,
			parent_task_id: params.parentTaskId ?? null,
			label: params.label || params.task.slice(0, 48),
			task: params.task,
			status: 'failed',
			result_summary: null,
			error_summary: message,
			failure_stage: failureStage,
			cancel_reason: null,
			depth: params.depth,
			max_depth: params.maxDepth,
			started_at: null,
			finished_at: Date.now(),
			source_count: null,
		}
	}

	private createDeferredTaskCompletion(): DeferredTaskCompletion {
		let resolve!: (payload: Record<string, unknown>) => void
		const deferred: DeferredTaskCompletion = {
			promise: new Promise<Record<string, unknown>>((nextResolve) => {
				resolve = nextResolve
			}),
			resolve: (payload) => {
				deferred.settled = true
				resolve(payload)
			},
			settled: false,
		}
		return deferred
	}

	private resolveTaskCompletion(
		taskId: string,
		payload: Record<string, unknown>,
	) {
		const deferred = this.pendingTaskCompletions.get(taskId)
		if (!deferred || deferred.settled) {
			return
		}
		deferred.resolve(payload)
		this.pendingTaskCompletions.delete(taskId)
	}

	private cleanupTaskTracking(taskId: string) {
		this.pendingTaskCompletions.delete(taskId)
		this.taskModelSelection.delete(taskId)
	}

	private requireToolString(value: unknown, field: string) {
		if (typeof value !== 'string' || !value.trim()) {
			throw new Error(i18n.t('chatbox.errors.toolFieldRequired', { field }))
		}
		return value.trim()
	}

	private isTaskTerminal(task: ChatTaskRecord) {
		return isTerminalTask(task)
	}

	private isTaskDescendantOf(
		session: ChatSession,
		task: ChatTaskRecord,
		ancestorTaskId: string,
	): boolean {
		let currentParentId = task.parentTaskId
		while (currentParentId) {
			if (currentParentId === ancestorTaskId) {
				return true
			}
			currentParentId = session.tasks.find(
				(item) => item.id === currentParentId,
			)?.parentTaskId
		}
		return false
	}

	private getProviderOrThrow(session: ChatSession) {
		const provider = getProviderById(
			this.plugin.settings.providers,
			session.providerId,
		)
		if (!provider) {
			throw new Error(i18n.t('chatbox.errors.noProvider'))
		}
		assertProviderUsable(provider)
		return provider
	}

	private getProviderByIdOrThrow(providerId: string) {
		const provider = getProviderById(this.plugin.settings.providers, providerId)
		if (!provider) {
			throw new Error(i18n.t('chatbox.errors.noProvider'))
		}
		assertProviderUsable(provider)
		return provider
	}

	private getModelOrThrow(provider: AIProviderConfig, session: ChatSession) {
		const model = getModelById(provider, session.modelId)
		if (!model) {
			throw new Error(i18n.t('chatbox.errors.noModel'))
		}
		return model
	}

	private getModelByIdsOrThrow(provider: AIProviderConfig, modelId: string) {
		const model = getModelById(provider, modelId)
		if (!model) {
			throw new Error(i18n.t('chatbox.errors.noModel'))
		}
		return model
	}

	private createEmptySession(): ChatSession {
		const { providerId, modelId } = this.getInitialSelectionForNewSession()
		const fragment: ChatFragment = {
			id: createId('fragment'),
			createdAt: Date.now(),
			messages: [],
		}

		return {
			id: createId('session'),
			createdAt: Date.now(),
			title: i18n.t('chatbox.newChat'),
			providerId,
			modelId,
			fragments: [fragment],
			activeFragmentId: fragment.id,
			tasks: [],
		}
	}

	private createMessageRecord(
		message: AIMessage,
		meta?: ChatMessageRecord['meta'],
	): ChatMessageRecord {
		return {
			id: createId('message'),
			createdAt: Date.now(),
			message,
			meta,
		}
	}

	private sanitizeSessionSelection(session: ChatSession) {
		const provider = getProviderById(
			this.plugin.settings.providers,
			session.providerId,
		)
		if (!provider) {
			if (!session.providerId && !session.modelId) {
				return false
			}
			session.providerId = undefined
			session.modelId = undefined
			return true
		}

		const nextModelId =
			getModelById(provider, session.modelId)?.id || provider.models[0]?.id
		const changed =
			session.providerId !== provider.id || session.modelId !== nextModelId
		session.providerId = provider.id
		session.modelId = nextModelId
		return changed
	}

	private getInitialSelectionForNewSession() {
		const emptyStateSelection = this.getEmptyStateSelection()
		return {
			providerId: emptyStateSelection.providerId,
			modelId: emptyStateSelection.modelId,
		}
	}

	private getEmptyStateSelection() {
		const defaults = resolveInitialSelection(
			this.plugin.settings.providers,
			this.plugin.settings.defaultProviderId,
			this.plugin.settings.defaultModelId,
		)
		const provider =
			getProviderById(this.plugin.settings.providers, this.pendingProviderId) ||
			getProviderById(this.plugin.settings.providers, defaults.providerId)
		const model =
			getModelById(provider, this.pendingModelId) ||
			getModelById(provider, defaults.modelId) ||
			provider?.models[0]

		return {
			providerId: provider?.id,
			modelId: model?.id,
		}
	}

	private syncPendingSelectionWithSettings() {
		const normalized = this.getEmptyStateSelection()
		this.pendingProviderId = normalized.providerId
		this.pendingModelId = normalized.modelId
	}

	private findLoadedSessionByTaskId(taskId: string) {
		for (const session of this.loadedSessions.values()) {
			if (session.tasks.some((task) => task.id === taskId)) {
				return session
			}
		}
		return undefined
	}

	private notify() {
		for (const listener of this.listeners) {
			listener()
		}
	}

	private validateSessionSelection(session: ChatSession) {
		try {
			const provider = this.getProviderOrThrow(session)
			this.getModelOrThrow(provider, session)
			return true
		} catch (error) {
			const message =
				error instanceof Error ? error.message : i18n.t('chatbox.requestFailed')
			logger.error(error)
			new Notice(message)
			return false
		}
	}

	private reportFatalError(
		session: ChatSession,
		message: string,
		meta?: ChatMessageRecord['meta'],
		fragment: ChatFragment = this.getActiveFragment(session),
	) {
		logger.error(message)
		new Notice(message)
		fragment.messages.push(
			this.createMessageRecord(
				{
					role: 'assistant',
					content: toTextParts(message),
				},
				{
					...meta,
					isError: true,
				},
			),
		)
		this.notify()
	}
}
