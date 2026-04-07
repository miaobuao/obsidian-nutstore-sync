export type {
	ChatUsage,
	ChatRunState,
	ChatTextPart,
	ChatImageUrlPart,
	ChatUnknownPart,
	ChatMessageContentPart,
	ChatToolCall,
	ChatMessageMeta,
	ChatSystemMessage,
	ChatUserMessage,
	ChatAssistantMessageWithContent,
	ChatAssistantMessageWithToolCalls,
	ChatAssistantMessage,
	ChatToolMessage,
	ChatMessage,
	ChatMessageRecord,
	ChatTaskBase,
	QueuedChatTask,
	RunningChatTask,
	CompletedChatTask,
	FailedChatTask,
	CancelledChatTask,
	ChatTaskRecord,
	ChatPendingMessage,
} from 'chatbox'

import type {
	ChatUsage,
	ChatImageUrlPart,
	ChatTextPart,
	ChatUnknownPart,
	ChatMessage,
	ChatMessageRecord,
	ChatMessageMeta,
	ChatTaskRecord,
	ChatTaskBase,
	QueuedChatTask,
	RunningChatTask,
	CompletedChatTask,
	FailedChatTask,
	CancelledChatTask,
} from 'chatbox'

export interface ChatFragment {
	id: string
	createdAt: number
	messages: ChatMessageRecord[]
}

export interface ChatSession {
	id: string
	createdAt: number
	title: string
	providerId?: string
	modelId?: string
	fragments: ChatFragment[]
	activeFragmentId: string
	tasks: ChatTaskRecord[]
}

export interface ChatSessionIndexItem {
	id: string
	title: string
	createdAt: number
}

export function cloneUsage(usage?: ChatUsage) {
	return usage
		? {
			...usage,
		}
		: undefined
}

export function cloneMessage(message: ChatMessage): ChatMessage {
	return {
		...message,
		content: message.content?.map((part) => {
			if (part.type === 'image_url') {
				return {
					type: 'image_url',
					image_url: {
						...part.image_url,
					},
				} satisfies ChatImageUrlPart
			}
			if (part.type === 'unknown') {
				return {
					type: 'unknown',
					value: part.value,
				} satisfies ChatUnknownPart
			}
			return {
				type: 'text',
				text: part.text,
			} satisfies ChatTextPart
		}) as ChatMessage['content'],
		tool_calls: 'tool_calls' in message && message.tool_calls
			? message.tool_calls.map((toolCall) => ({
				...toolCall,
				function: {
					...toolCall.function,
				},
			}))
			: undefined,
	} as ChatMessage
}

export function cloneMessageRecord(record: ChatMessageRecord): ChatMessageRecord {
	return {
		...record,
		message: cloneMessage(record.message),
		meta: record.meta
			? {
				...record.meta,
				usage: cloneUsage(record.meta.usage),
			}
			: undefined,
	}
}

export function cloneTask(task: ChatTaskRecord): ChatTaskRecord {
	return {
		...task,
	}
}

export function cloneSession(session: ChatSession): ChatSession {
	return {
		...session,
		fragments: session.fragments.map((fragment) => ({
			...fragment,
			messages: fragment.messages.map(cloneMessageRecord),
		})),
		tasks: session.tasks.map(cloneTask),
	}
}

export function isTerminalTask(task: ChatTaskRecord) {
	return (
		task.status === 'completed' ||
		task.status === 'failed' ||
		task.status === 'cancelled'
	)
}

export function createQueuedTask(task: ChatTaskBase): QueuedChatTask {
	return {
		...task,
		status: 'queued',
	}
}

export function createRunningTask(task: ChatTaskBase, startedAt: number): RunningChatTask {
	return {
		...task,
		status: 'running',
		startedAt,
	}
}

export function toRunningTask(task: QueuedChatTask, startedAt: number): RunningChatTask {
	return {
		...task,
		status: 'running',
		startedAt,
	}
}

export function toCompletedTask(
	task: RunningChatTask,
	summary: string,
	sourceCount: number,
	finishedAt: number,
): CompletedChatTask {
	return {
		...task,
		status: 'completed',
		summary,
		sourceCount,
		finishedAt,
	}
}

export function toFailedTask(
	task: QueuedChatTask | RunningChatTask,
	error: string,
	summary: string,
	finishedAt: number,
	failureStage?: string,
	sourceCount?: number,
): FailedChatTask {
	return {
		...task,
		status: 'failed',
		error,
		summary,
		finishedAt,
		failureStage,
		...(task.status === 'running' ? { startedAt: task.startedAt } : {}),
		...(typeof sourceCount === 'number' ? { sourceCount } : {}),
	}
}

export function toCancelledTask(
	task: QueuedChatTask | RunningChatTask,
	cancelReason: string,
	summary: string,
	finishedAt: number,
): CancelledChatTask {
	return {
		...task,
		status: 'cancelled',
		cancelReason,
		summary,
		finishedAt,
		...(task.status === 'running' ? { startedAt: task.startedAt } : {}),
	}
}

export function mutateTaskRecord(target: ChatTaskRecord, next: ChatTaskRecord) {
	for (const key of [
		'status',
		'startedAt',
		'finishedAt',
		'summary',
		'error',
		'failureStage',
		'cancelReason',
		'sourceCount',
	] as const) {
		delete ((target as unknown) as Record<string, unknown>)[key]
	}
	Object.assign(target, next)
	return target
}
