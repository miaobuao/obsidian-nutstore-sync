import type { ChatSession } from '~/ai/chat/domain'
import type { ChatTimelineMessageItem } from '~/ai/chat/ui/types'
import { buildTimeline } from '~/ai/chat/ui/view-projection'

/** Workshop requests live in build turns; assistant/tool messages use the shared chat projection. */
export function buildWorkshopTimeline(
	session: ChatSession,
): ChatTimelineMessageItem[] {
	const turns = session.workshop?.turns ?? []
	const timeline = buildTimeline(session)
	const assigned = new Set(turns.flatMap((turn) => turn.messageIds))
	return turns.flatMap((turn, index) => {
		const parts = [{ type: 'text' as const, text: turn.text }]
		const request: ChatTimelineMessageItem = {
			createdAt: turn.createdAt,
			message: { id: turn.id, role: 'user', parts },
			displayBlocks: [{ kind: 'content', parts }],
			showHeader: true,
		}
		// Streaming messages acquire their turn's messageIds when the run settles.
		const ids = new Set(turn.messageIds)
		const messages = timeline.filter(
			(item) =>
				ids.has(item.message.id) ||
				(index === turns.length - 1 && !assigned.has(item.message.id)),
		)
		if (turn.error) {
			const parts = [{ type: 'text' as const, text: turn.error }]
			messages.push({
				createdAt: turn.finishedAt ?? turn.createdAt,
				message: {
					id: `${turn.id}:error`,
					role: 'assistant',
					parts,
					metadata: {
						status: 'error',
						createdAt: turn.finishedAt ?? turn.createdAt,
					},
				},
				displayBlocks: [{ kind: 'content', parts }],
				showHeader: true,
			})
		}
		return [request, ...messages]
	})
}
