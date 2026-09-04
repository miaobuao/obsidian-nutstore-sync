import { describe, expect, it, vi } from 'vitest'
import type { ChatSession } from '~/ai/chat/domain'
import { ChatState } from '~/ai/chat/runtime/chat-state'
import { createEmptyMasterAgent } from '~/ai/chat/messages/ui-message'
import { RuntimeStates } from '~/ai/chat/runtime/runtime-state'
import { SessionProcessor } from '~/ai/chat/runtime/session-processor'
import { createMasterTurnScheduler } from '~/ai/chat/runtime/master-turn-scheduler'
import type { AppUIMessage } from '~/ai/chat/types'

const TEXT_ONE = 'Hello 你好 🌿 one'
const TEXT_TWO = 'Hello 你好 🌿 two'

function createHarness(
	runTurn: (options: { abortSignal?: AbortSignal }) => Promise<unknown>,
	prepareUserContext: (
		items: unknown[],
	) => Promise<{ dedupedItems: unknown[] }> = async (items) => ({
		dedupedItems: items,
	}),
) {
	const master = createEmptyMasterAgent(1)
	const session: ChatSession = {
		schemaVersion: 2,
		id: 'session',
		createdAt: 1,
		updatedAt: 1,
		model: { providerId: 'provider', modelId: 'model' },
		subagents: { master },
	}
	const state = new ChatState()
	state.loadedSessions.set(session.id, session)
	const runtimeStates = new RuntimeStates(state)
	const store = {
		persistSession: vi.fn(async () => undefined),
		persistMetaAndIndex: vi.fn(async () => undefined),
		upsertSessionIndexItem: vi.fn(),
	}
	let messageNumber = 0
	const appendUserMessage = vi.fn(
		async (
			agent: typeof master,
			text: string,
			currentSession: ChatSession,
			_context: unknown,
			isCurrent?: () => boolean,
		) => {
			if (isCurrent && !isCurrent()) return undefined
			const message: AppUIMessage = {
				id: `user-${++messageNumber}`,
				role: 'user',
				metadata: { createdAt: currentSession.updatedAt },
				parts: [{ type: 'text', text }],
			}
			agent.timeline.push(message)
			return message
		},
	)
	const messageFactory = {
		getActiveAgent: () => master,
		appendUserMessage,
		appendAgentInput: vi.fn(() => true),
		removeIncompleteToolCalls: vi.fn(() => false),
		reportFatalError: vi.fn(),
	} as never
	const messageOps = {
		beginRegeneration: vi.fn(),
		commitRegeneration: vi.fn(),
		rollbackRegeneration: vi.fn(),
	} as never
	const selection = {
		getProviderOrThrow: () => ({ id: 'provider', name: 'Provider' }),
		getModelOrThrow: () => ({ id: 'model', name: 'Model' }),
	} as never
	const userContextManager = {
		prepareUserContextForMessage: prepareUserContext,
	} as never
	const agentRunner = { runTurn } as never
	const compactionCoordinator = {
		inspect: () => 'ready',
		compact: async () => ({
			beforeTokens: 1,
			afterTokens: 1,
			revision: 'test',
		}),
		shouldSuspendAtSafePoint: () => false,
		cancel: vi.fn(),
	} as never
	const processor = new SessionProcessor(
		async () => undefined,
		state,
		runtimeStates,
		store as never,
		vi.fn(),
		selection,
		messageFactory,
		messageOps,
		userContextManager,
		agentRunner,
		compactionCoordinator,
		{
			cancelAllNonTerminalAgents: vi.fn(() => false),
			startQueuedAgentsForSession: vi.fn(),
		},
	)
	return { master, processor, runtime: runtimeStates.get(session.id), session }
}

describe('SessionProcessor master turn worker', () => {
	it('cancels T1 without replaying it and drains queued T2', async () => {
		let callCount = 0
		const runTurn = vi.fn(({ abortSignal }: { abortSignal?: AbortSignal }) => {
			callCount += 1
			if (callCount === 1) {
				return new Promise((_, reject) => {
					abortSignal?.addEventListener(
						'abort',
						() => reject(new Error('test abort')),
						{ once: true },
					)
				})
			}
			return Promise.resolve({ status: 'completed', text: TEXT_TWO })
		})
		const { master, processor, runtime } = createHarness(runTurn)

		processor.enqueueUserSubmission('session', {
			text: TEXT_ONE,
			userContext: [],
		})
		await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1))
		const firstWorker = runtime.processing

		processor.enqueueUserSubmission('session', {
			text: TEXT_TWO,
			userContext: [],
		})
		expect(runtime.scheduler.queued).toHaveLength(1)
		expect(master.timeline.map((message) => message.id)).toEqual(['user-1'])

		await processor.stopActiveTurn('session')
		await firstWorker

		expect(runTurn).toHaveBeenCalledTimes(2)
		expect(runtime.scheduler.queued).toEqual([])
		expect(runtime.scheduler.active).toBeUndefined()
		expect(master.timeline.map((message) => message.id)).toEqual([
			'user-1',
			'user-2',
		])
	})

	it('rechecks the scheduler after an empty worker to avoid a lost wake-up', async () => {
		const runTurn = vi.fn(async () => ({ status: 'completed', text: TEXT_TWO }))
		const { processor, runtime } = createHarness(runTurn)

		const emptyWorker = processor.start('session')
		processor.enqueueUserSubmission('session', {
			text: TEXT_TWO,
			userContext: [],
		})
		await emptyWorker
		await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1))
		await runtime.processing

		expect(runtime.scheduler.queued).toEqual([])
		expect(runtime.scheduler.active).toBeUndefined()
	})

	it('materializes a claimed user submission after Stop without starting the model', async () => {
		let releasePrepare:
			| ((value: { dedupedItems: unknown[] }) => void)
			| undefined
		const prepare = vi.fn(
			() =>
				new Promise<{ dedupedItems: unknown[] }>((resolve) => {
					releasePrepare = resolve
				}),
		)
		const runTurn = vi.fn(async () => ({ status: 'completed', text: TEXT_TWO }))
		const { master, processor, runtime } = createHarness(runTurn, prepare)

		processor.enqueueUserSubmission('session', {
			text: TEXT_ONE,
			userContext: [],
		})
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
		const worker = runtime.processing
		await processor.stopActiveTurn('session')
		releasePrepare!({ dedupedItems: [] })
		await worker

		expect(runTurn).not.toHaveBeenCalled()
		expect(master.timeline.map((message) => message.parts[0])).toEqual([
			{ type: 'text', text: TEXT_ONE },
		])
		expect(runtime.scheduler.active).toBeUndefined()
	})

	it('does not infer work from a user message at the timeline tail', async () => {
		const runTurn = vi.fn(async () => ({ status: 'completed', text: TEXT_TWO }))
		const { master, processor, runtime } = createHarness(runTurn)
		master.timeline.push({
			id: 'historical-user',
			role: 'user',
			metadata: { createdAt: 1 },
			parts: [{ type: 'text', text: TEXT_ONE }],
		})
		runtime.scheduler = createMasterTurnScheduler()

		await processor.start('session')

		expect(runTurn).not.toHaveBeenCalled()
	})
})
