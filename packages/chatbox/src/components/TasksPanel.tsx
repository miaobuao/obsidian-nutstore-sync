import { For, Show } from 'solid-js'
import type { ChatboxProps } from '../types'
import { t } from '../i18n'
import { TaskCard } from './TaskCard'

export function TasksPanel(props: {
	currentSessionTasks: ChatboxProps['currentSessionTasks']
	otherSessionTasks: ChatboxProps['otherSessionTasks']
	onCancelTask?: ChatboxProps['onCancelTask']
	onClose: () => void
}) {
	return (
		<div class="flex h-full w-[22rem] shrink-0 flex-col border-l border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)]">
			<div class="flex items-center justify-between border-b border-[var(--background-modifier-border)] px-3 py-3">
				<div class="text-sm font-semibold">{t('tasks')}</div>
				<button
					class="rounded-2 border border-[var(--background-modifier-border)] px-2 py-1 text-xs hover:bg-[var(--background-modifier-hover)]"
					type="button"
					onClick={props.onClose}
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
	)
}
