import {
	For,
	Match,
	Show,
	Switch,
	createEffect,
	createSignal,
	onCleanup,
} from 'solid-js'
import { t } from './i18n'
import type {
	ChatTimelineFragmentItem,
	ChatTimelineMessageItem,
	ChatboxProps,
} from './types'
import { MessageCard } from './components/MessageCard'
import { TasksPanel } from './components/TasksPanel'
import { RunStateCard } from './components/RunStateCard'
import { PendingList } from './components/PendingList'
import { FragmentDivider } from './components/FragmentDivider'
import { SessionHistoryItem } from './components/SessionHistoryItem'
import { ConfirmDialog } from './components/ConfirmDialog'

export type AppProps = ChatboxProps

function App(props: AppProps) {
	const [input, setInput] = createSignal('')
	const [isComposing, setIsComposing] = createSignal(false)
	const [historyOpen, setHistoryOpen] = createSignal(false)
	const [tasksOpen, setTasksOpen] = createSignal(false)
	const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
	const [sessionPendingDeleteId, setSessionPendingDeleteId] =
		createSignal<string>()
	const [pendingDeleteMessage, setPendingDeleteMessage] =
		createSignal<ChatTimelineMessageItem>()
	const [deleteConfirmSkipped, setDeleteConfirmSkipped] = createSignal(
		new Set<string>(),
	)
	const [deleteConfirmSkipChecked, setDeleteConfirmSkipChecked] =
		createSignal(false)
	const [pendingRegenerateMessage, setPendingRegenerateMessage] =
		createSignal<ChatTimelineMessageItem>()
	const [regenerateConfirmSkipped, setRegenerateConfirmSkipped] =
		createSignal(false)
	const [regenerateConfirmSkipChecked, setRegenerateConfirmSkipChecked] =
		createSignal(false)
	const [pendingRecallMessage, setPendingRecallMessage] =
		createSignal<ChatTimelineMessageItem>()
	const [recallConfirmSkipped, setRecallConfirmSkipped] = createSignal(false)
	const [recallConfirmSkipChecked, setRecallConfirmSkipChecked] =
		createSignal(false)
	let messagesEl: HTMLDivElement | undefined
	let historyEl: HTMLDivElement | undefined
	let modelPickerEl: HTMLDivElement | undefined
	let previousActiveSessionId = props.activeSessionId

	const hasTasks = () =>
		props.currentSessionTasks.length + props.otherSessionTasks.length > 0
	const runningTaskCount = () =>
		props.currentSessionTasks.filter((task) => task.status === 'running')
			.length +
		props.otherSessionTasks.filter((task) => task.status === 'running').length
	const isBusy = () => props.runState !== 'idle'
	const selectedProvider = () =>
		props.providers.find((provider) => provider.id === props.selectedProviderId)
	const modelPickerLabel = () => {
		const provider = selectedProvider()
		const selectedModel = provider?.models.find(
			(model) => model.id === props.selectedModelId,
		)
		return (
			[provider?.name, selectedModel?.name].filter(Boolean).join('/') ||
			t('noModel')
		)
	}

	function scrollMessagesToBottom(behavior: ScrollBehavior = 'smooth') {
		requestAnimationFrame(() => {
			if (!messagesEl) {
				return
			}
			messagesEl.scrollTo({
				top: messagesEl.scrollHeight,
				behavior,
			})
		})
	}

	createEffect(() => {
		const activeSessionId = props.activeSessionId
		props.timeline.length
		props.currentSessionTasks.length
		props.otherSessionTasks.length
		props.pendingMessages.length
		props.runState
		const behavior =
			previousActiveSessionId !== activeSessionId ? 'auto' : 'smooth'
		previousActiveSessionId = activeSessionId
		scrollMessagesToBottom(behavior)
	})

	createEffect(() => {
		if (!hasTasks() && tasksOpen()) {
			setTasksOpen(false)
		}
	})

	createEffect(() => {
		if (!historyOpen() && !modelPickerOpen()) {
			return
		}

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target
			if (!(target instanceof Node)) {
				return
			}
			if (historyEl?.contains(target) || modelPickerEl?.contains(target)) {
				return
			}
			setHistoryOpen(false)
			setModelPickerOpen(false)
		}

		document.addEventListener('pointerdown', onPointerDown)
		onCleanup(() => document.removeEventListener('pointerdown', onPointerDown))
	})

	async function submit() {
		const text = input().trim()
		if (!text || !props.canSend) {
			return
		}
		setInput('')
		scrollMessagesToBottom('auto')
		await props.onSendMessage(text)
	}

	async function confirmDeleteSession() {
		const sessionId = sessionPendingDeleteId()
		if (!sessionId) {
			return
		}
		setSessionPendingDeleteId(undefined)
		await props.onDeleteSession(sessionId)
	}

	const requestDeleteMessage = props.onDeleteMessage
		? (messageId: string) => {
				const item = props.timeline.find(
					(i): i is ChatTimelineMessageItem =>
						i.kind === 'message' && i.message.id === messageId,
				)
				if (!item) return
				if (deleteConfirmSkipped().has(item.message.message.role)) {
					props.onDeleteMessage?.(messageId)
				} else {
					setDeleteConfirmSkipChecked(false)
					setPendingDeleteMessage(item)
				}
			}
		: undefined

	const requestRegenerateMessage = props.onRegenerateMessage
		? (messageId: string) => {
				if (regenerateConfirmSkipped()) {
					props.onRegenerateMessage?.(messageId)
				} else {
					const item = props.timeline.find(
						(i): i is ChatTimelineMessageItem =>
							i.kind === 'message' && i.message.id === messageId,
					)
					if (!item) return
					setRegenerateConfirmSkipChecked(false)
					setPendingRegenerateMessage(item)
				}
			}
		: undefined

	const requestRecallMessage = props.onRecallMessage
		? (messageId: string) => {
				const item = props.timeline.find(
					(i): i is ChatTimelineMessageItem =>
						i.kind === 'message' && i.message.id === messageId,
				)
				if (!item) return
				if (recallConfirmSkipped()) {
					doRecallMessage(item)
				} else {
					setRecallConfirmSkipChecked(false)
					setPendingRecallMessage(item)
				}
			}
		: undefined

	function doRecallMessage(item: ChatTimelineMessageItem) {
		const text = (item.message.message.content ?? [])
			.filter((p) => p.type === 'text')
			.map((p) => (p as { type: 'text'; text: string }).text)
			.join('\n')
		setInput(text)
		props.onRecallMessage?.(item.message.id)
	}

	function confirmRecallMessage() {
		const item = pendingRecallMessage()
		if (!item) return
		if (recallConfirmSkipChecked()) {
			setRecallConfirmSkipped(true)
		}
		setPendingRecallMessage(undefined)
		doRecallMessage(item)
	}

	function confirmRegenerateMessage() {
		const item = pendingRegenerateMessage()
		if (!item) return
		if (regenerateConfirmSkipChecked()) {
			setRegenerateConfirmSkipped(true)
		}
		setPendingRegenerateMessage(undefined)
		props.onRegenerateMessage?.(item.message.id)
	}

	function confirmDeleteMessage() {
		const item = pendingDeleteMessage()
		if (!item) return
		if (deleteConfirmSkipChecked()) {
			setDeleteConfirmSkipped((prev) => {
				const next = new Set(prev)
				next.add(item.message.message.role)
				return next
			})
		}
		setPendingDeleteMessage(undefined)
		props.onDeleteMessage?.(item.message.id)
	}

	const deleteMessageConfirmText = () => {
		const item = pendingDeleteMessage()
		if (!item) return ''
		switch (item.message.message.role) {
			case 'user':
				return t('deleteUserMessageConfirm')
			case 'tool':
				return t('deleteToolMessageConfirm')
			default:
				return t('deleteAssistantMessageConfirm')
		}
	}

	return (
		<div class="relative flex h-full overflow-hidden bg-[var(--background-primary)] text-[var(--text-normal)]">
			<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
				{/* Header */}
				<div class="relative flex shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3 py-3">
					<button
						type="button"
						onClick={() => {
							setHistoryOpen((value) => !value)
							setModelPickerOpen(false)
						}}
					>
						{t('history')}
					</button>
					<div class="min-w-0 flex-1 truncate text-sm font-semibold">
						{props.title || t('newChat')}
					</div>
					<Show when={hasTasks()}>
						<button
							class="mod-cta"
							type="button"
							onClick={() => setTasksOpen((value) => !value)}
						>
							{t('tasks')} ({runningTaskCount()})
						</button>
					</Show>
					<div class="relative" ref={modelPickerEl}>
						<button
							class="max-w-56 min-w-34 rounded-2 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3 py-2 text-left text-sm hover:bg-[var(--background-modifier-hover)]"
							type="button"
							onClick={() => {
								setModelPickerOpen((value) => !value)
								setHistoryOpen(false)
							}}
						>
							<div class="truncate">{modelPickerLabel()}</div>
						</button>
						<Show when={modelPickerOpen()}>
							<div class="absolute right-0 top-12 z-10 w-72 rounded-3 border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-3 shadow-lg">
								<div class="mb-2 text-xs text-[var(--text-muted)]">
									{t('provider')}
								</div>
								<select
									class="w-full"
									value={props.selectedProviderId || ''}
									onChange={(event) =>
										props.onSelectProvider(event.currentTarget.value)
									}
								>
									<option value="">{t('noProvider')}</option>
									<For each={props.providers}>
										{(provider) => (
											<option value={provider.id}>{provider.name}</option>
										)}
									</For>
								</select>
								<div class="mb-2 mt-3 text-xs text-[var(--text-muted)]">
									{t('model')}
								</div>
								<select
									class="w-full"
									value={props.selectedModelId || ''}
									disabled={!selectedProvider()?.models.length || isBusy()}
									onChange={(event) => {
										props.onSelectModel(event.currentTarget.value)
										setModelPickerOpen(false)
									}}
								>
									<option value="">{t('noModel')}</option>
									<For each={selectedProvider()?.models || []}>
										{(model) => <option value={model.id}>{model.name}</option>}
									</For>
								</select>
							</div>
						</Show>
					</div>
					<Show when={historyOpen()}>
						<div
							ref={historyEl}
							class="absolute left-3 top-12 z-10 w-80 overflow-hidden rounded-4 border border-[var(--background-modifier-border)] bg-[var(--background-primary)] shadow-lg"
						>
							<div class="border-b border-[var(--background-modifier-border)] px-4 py-3">
								<div class="flex items-center justify-between gap-3">
									<div class="min-w-0">
										<div class="text-sm font-semibold text-[var(--text-normal)]">
											{t('history')}
										</div>
									</div>
									<button
										class="rounded-2 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3 py-2 text-sm hover:bg-[var(--background-modifier-hover)]"
										type="button"
										onClick={() => {
											props.onNewSession()
											setHistoryOpen(false)
										}}
									>
										{t('newChat')}
									</button>
								</div>
							</div>
							<div class="max-h-80 overflow-auto p-3 scrollbar-default">
								<div class="flex flex-col gap-2">
									<For each={props.sessionHistory}>
										{(session) => (
											<SessionHistoryItem
												session={session}
												isActive={session.id === props.activeSessionId}
												onSelect={(sessionId) => {
													props.onSwitchSession(sessionId)
													setHistoryOpen(false)
												}}
												onDelete={(sessionId) => {
													setSessionPendingDeleteId(sessionId)
												}}
											/>
										)}
									</For>
								</div>
							</div>
						</div>
					</Show>
				</div>

				{/* Messages */}
				<div
					ref={messagesEl}
					class="flex-1 overflow-y-auto px-3 scrollbar-default"
				>
					<Show
						when={
							props.timeline.length > 0 ||
							props.pendingMessages.length > 0 ||
							isBusy()
						}
						fallback={
							<div class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
								{t('empty')}
							</div>
						}
					>
						<div class="flex flex-col gap-3">
							<For each={props.timeline}>
								{(item) => (
									<Switch>
										<Match when={item.kind === 'fragment'}>
											<FragmentDivider
												item={item as ChatTimelineFragmentItem}
											/>
										</Match>
										<Match when={item.kind === 'message'}>
											<MessageCard
												item={item as ChatTimelineMessageItem}
												renderMarkdown={props.renderMarkdown}
												onDeleteMessage={requestDeleteMessage}
												onRegenerateMessage={requestRegenerateMessage}
												onRecallMessage={requestRecallMessage}
											/>
										</Match>
									</Switch>
								)}
							</For>
							<RunStateCard
								runState={props.runState}
								onStop={props.onStopActiveRun}
							/>
							<PendingList pendingMessages={props.pendingMessages} />
						</div>
					</Show>
				</div>

				{/* Input */}
				<div class="shrink-0 border-t border-[var(--background-modifier-border)] px-3 py-3">
					<textarea
						class="chatbox-input w-full resize-none rounded-3 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] text-sm outline-none"
						placeholder={t('inputPlaceholder')}
						value={input()}
						onInput={(event) => setInput(event.currentTarget.value)}
						onCompositionStart={() => setIsComposing(true)}
						onCompositionEnd={() => setIsComposing(false)}
						onKeyDown={(event) => {
							if (
								event.key === 'Enter' &&
								!event.shiftKey &&
								!isComposing() &&
								!event.isComposing &&
								event.keyCode !== 229
							) {
								event.preventDefault()
								void submit()
							}
						}}
					/>
					<div class="mt-3 flex items-center justify-between gap-3">
						<div class="flex flex-wrap items-center gap-2">
							<button
								class="chatbox-tag-button"
								type="button"
								disabled={!props.canCreateFragment}
								onClick={() => props.onNewFragment()}
							>
								{t('newFragment')}
							</button>
							<button
								class="chatbox-tag-button"
								type="button"
								disabled={!props.canCompress}
								onClick={() => void props.onCompressContext()}
							>
								{t('compressContext')}
							</button>
						</div>
						<button
							class="mod-cta"
							type="button"
							disabled={!input().trim()}
							onClick={() => void submit()}
						>
							{isBusy() ? t('queueSend') : t('send')}
						</button>
					</div>
				</div>
			</div>

			{/* Tasks sidebar */}
			<Show when={tasksOpen()}>
				<TasksPanel
					currentSessionTasks={props.currentSessionTasks}
					otherSessionTasks={props.otherSessionTasks}
					onCancelTask={props.onCancelTask}
					onClose={() => setTasksOpen(false)}
				/>
			</Show>

			{/* Delete session dialog */}
			<Show when={sessionPendingDeleteId()}>
				<ConfirmDialog
					title={t('deleteSessionTitle')}
					message={t('deleteSessionMessage')}
					confirmLabel={t('confirmDelete')}
					onCancel={() => setSessionPendingDeleteId(undefined)}
					onConfirm={() => void confirmDeleteSession()}
				/>
			</Show>

			{/* Delete message dialog */}
			<Show when={pendingDeleteMessage()}>
				<ConfirmDialog
					title={t('deleteMessageTitle')}
					message={deleteMessageConfirmText()}
					confirmLabel={t('confirmDelete')}
					skipLabel={t('deleteMessageSkipConfirm')}
					skipChecked={deleteConfirmSkipChecked()}
					onSkipChange={setDeleteConfirmSkipChecked}
					onCancel={() => setPendingDeleteMessage(undefined)}
					onConfirm={confirmDeleteMessage}
				/>
			</Show>

			{/* Regenerate message dialog */}
			<Show when={pendingRegenerateMessage()}>
				<ConfirmDialog
					title={t('regenerateMessageTitle')}
					message={t('regenerateMessageConfirm')}
					confirmLabel={t('regenerateMessage')}
					skipLabel={t('regenerateMessageSkipConfirm')}
					skipChecked={regenerateConfirmSkipChecked()}
					onSkipChange={setRegenerateConfirmSkipChecked}
					onCancel={() => setPendingRegenerateMessage(undefined)}
					onConfirm={confirmRegenerateMessage}
				/>
			</Show>

			{/* Recall message dialog */}
			<Show when={pendingRecallMessage()}>
				<ConfirmDialog
					title={t('recallMessageTitle')}
					message={t('recallMessageConfirm')}
					confirmLabel={t('confirmRecall')}
					skipLabel={t('recallMessageSkipConfirm')}
					skipChecked={recallConfirmSkipChecked()}
					onSkipChange={setRecallConfirmSkipChecked}
					onCancel={() => setPendingRecallMessage(undefined)}
					onConfirm={confirmRecallMessage}
				/>
			</Show>
		</div>
	)
}

export default App
