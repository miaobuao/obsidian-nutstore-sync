import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseAgentId } from 'id-agent'
import type { ChatSession } from '~/ai/chat/domain'
import { MessageFactory } from '~/ai/chat/messages/message-factory'
import { createEmptyMasterAgent } from '~/ai/chat/messages/ui-message'
import { ContextCompactionCoordinator } from '~/ai/chat/runtime/context-compaction-coordinator'
import { TaskManager } from '~/ai/chat/runtime/task-manager'
import {
	EXPLORER_AGENT_ID,
	getAgentDefinition,
	MASTER_AGENT_ID,
} from '~/ai/chat/agents/registry'
import type { AppUIMessage, ChatAgentState } from '~/ai/chat/types'
import { BASH_TMP_MOUNT_POINT } from '~/ai/tools/bash/mount-points'

const writeTaskResult = vi.hoisted(() => vi.fn(async () => undefined))
const generateText = vi.hoisted(() => vi.fn())
const NEUTRAL_TEXT = 'Hello 你好 🌿'

vi.mock('~/ai/tools/bash/tmp-fs', () => ({
	writeBashTmpText: writeTaskResult,
}))
vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	generateText,
}))
vi.mock('~/ai/core/runtime', () => ({
	prepareMessagesForModel: (
		_provider: unknown,
		_model: string,
		messages: unknown,
	) => messages,
	resolveLanguageModel: () => ({ model: {} }),
}))

describe('TaskManager parent notifications', () => {
	beforeEach(() => {
		writeTaskResult.mockClear()
		generateText.mockReset()
	})

	it('persists the result before notifying the direct parent', async () => {
		const events: string[] = []
		writeTaskResult.mockImplementationOnce(async () => {
			events.push('persist-result')
		})
		const master = createEmptyMasterAgent(1)
		const parent: ChatAgentState = {
			...createEmptyMasterAgent(1),
			id: 'parent',
			type: 'subagent',
			status: 'running',
		}
		const child: ChatAgentState = {
			...createEmptyMasterAgent(2),
			id: 'child',
			type: 'subagent',
			status: 'running',
		}
		parent.subagents.child = child
		vi.spyOn(parent.pendingInputs, 'push').mockImplementation((...items) => {
			events.push('notify-parent')
			for (const item of items) {
				Array.prototype.push.call(parent.pendingInputs, item)
			}
			return parent.pendingInputs.length
		})
		master.subagents.parent = parent
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'session',
			createdAt: 1,
			updatedAt: 3,
			subagents: { master },
		}
		const state = {
			loadedSessions: new Map([['session', session]]),
			deletedSessionIds: new Set<string>(),
			taskModelSelection: new Map(),
		} as never
		const manager = new TaskManager(
			{} as never,
			vi.fn(),
			state,
			{} as never,
			{ persistSession: vi.fn(async () => undefined) } as never,
			vi.fn(),
			{} as never,
			{} as never,
			{} as never,
		)

		await manager.finishAgentAsCompleted(session, child, 'done')
		expect(events).toEqual(['persist-result', 'notify-parent'])

		expect(writeTaskResult).toHaveBeenCalledWith(
			{},
			`${BASH_TMP_MOUNT_POINT}/session/tasks/child.txt`,
			'done',
		)

		expect(master.pendingInputs).toEqual([])
		expect(parent.pendingInputs).toHaveLength(1)
		expect(parent.pendingInputs[0].parts[0]).toMatchObject({
			type: 'data-system-notification',
			data: {
				kind: 'task-result-ready',
				taskId: 'child',
				resultPath: `${BASH_TMP_MOUNT_POINT}/session/tasks/child.txt`,
			},
		})
		expect(parent.pendingInputs[0].parts).toHaveLength(1)
	})

	it('does not settle or notify when persisting the result fails', async () => {
		writeTaskResult.mockRejectedValueOnce(new Error('disk full'))
		const master = createEmptyMasterAgent(1)
		const child: ChatAgentState = {
			...createEmptyMasterAgent(2),
			id: 'child',
			type: 'subagent',
			status: 'running',
		}
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'session',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master },
		}
		master.subagents.child = child
		const state = {
			loadedSessions: new Map([['session', session]]),
			deletedSessionIds: new Set<string>(),
			taskModelSelection: new Map(),
		} as never
		const persistSession = vi.fn(async () => undefined)
		const manager = new TaskManager(
			{} as never,
			vi.fn(),
			state,
			{} as never,
			{ persistSession } as never,
			vi.fn(),
			{} as never,
			{} as never,
			{} as never,
		)

		await expect(
			manager.finishAgentAsCompleted(session, child, 'done'),
		).rejects.toThrow('disk full')

		expect(child.status).toBe('running')
		expect(master.pendingInputs).toEqual([])
		expect(persistSession).not.toHaveBeenCalled()
	})

	it('dispatches a typed subagent with an id-agent task id', async () => {
		const master = createEmptyMasterAgent(1)
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'session',
			createdAt: 1,
			updatedAt: 1,
			model: { providerId: 'provider', modelId: 'model' },
			subagents: { master },
		}
		const state = {
			loadedSessions: new Map([['session', session]]),
			deletedSessionIds: new Set<string>(),
			taskModelSelection: new Map(),
		} as never
		const toolExecutor = {
			getAgentDefinition: (agentType: string) => {
				const definition = getAgentDefinition(agentType)
				if (!definition) throw new Error(`Unknown agent type: ${agentType}`)
				return definition
			},
		}
		const manager = new TaskManager(
			{} as never,
			vi.fn(),
			state,
			{} as never,
			{ persistSession: vi.fn(async () => undefined) } as never,
			vi.fn(),
			toolExecutor as never,
			{} as never,
			{} as never,
		)
		vi.spyOn(manager as never, 'runAgent' as never).mockResolvedValue(
			undefined as never,
		)

		const output = await manager.dispatchTask({
			prompt: 'Inspect the vault',
			subagentType: EXPLORER_AGENT_ID,
			callerAgentId: 'master',
			sessionId: session.id,
		})

		const parsed = parseAgentId(output.taskId)
		expect(parsed?.prefix).toBe(EXPLORER_AGENT_ID)
		expect(master.subagents[output.taskId]).toMatchObject({
			id: output.taskId,
			type: EXPLORER_AGENT_ID,
		})
		expect(output).toMatchObject({
			subagentType: EXPLORER_AGENT_ID,
			status: 'dispatched',
		})
	})

	it('rejects non-dispatchable agent types', async () => {
		const master = createEmptyMasterAgent(1)
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'session',
			createdAt: 1,
			updatedAt: 1,
			model: { providerId: 'provider', modelId: 'model' },
			subagents: { master },
		}
		const state = {
			loadedSessions: new Map([['session', session]]),
			deletedSessionIds: new Set<string>(),
			taskModelSelection: new Map(),
		} as never
		const manager = new TaskManager(
			{} as never,
			vi.fn(),
			state,
			{} as never,
			{ persistSession: vi.fn(async () => undefined) } as never,
			vi.fn(),
			{
				getAgentDefinition: (agentType: string) => {
					const definition = getAgentDefinition(agentType)
					if (!definition) throw new Error(`Unknown agent type: ${agentType}`)
					return definition
				},
			} as never,
			{} as never,
			{} as never,
		)

		await expect(
			manager.dispatchTask({
				prompt: 'Inspect the vault',
				subagentType: MASTER_AGENT_ID,
				callerAgentId: MASTER_AGENT_ID,
				sessionId: session.id,
			}),
		).rejects.toThrow('cannot be dispatched')
		expect(master.subagents).toEqual({})
	})

	it('carries tool-call continuation across a compaction resume', async () => {
		const master = createEmptyMasterAgent(1)
		const agent: ChatAgentState = {
			...createEmptyMasterAgent(2),
			id: 'neutral-child',
			type: 'subagent',
			status: 'running',
			timeline: [
				{
					id: 'neutral-request',
					role: 'user',
					metadata: { createdAt: 1 },
					parts: [{ type: 'text', text: NEUTRAL_TEXT }],
				},
			],
		}
		master.subagents[agent.id] = agent
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'neutral-session',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master },
		}
		const continuation = {
			consecutiveCount: 2,
			isRepeatedTooManyTimes: false,
		} as never
		const runTurn = vi
			.fn()
			.mockResolvedValueOnce({ status: 'needs-compaction', continuation })
			.mockResolvedValueOnce({ status: 'completed', text: NEUTRAL_TEXT })
		const state = {
			loadedSessions: new Map([[session.id, session]]),
			deletedSessionIds: new Set<string>(),
			taskModelSelection: new Map([
				[
					agent.id,
					{ providerId: 'neutral-provider', modelId: 'neutral-model' },
				],
			]),
		}
		const manager = new TaskManager(
			{} as never,
			vi.fn(async () => undefined),
			state as never,
			{
				getProviderByIdOrThrow: () => ({ id: 'neutral-provider' }),
				getModelByIdsOrThrow: () => ({ id: 'neutral-model' }),
			} as never,
			{ persistSession: vi.fn(async () => undefined) } as never,
			vi.fn(),
			{} as never,
			{} as never,
			{ runTurn } as never,
		)

		await manager.runAgent(session, agent)

		expect(runTurn.mock.calls[1][0].continuation).toBe(continuation)
	})

	it('settles after one failed hard-pressure summary instead of retrying', async () => {
		generateText.mockResolvedValue({ text: ' \n\t ' })
		const master = createEmptyMasterAgent(1)
		const agent: ChatAgentState = {
			...createEmptyMasterAgent(2),
			id: 'neutral-child',
			type: 'subagent',
			status: 'running',
			timeline: [
				{
					id: 'neutral-old-user',
					role: 'user',
					metadata: { createdAt: 1 },
					parts: [{ type: 'text', text: NEUTRAL_TEXT.repeat(10_000) }],
				},
				{
					id: 'neutral-old-assistant',
					role: 'assistant',
					metadata: {
						createdAt: 2,
						llm: {
							usage: {
								inputTokens: 86_000,
								outputTokens: 0,
								totalTokens: 86_000,
							} as never,
						},
					},
					parts: [{ type: 'text', text: NEUTRAL_TEXT }],
				},
				{
					id: 'neutral-current-user',
					role: 'user',
					metadata: { createdAt: 3 },
					parts: [{ type: 'text', text: NEUTRAL_TEXT }],
				},
			],
		}
		master.subagents[agent.id] = agent
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'neutral-session',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master },
		}
		const store = {
			persistSession: vi.fn(async () => undefined),
			persistMetaAndIndex: vi.fn(async () => undefined),
			upsertSessionIndexItem: vi.fn(),
		}
		const factory = new MessageFactory({} as never, {} as never, vi.fn())
		const coordinator = new ContextCompactionCoordinator(
			store as never,
			factory,
		)
		const runTurn = vi.fn()
		const manager = new TaskManager(
			{} as never,
			vi.fn(async () => undefined),
			{
				loadedSessions: new Map([[session.id, session]]),
				deletedSessionIds: new Set<string>(),
				taskModelSelection: new Map([
					[
						agent.id,
						{ providerId: 'neutral-provider', modelId: 'neutral-model' },
					],
				]),
			} as never,
			{
				getProviderByIdOrThrow: () => ({ id: 'neutral-provider' }),
				getModelByIdsOrThrow: () => ({
					id: 'neutral-model',
					limit: { context: 100_000, output: 10_000 },
				}),
			} as never,
			store as never,
			vi.fn(),
			{} as never,
			factory,
			{
				runTurn,
				resolveSummaryContext: vi.fn(async () => ({})),
			} as never,
			coordinator,
		)

		await manager.runAgent(session, agent)

		expect(generateText).toHaveBeenCalledTimes(1)
		expect(runTurn).not.toHaveBeenCalled()
		expect(agent.status).toBe('failed')
	})

	it('cancels an optimistic compaction job when an agent settles', async () => {
		let signal: AbortSignal | undefined
		generateText.mockImplementation(
			({ abortSignal }: { abortSignal?: AbortSignal }) => {
				signal = abortSignal
				return new Promise(() => undefined)
			},
		)
		const message = (
			id: string,
			role: 'user' | 'assistant',
			createdAt: number,
		): AppUIMessage => ({
			id,
			role,
			metadata: { createdAt },
			parts: [{ type: 'text', text: `${NEUTRAL_TEXT} ${id}` }],
		})
		const master = createEmptyMasterAgent(1)
		const agent: ChatAgentState = {
			...createEmptyMasterAgent(2),
			id: 'neutral-child',
			type: 'subagent',
			status: 'running',
			timeline: [
				{
					...message('neutral-old-user', 'user', 1),
					parts: [{ type: 'text', text: NEUTRAL_TEXT.repeat(10_000) }],
				},
				message('neutral-old-assistant', 'assistant', 2),
				message('neutral-current-user', 'user', 3),
			],
		}
		agent.timeline[1].metadata!.llm = {
			usage: {
				inputTokens: 82_000,
				outputTokens: 0,
				totalTokens: 82_000,
			} as never,
		}
		master.subagents[agent.id] = agent
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'neutral-session',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master },
		}
		const store = {
			persistSession: vi.fn(async () => undefined),
			persistMetaAndIndex: vi.fn(async () => undefined),
			upsertSessionIndexItem: vi.fn(),
		}
		const factory = new MessageFactory({} as never, {} as never, vi.fn())
		const coordinator = new ContextCompactionCoordinator(
			store as never,
			factory,
		)
		const compactionRequest = {
			session,
			agent,
			provider: { id: 'neutral-provider' } as never,
			model: {
				id: 'neutral-model',
				limit: { context: 100_000, output: 10_000 },
			} as never,
			revision: 'neutral-revision',
			resolveSummaryContext: async () => ({}),
			isCancelled: () => false,
			isCurrent: () => true,
		}
		expect(coordinator.inspect(compactionRequest)).toBe('ready')
		await vi.waitFor(() => expect(signal).toBeDefined())

		const manager = new TaskManager(
			{} as never,
			vi.fn(async () => undefined),
			{
				loadedSessions: new Map([[session.id, session]]),
				deletedSessionIds: new Set<string>(),
				taskModelSelection: new Map(),
			} as never,
			{} as never,
			store as never,
			vi.fn(),
			{} as never,
			factory,
			{} as never,
			coordinator,
		)

		await manager.finishAgentAsCompleted(session, agent, NEUTRAL_TEXT)

		expect(signal!.aborted).toBe(true)
		expect(generateText).toHaveBeenCalledTimes(1)
	})
})
