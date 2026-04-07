import { For, Match, Show, Switch, createEffect, createSignal, onCleanup } from 'solid-js'
import { t } from './i18n'
import {
	ChatMessageContentPart,
	ChatTaskRecord,
	ChatTimelineFragmentItem,
	ChatTimelineMessageItem,
	ChatboxProps,
} from './types'

export type AppProps = ChatboxProps

function formatTime(timestamp: number) {
	return new Intl.DateTimeFormat(undefined, {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(timestamp)
}

function formatDuration(task: ChatTaskRecord) {
	if (!('startedAt' in task) || typeof task.startedAt !== 'number') {
		return ''
	}
	const end = 'finishedAt' in task && typeof task.finishedAt === 'number'
		? task.finishedAt
		: Date.now()
	const totalSeconds = Math.max(0, Math.floor((end - task.startedAt) / 1000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`
	}
	return `${seconds}s`
}

function formatUsage(
	input?: number,
	output?: number,
	total?: number,
) {
	const parts = []
	if (typeof input === 'number') {
		parts.push(`in ${input}`)
	}
	if (typeof output === 'number') {
		parts.push(`out ${output}`)
	}
	if (typeof total === 'number') {
		parts.push(`total ${total}`)
	}
	return parts.join(' · ')
}

function statusLabel(status: ChatTaskRecord['status']) {
	switch (status) {
		case 'queued':
			return t('taskQueued')
		case 'running':
			return t('taskRunning')
		case 'completed':
			return t('taskCompleted')
		case 'failed':
			return t('taskFailed')
		case 'cancelled':
			return t('taskCancelled')
	}
}

function statusClass(status: ChatTaskRecord['status']) {
	switch (status) {
		case 'running':
			return 'bg-[var(--color-green-rgb)]/12 text-[var(--text-accent)]'
		case 'completed':
			return 'bg-[var(--color-cyan-rgb)]/12 text-[var(--text-normal)]'
		case 'failed':
			return 'bg-[var(--color-red-rgb)]/12 text-[var(--text-error)]'
		case 'cancelled':
			return 'bg-[var(--background-secondary)] text-[var(--text-muted)]'
		default:
			return 'bg-[var(--background-secondary)] text-[var(--text-normal)]'
	}
}

function runStateLabel(runState: AppProps['runState']) {
	switch (runState) {
		case 'thinking':
			return t('thinking')
		case 'compressing':
			return t('compressing')
		case 'waiting_for_tools':
			return t('processingTools')
		default:
			return ''
	}
}

function MarkdownContent(props: {
	markdown: string
	renderMarkdown?: AppProps['renderMarkdown']
}) {
	let el: HTMLDivElement | undefined
	let cleanup: (() => void) | undefined
	let renderVersion = 0

	createEffect(() => {
		const markdown = props.markdown
		const renderMarkdown = props.renderMarkdown
		const currentVersion = ++renderVersion

		cleanup?.()
		cleanup = undefined

		if (!el) {
			return
		}

		el.replaceChildren()

		if (!markdown) {
			return
		}

		if (!renderMarkdown) {
			el.textContent = markdown
			return
		}

		void Promise.resolve(renderMarkdown(el, markdown)).then((nextCleanup) => {
			if (currentVersion !== renderVersion) {
				if (typeof nextCleanup === 'function') {
					nextCleanup()
				}
				return
			}
			cleanup = typeof nextCleanup === 'function' ? nextCleanup : undefined
		})
	})

	onCleanup(() => {
		renderVersion += 1
		cleanup?.()
		cleanup = undefined
		el?.replaceChildren()
	})

	return <div ref={el} class="markdown-rendered mt-2 text-sm leading-6 text-[var(--text-normal)]" />
}

function ContentParts(props: {
	content?: ChatMessageContentPart[] | null
	renderMarkdown?: AppProps['renderMarkdown']
}) {
	return (
		<Show when={props.content?.length}>
			<div class="mt-2 flex flex-col gap-3">
				<For each={props.content || []}>
					{(part) => (
						<Switch>
							<Match when={part.type === 'text'}>
								<MarkdownContent
									markdown={(part as Extract<ChatMessageContentPart, { type: 'text' }>).text}
									renderMarkdown={props.renderMarkdown}
								/>
							</Match>
							<Match when={part.type === 'image_url'}>
								<img
									class="max-h-80 max-w-full rounded-2 border border-[var(--background-modifier-border)] object-contain"
									src={(part as Extract<ChatMessageContentPart, { type: 'image_url' }>).image_url.url}
									alt=""
								/>
							</Match>
							<Match when={part.type === 'unknown'}>
								<pre class="m-0 whitespace-pre-wrap break-words rounded-2 bg-[var(--background-secondary)] p-2 text-xs leading-5">
									{JSON.stringify(
										(part as Extract<ChatMessageContentPart, { type: 'unknown' }>).value,
										null,
										2,
									)}
								</pre>
							</Match>
						</Switch>
					)}
				</For>
			</div>
		</Show>
	)
}

function TaskCard(props: {
	task: ChatTaskRecord
	onCancelTask?: AppProps['onCancelTask']
	compact?: boolean
}) {
	const duration = () => formatDuration(props.task)
	const detail = () => {
		switch (props.task.status) {
			case 'completed':
				return props.task.summary
			case 'failed':
				return props.task.summary || props.task.error
			case 'cancelled':
				return props.task.summary
			default:
				return ''
		}
	}
	const sourceCount = () =>
		props.task.status === 'completed'
			? props.task.sourceCount
			: props.task.status === 'failed'
				? props.task.sourceCount
				: undefined

	return (
		<div
			class={`rounded-3 border p-3 ${
				props.task.status === 'failed'
					? 'border-[var(--text-error)] bg-[var(--background-primary-alt)]'
					: 'border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)]'
			}`}
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 flex-1">
					<div class="font-medium text-[var(--text-normal)] truncate">{props.task.label}</div>
					<div class="mt-1 text-xs text-[var(--text-muted)] break-words">{props.task.task}</div>
				</div>
				<span class={`shrink-0 rounded-full px-2 py-1 text-xs ${statusClass(props.task.status)}`}>
					{statusLabel(props.task.status)}
				</span>
			</div>
			<div class="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
				<span class="rounded-full bg-[var(--background-secondary)] px-2 py-1">
					{t('depth')}: {props.task.depth}/{props.task.maxDepth}
				</span>
				<Show when={duration()}>
					<span class="rounded-full bg-[var(--background-secondary)] px-2 py-1">
						{duration()}
					</span>
				</Show>
				<Show when={typeof sourceCount() === 'number'}>
					<span class="rounded-full bg-[var(--background-secondary)] px-2 py-1">
						{t('sources')}: {sourceCount()}
					</span>
				</Show>
			</div>
			<Show when={detail()}>
				<div class="mt-3 rounded-2 bg-[var(--background-secondary)] p-3 text-sm leading-6 text-[var(--text-normal)] whitespace-pre-wrap break-words">
					{detail()}
				</div>
			</Show>
			<Show when={!props.compact}>
				<div class="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
					<div>
						{formatTime(props.task.createdAt)}
						<Show when={'finishedAt' in props.task && props.task.finishedAt}>
							{` · ${formatTime((props.task as Extract<ChatTaskRecord, { finishedAt: number }>).finishedAt)}`}
						</Show>
					</div>
					<Show when={props.task.status === 'running' && props.onCancelTask}>
						<button
							class="rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs hover:bg-[var(--background-modifier-hover)]"
							type="button"
							onClick={() => props.onCancelTask?.(props.task.id)}
						>
							{t('cancelTask')}
						</button>
					</Show>
				</div>
			</Show>
		</div>
	)
}

function MessageCard(props: {
	item: ChatTimelineMessageItem
	renderMarkdown?: AppProps['renderMarkdown']
}) {
	const content = () => props.item.message.message.content
	const usageText = () =>
		formatUsage(
			props.item.message.meta?.usage?.inputTokens,
			props.item.message.meta?.usage?.outputTokens,
			props.item.message.meta?.usage?.totalTokens,
		)

	const roleLabel = () => {
		if (props.item.message.message.role === 'tool') {
			return `Tool: ${props.item.message.message.name || t('tool')}`
		}
		if (props.item.message.message.role === 'assistant') {
			return 'Assistant'
		}
		if (props.item.message.message.role === 'user') {
			return 'User'
		}
		return 'System'
	}

	return (
		<Show
			when={props.item.message.message.role !== 'tool'}
			fallback={
				<details
					class={`rounded-3 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-3 ${
						props.item.message.meta?.isError ? 'border-[var(--text-error)]' : ''
					}`}
				>
					<summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-xs text-[var(--text-muted)] marker:hidden">
						<div class="font-medium text-[var(--text-normal)]">{roleLabel()}</div>
						<div>{formatTime(props.item.message.createdAt)}</div>
					</summary>
					<Show when={props.item.toolCall}>
						<>
							<div class="mt-3 text-xs text-[var(--text-muted)]">{t('params')}</div>
							<pre class="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2 bg-[var(--background-secondary)] p-2 text-xs leading-5">
								{props.item.toolCall?.function.arguments || '{}'}
							</pre>
						</>
					</Show>
					<div class="mt-3 text-xs text-[var(--text-muted)]">{t('result')}</div>
					<ContentParts content={content()} renderMarkdown={props.renderMarkdown} />
				</details>
			}
		>
			<div
				class={`rounded-3 p-3 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] ${
					props.item.message.meta?.isError ? 'border-[var(--text-error)]' : ''
				}`}
			>
				<div class="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
					<div class="font-medium text-[var(--text-normal)]">{roleLabel()}</div>
					<div>{formatTime(props.item.message.createdAt)}</div>
				</div>
				<ContentParts content={content()} renderMarkdown={props.renderMarkdown} />
				<Show
					when={
						props.item.message.message.role === 'assistant' &&
						(props.item.message.meta?.providerName ||
							props.item.message.meta?.modelName ||
							usageText())
					}
				>
					<div class="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
						<Show when={props.item.message.meta?.providerName || props.item.message.meta?.modelName}>
							<span class="rounded-full bg-[var(--background-secondary)] px-2 py-1">
								{[props.item.message.meta?.providerName, props.item.message.meta?.modelName]
									.filter(Boolean)
									.join('/')}
							</span>
						</Show>
						<Show when={usageText()}>
							<span class="rounded-full bg-[var(--background-secondary)] px-2 py-1">
								{usageText()}
							</span>
						</Show>
					</div>
				</Show>
			</div>
		</Show>
	)
}

function SessionHistoryItem(props: {
	session: AppProps['sessionHistory'][number]
	isActive: boolean
	onSelect: (sessionId: string) => void
	onDelete: (sessionId: string) => void
}) {
	const activate = () => props.onSelect(props.session.id)

	return (
		<div
			role="button"
			tabIndex={0}
			class={`group relative w-full overflow-hidden rounded-3 border px-3 py-3 text-left transition-colors ${
				props.isActive
					? 'border-[var(--interactive-accent)] bg-[var(--background-secondary)]'
					: 'border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] hover:bg-[var(--background-modifier-hover)]'
			}`}
			onClick={activate}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					activate()
				}
			}}
		>
			<Show when={props.isActive}>
				<div class="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--interactive-accent)]" />
			</Show>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 flex-1">
					<div class="truncate pr-1 text-sm font-medium text-[var(--text-normal)]">
						{props.session.title}
					</div>
					<div class="mt-2 text-xs text-[var(--text-muted)]">
						{formatTime(props.session.createdAt)}
					</div>
				</div>
				<button
					class="shrink-0 rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-error)] focus:opacity-100"
					type="button"
					aria-label={t('deleteSession')}
					onClick={(event) => {
						event.preventDefault()
						event.stopPropagation()
						props.onDelete(props.session.id)
					}}
				>
					{t('deleteSession')}
				</button>
			</div>
		</div>
	)
}

function FragmentDivider(props: {
	item: ChatTimelineFragmentItem
}) {
	return (
		<div class="relative py-2">
			<div class="absolute inset-x-0 top-1/2 h-px bg-[var(--background-modifier-border)]" />
			<div class="relative mx-auto w-fit rounded-full border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-3 py-1 text-xs text-[var(--text-muted)]">
				{formatTime(props.item.createdAt)}
			</div>
		</div>
	)
}

function RunStateCard(props: {
	runState: AppProps['runState']
	onStop?: AppProps['onStopActiveRun']
}) {
	const label = () => runStateLabel(props.runState)
	const canStop = () =>
		props.runState === 'thinking' || props.runState === 'waiting_for_tools'

	return (
		<Show when={label()}>
			<div class="rounded-3 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-3">
				<div class="flex items-center justify-between gap-3 rounded-2 bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-normal)]">
					<div class="flex min-w-0 items-center gap-3">
						<svg
							class="h-4 w-4 shrink-0 animate-spin text-[var(--interactive-accent)]"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<circle
								cx="12"
								cy="12"
								r="9"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
								stroke-dasharray="42 16"
							/>
						</svg>
						<div class="min-w-0 font-medium">{label()}</div>
					</div>
					<Show when={canStop() && props.onStop}>
						<button
							class="shrink-0 rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs hover:bg-[var(--background-modifier-hover)]"
							type="button"
							onClick={() => props.onStop?.()}
						>
							{t('stopRun')}
						</button>
					</Show>
				</div>
			</div>
		</Show>
	)
}

function PendingList(props: {
	pendingMessages: AppProps['pendingMessages']
}) {
	return (
		<Show when={props.pendingMessages.length > 0}>
			<div class="rounded-3 border border-dashed border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-3">
				<div class="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
					{t('pendingMessages')}
				</div>
				<div class="mt-2 flex flex-col gap-2">
					<For each={props.pendingMessages}>
						{(message) => (
							<div class="rounded-2 bg-[var(--background-secondary)] p-3 text-sm text-[var(--text-normal)] whitespace-pre-wrap break-words">
								{message.text}
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	)
}

function App(props: AppProps) {
	const [input, setInput] = createSignal('')
	const [isComposing, setIsComposing] = createSignal(false)
	const [historyOpen, setHistoryOpen] = createSignal(false)
	const [tasksOpen, setTasksOpen] = createSignal(false)
	const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
	const [sessionPendingDeleteId, setSessionPendingDeleteId] = createSignal<string>()
	let messagesEl: HTMLDivElement | undefined
	let historyEl: HTMLDivElement | undefined
	let modelPickerEl: HTMLDivElement | undefined
	let previousActiveSessionId = props.activeSessionId

	const hasTasks = () => props.currentSessionTasks.length + props.otherSessionTasks.length > 0
	const runningTaskCount = () => props.currentSessionTasks.filter((task) => task.status === 'running').length
		+ props.otherSessionTasks.filter((task) => task.status === 'running').length
	const isBusy = () => props.runState !== 'idle'
	const selectedProvider = () => props.providers.find((provider) => provider.id === props.selectedProviderId)
	const modelPickerLabel = () => {
		const provider = selectedProvider()
		const selectedModel = provider?.models.find((model) => model.id === props.selectedModelId)
		return [provider?.name, selectedModel?.name].filter(Boolean).join('/') || t('noModel')
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
		const behavior = previousActiveSessionId !== activeSessionId ? 'auto' : 'smooth'
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

	return (
		<div class="relative flex h-full overflow-hidden bg-[var(--background-primary)] text-[var(--text-normal)]">
			<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
				<div class="relative flex shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3 py-3">
					<button
						class="mod-cta"
						type="button"
						onClick={() => {
							setHistoryOpen((value) => !value)
							setModelPickerOpen(false)
						}}
					>
						{t('history')}
					</button>
					<div class="min-w-0 flex-1 truncate text-sm font-semibold">{props.title || t('newChat')}</div>
					<Show when={hasTasks()}>
						<button class="mod-cta" type="button" onClick={() => setTasksOpen((value) => !value)}>
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
								<div class="mb-2 text-xs text-[var(--text-muted)]">{t('provider')}</div>
								<select
									class="w-full"
									value={props.selectedProviderId || ''}
									onChange={(event) => props.onSelectProvider(event.currentTarget.value)}
								>
									<option value="">{t('noProvider')}</option>
									<For each={props.providers}>
										{(provider) => <option value={provider.id}>{provider.name}</option>}
									</For>
								</select>
								<div class="mb-2 mt-3 text-xs text-[var(--text-muted)]">{t('model')}</div>
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

				<div ref={messagesEl} class="flex-1 overflow-y-auto px-3 scrollbar-default">
					<Show
						when={props.timeline.length > 0 || props.pendingMessages.length > 0 || isBusy()}
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
											/>
										</Match>
									</Switch>
								)}
							</For>
							<RunStateCard runState={props.runState} onStop={props.onStopActiveRun} />
							<PendingList pendingMessages={props.pendingMessages} />
						</div>
					</Show>
				</div>

				<div class="shrink-0 border-t border-[var(--background-modifier-border)] px-3 py-3">
					<textarea
						class="h-28 w-full resize-none rounded-3 border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-3 text-sm leading-6 outline-none"
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
						<button class="mod-cta" type="button" disabled={!input().trim()} onClick={() => void submit()}>
							{isBusy() ? t('queueSend') : t('send')}
						</button>
					</div>
				</div>
			</div>

			<Show when={tasksOpen()}>
				<div class="flex h-full w-[22rem] shrink-0 flex-col border-l border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)]">
					<div class="flex items-center justify-between border-b border-[var(--background-modifier-border)] px-3 py-3">
						<div class="text-sm font-semibold">{t('tasks')}</div>
						<button
							class="rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs hover:bg-[var(--background-modifier-hover)]"
							type="button"
							onClick={() => setTasksOpen(false)}
						>
							{t('closeTasks')}
						</button>
					</div>
					<div class="flex-1 overflow-y-auto px-3 py-3">
						<div class="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
							{t('currentSession')}
						</div>
						<div class="mt-2 flex flex-col gap-3">
							<Show
								when={props.currentSessionTasks.length > 0}
								fallback={
									<div class="rounded-3 border border-dashed border-[var(--background-modifier-border)] px-3 py-4 text-sm text-[var(--text-muted)]">
										{t('noTasks')}
									</div>
								}
							>
								<For each={props.currentSessionTasks}>
									{(task) => (
										<TaskCard
											task={task}
											onCancelTask={props.onCancelTask}
											compact
										/>
									)}
								</For>
							</Show>
						</div>
						<Show when={props.otherSessionTasks.length > 0}>
							<div class="mt-6 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
								{t('otherSessions')}
							</div>
							<div class="mt-2 flex flex-col gap-3">
								<For each={props.otherSessionTasks}>
									{(task) => <TaskCard task={task} compact />}
								</For>
							</div>
						</Show>
					</div>
				</div>
			</Show>

			<Show when={sessionPendingDeleteId()}>
				<div class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-4">
					<div class="w-full max-w-sm rounded-4 border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-4 shadow-xl">
						<div class="text-base font-semibold text-[var(--text-normal)]">
							{t('deleteSessionTitle')}
						</div>
						<div class="mt-3 text-sm leading-6 text-[var(--text-muted)]">
							{t('deleteSessionMessage')}
						</div>
						<div class="mt-4 flex justify-end gap-2">
							<button
								class="rounded-2 border border-[var(--background-modifier-border)] px-3 py-2 text-sm hover:bg-[var(--background-modifier-hover)]"
								type="button"
								onClick={() => setSessionPendingDeleteId(undefined)}
							>
								{t('cancel')}
							</button>
							<button
								class="rounded-2 border border-[var(--color-red-rgb)]/30 bg-[var(--color-red-rgb)]/12 px-3 py-2 text-sm text-[var(--text-error)] hover:bg-[var(--color-red-rgb)]/18"
								type="button"
								onClick={() => void confirmDeleteSession()}
							>
								{t('confirmDelete')}
							</button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	)
}

export default App
