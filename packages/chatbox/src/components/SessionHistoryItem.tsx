import { Show } from 'solid-js'
import type { ChatboxProps } from '../types'
import { t } from '../i18n'
import { formatTime } from '../utils'

export function SessionHistoryItem(props: {
	session: ChatboxProps['sessionHistory'][number]
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
					class="shrink-0 rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-error)]"
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
