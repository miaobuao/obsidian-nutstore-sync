import type { ChatRunState } from '~/ai/chat/types'
import type { ChatTimelineMessageItem, ChatboxProps } from '~/ai/chat/ui/types'
import { createMount } from '../mount'
import { MessageCard } from './components/MessageCard'
import { TurnTimeline } from './components/TurnTimeline'

interface WorkshopTimelineProps {
	timeline: ChatTimelineMessageItem[]
	sessionId?: string
	runState: ChatRunState
	now: number
	renderMarkdown: ChatboxProps['renderMarkdown']
}

/** The floating workshop transcript shares chat's turn grouping and tool disclosures. */
function WorkshopTimeline(props: WorkshopTimelineProps) {
	return (
		<div class="ns-workshop-transcript">
			<TurnTimeline
				timeline={props.timeline}
				sessionId={props.sessionId}
				runState={props.runState}
			>
				{(row, process) => (
					<MessageCard
						item={row().item}
						displayBlocks={row().blocks}
						process={process}
						now={props.now}
						streaming={props.runState !== 'idle'}
						renderMarkdown={props.renderMarkdown}
					/>
				)}
			</TurnTimeline>
		</div>
	)
}

export function mountWorkshopTimeline(
	el: HTMLElement,
	props: WorkshopTimelineProps,
) {
	return createMount(WorkshopTimeline, el, props)
}
