import { createSignal, onCleanup } from 'solid-js'

interface PaneResizerProps {
	onResizeStart?: () => void
	onResize: (deltaY: number) => void
	onResizeEnd?: () => void
	onDblClick?: () => void
}

export function PaneResizer(props: PaneResizerProps) {
	const [isResizing, setIsResizing] = createSignal(false)
	let startY = 0
	let removeListeners: (() => void) | undefined

	function stopResize() {
		removeListeners?.()
		removeListeners = undefined
		setIsResizing(false)
		document.body.classList.remove('chatbox-resize-active')
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) {
			return
		}

		event.preventDefault()
		stopResize()
		props.onResizeStart?.()
		startY = event.clientY
		setIsResizing(true)
		document.body.classList.add('chatbox-resize-active')

		const onPointerMove = (moveEvent: PointerEvent) => {
			props.onResize(startY - moveEvent.clientY)
		}

		const onPointerUp = () => {
			props.onResizeEnd?.()
			stopResize()
		}

		document.addEventListener('pointermove', onPointerMove)
		document.addEventListener('pointerup', onPointerUp)
		document.addEventListener('pointercancel', onPointerUp)
		removeListeners = () => {
			document.removeEventListener('pointermove', onPointerMove)
			document.removeEventListener('pointerup', onPointerUp)
			document.removeEventListener('pointercancel', onPointerUp)
		}
	}

	onCleanup(() => stopResize())

	return (
		<div
			class="chatbox-resizer px-3"
			classList={{ 'is-resizing': isResizing() }}
			role="separator"
			aria-orientation="horizontal"
			onPointerDown={onPointerDown}
			onDblClick={() => props.onDblClick?.()}
		>
			<div class="chatbox-resizer-line" />
		</div>
	)
}
