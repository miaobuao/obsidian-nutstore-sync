import { describe, expect, it, vi } from 'vitest'
import { taskTool } from '~/ai/tools/task'
import type { TaskOrigin } from '~/ai/chat/runtime/master-turn-scheduler'

describe('task tool execution context', () => {
	it('forwards the captured turn origin instead of resolving a global active turn', async () => {
		const origin: TaskOrigin = {
			turnId: 'T1',
			signal: new AbortController().signal,
		}
		const dispatchTask = vi.fn(async () => ({
			taskId: 'task-1',
			subagentType: 'explorer',
			status: 'dispatched' as const,
		}))
		const execute = taskTool.execute as never as (
			params: { subagent_type: string; prompt: string },
			options: {
				context: {
					session: { id: 'session' }
					agentId: 'master'
					dispatchTask: typeof dispatchTask
					origin: TaskOrigin
				}
			},
		) => Promise<unknown>

		await execute(
			{ subagent_type: 'explorer', prompt: 'Hello 你好 🌿' },
			{
				context: {
					session: { id: 'session' },
					agentId: 'master',
					dispatchTask,
					origin,
				},
			},
		)

		expect(dispatchTask).toHaveBeenCalledWith(
			expect.objectContaining({
				callerAgentId: 'master',
				sessionId: 'session',
			}),
			origin,
		)
	})
})
