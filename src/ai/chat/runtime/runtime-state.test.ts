import { describe, expect, it } from 'vitest'
import { ChatState } from '~/ai/chat/runtime/chat-state'
import {
	claimNextTurn,
	enqueueUserSubmission,
} from '~/ai/chat/runtime/master-turn-scheduler'
import { RuntimeStates } from '~/ai/chat/runtime/runtime-state'

describe('RuntimeStates', () => {
	it('drops and aborts execution when a session is rehydrated', () => {
		const state = new ChatState()
		const runtimeStates = new RuntimeStates(state)
		const runtime = runtimeStates.get('neutral-session')
		enqueueUserSubmission(runtime, {
			text: 'Hello 你好 🌿',
			userContext: [],
		})
		const active = claimNextTurn(runtime)!
		const manualCompression = new AbortController()
		runtime.manualCompressionAbortController = manualCompression

		runtimeStates.resetExecution('neutral-session')

		expect(active.abortController.signal.aborted).toBe(true)
		expect(manualCompression.signal.aborted).toBe(true)
		expect(state.runtimeBySessionId.has('neutral-session')).toBe(false)
		expect(
			runtimeStates.get('neutral-session').scheduler.active,
		).toBeUndefined()
	})
})
