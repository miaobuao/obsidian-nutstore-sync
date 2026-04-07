import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
	ChatPendingMessage,
	ChatSessionHistoryItem,
} from '~/chatbox/types'
import { z } from 'zod'
import ChatService from './chat.service'

const storageState = vi.hoisted(() => {
	const sessionStore = new Map<string, any>()
	const metaStore = new Map<string, any>()

	function createStore(store: Map<string, any>) {
		return {
			set: vi.fn(async (key: string, value: any) => {
				store.set(key, structuredClone(value))
				return value
			}),
			get: vi.fn(async (key: string) =>
				store.has(key) ? structuredClone(store.get(key)) : null,
			),
			unset: vi.fn(async (key: string) => {
				store.delete(key)
			}),
			clear: vi.fn(async () => {
				store.clear()
			}),
			dump: vi.fn(async () => Object.fromEntries(store.entries())),
		}
	}

	return {
		reset() {
			sessionStore.clear()
			metaStore.clear()
		},
		sessionStore,
		metaStore,
		chatSessionKV: createStore(sessionStore),
		chatMetaKV: createStore(metaStore),
	}
})

const { generateAssistantTurn, assertProviderUsable } = vi.hoisted(() => ({
	generateAssistantTurn: vi.fn(),
	assertProviderUsable: vi.fn(),
}))

vi.mock('~/ai/runtime', () => ({
	generateAssistantTurn,
	assertProviderUsable,
}))

vi.mock('~/storage', () => ({
	chatSessionKV: storageState.chatSessionKV,
	chatMetaKV: storageState.chatMetaKV,
}))

function createPlugin() {
	return {
		app: {},
		settings: {
			providers: [
				{
					id: 'provider-1',
					name: 'Provider',
					type: 'openai' as const,
					baseUrl: 'https://example.com/v1',
					apiKey: 'key',
					models: [
						{
							id: 'model-1',
							name: 'model-a',
						},
					],
				},
			],
			defaultProviderId: 'provider-1',
			defaultModelId: 'model-1',
		},
	}
}

function createPluginWithTwoProviders() {
	return {
		app: {},
		settings: {
			providers: [
				{
					id: 'provider-1',
					name: 'Provider 1',
					type: 'openai' as const,
					baseUrl: 'https://example.com/v1',
					apiKey: 'key',
					models: [
						{
							id: 'model-1',
							name: 'model-a',
						},
					],
				},
				{
					id: 'provider-2',
					name: 'Provider 2',
					type: 'openai' as const,
					baseUrl: 'https://example.org/v1',
					apiKey: 'key',
					models: [
						{
							id: 'model-2',
							name: 'model-b',
						},
					],
				},
			],
			defaultProviderId: 'provider-1',
			defaultModelId: 'model-1',
		},
	}
}

function deferredCompletion() {
	let resolve!: (value: {
		message: {
			role: 'assistant'
			content: { type: 'text'; text: string }[]
			tool_calls?: never[]
		}
		meta: {
			providerId?: string
			providerName?: string
			modelName?: string
		}
	}) => void
	const promise = new Promise<{
		message: {
			role: 'assistant'
			content: { type: 'text'; text: string }[]
			tool_calls?: never[]
		}
		meta: {
			providerId?: string
			providerName?: string
			modelName?: string
		}
	}>((nextResolve) => {
		resolve = nextResolve
	})

	return {
		promise,
		resolve: (text: string) =>
			resolve({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			}),
	}
}

function deferredResult<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve
		reject = nextReject
	})

	return { promise, resolve, reject }
}

function getActiveSession(service: ChatService) {
	return (service as any).getLoadedActiveSession()
}

function getLoadedSession(service: ChatService, sessionId: string) {
	return (service as any).loadedSessions.get(sessionId)
}

describe('ChatService fragment workflows', () => {
	beforeEach(() => {
		generateAssistantTurn.mockReset()
		assertProviderUsable.mockReset()
		storageState.reset()
	})

	it('creates a new fragment inside the active session', async () => {
		const service = new ChatService(createPlugin() as never)

		await service.ensureSession()
		service.createFragmentForActiveSession()

		const session = getActiveSession(service)
		expect(session.fragments).toHaveLength(2)
		expect(session.activeFragmentId).toBe(session.fragments[1].id)
		expect(session.fragments[0].messages).toHaveLength(0)
		expect(session.fragments[1].messages).toHaveLength(0)
	})

	it('compresses the active fragment into a new fragment and stores the summary as a user message', async () => {
		generateAssistantTurn
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Initial reply' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Compressed summary' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()
		await service.sendMessage('Original message')
		await service.compressContext()

		const session = getActiveSession(service)
		expect(session.fragments).toHaveLength(2)
		expect(session.activeFragmentId).toBe(session.fragments[1].id)
		expect(session.fragments[1].messages).toHaveLength(1)
		expect(session.fragments[1].messages[0].message.role).toBe('user')
		expect(session.fragments[1].messages[0].message.content?.[0]).toEqual({
			type: 'text',
			text: 'Compressed summary',
		})
	})

	it('queues messages while thinking and flushes them into the same fragment after completion', async () => {
		const first = deferredCompletion()
		generateAssistantTurn
			.mockImplementationOnce(() => first.promise)
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Reply to queued batch' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()

		const firstSend = service.sendMessage('First message')
		await Promise.resolve()
		await service.sendMessage('Second message')
		await service.sendMessage('Third message')

		expect(
			service
				.getViewProps()
				.pendingMessages.map((item: ChatPendingMessage) => item.text),
		).toEqual([
			'Second message',
			'Third message',
		])

		first.resolve('Reply to first message')
		await firstSend

		const session = getActiveSession(service)
		const fragment = session.fragments[0]
		const userMessages = fragment.messages.filter((item: any) => item.message.role === 'user')
		expect(userMessages).toHaveLength(2)
		expect(userMessages[1].message.content?.[0]).toEqual({
			type: 'text',
			text: 'Second message\n\nThird message',
		})
		expect(service.getViewProps().pendingMessages).toHaveLength(0)
	})

	it('stops thinking runs and removes unmatched tool calls from the assistant message', async () => {
		const response = deferredResult<{
			message: {
				role: 'assistant'
				content: { type: 'text'; text: string }[]
				tool_calls: {
					id: string
					type: 'function'
					function: {
						name: string
						arguments: string
					}
				}[]
			}
			meta: {
				providerId?: string
				providerName?: string
				modelName?: string
			}
		}>()

		generateAssistantTurn.mockImplementationOnce(() => response.promise)

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()

		const run = service.sendMessage('Need help')
		await vi.waitFor(() => {
			expect(service.getViewProps().runState).toBe('thinking')
		})
		service.getViewProps().onStopActiveRun?.()

		response.resolve({
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'Partial answer' }],
				tool_calls: [
					{
						id: 'tool-1',
						type: 'function',
						function: {
							name: 'spawn',
							arguments: JSON.stringify({ task: 'Inspect note' }),
						},
					},
				],
			},
			meta: {
				providerId: 'provider-1',
				providerName: 'Provider',
				modelName: 'model-a',
			},
		})
		await run

		const session = getActiveSession(service)
		const fragment = session.fragments[0]
		expect(fragment.messages).toHaveLength(2)
		expect(fragment.messages[1].message.role).toBe('assistant')
		expect(fragment.messages[1].message.tool_calls).toBeUndefined()
		expect(fragment.messages[1].message.content?.[0]).toEqual({
			type: 'text',
			text: 'Partial answer',
		})
	})

	it('does not create a new fragment when compression fails and resumes pending messages in the original fragment', async () => {
		const compression = deferredResult<{
			message: {
				role: 'assistant'
				content: { type: 'text'; text: string }[]
			}
			meta: {
				providerId?: string
				providerName?: string
				modelName?: string
			}
		}>()

		generateAssistantTurn
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Initial reply' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})
			.mockImplementationOnce(() => compression.promise)
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Reply after compression failure' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()
		await service.sendMessage('Original message')

		const compressRun = service.compressContext()
		await Promise.resolve()
		await service.sendMessage('Queued after failure')
		compression.reject(new Error('Compression failed'))
		await compressRun

		await vi.waitFor(() => {
			const session = getActiveSession(service)
			expect(session.fragments).toHaveLength(1)
			expect(session.activeFragmentId).toBe(session.fragments[0].id)
				expect(service.getViewProps().pendingMessages).toHaveLength(0)
				const userMessages = session.fragments[0].messages.filter(
					(item: any) => item.message.role === 'user',
				)
				expect(userMessages.map((item: any) => item.message.content?.[0])).toEqual([
				{ type: 'text', text: 'Original message' },
				{ type: 'text', text: 'Queued after failure' },
			])
		})
	})

	it('restores the active session from persisted storage and lazily loads non-active sessions', async () => {
		generateAssistantTurn
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'First response' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})
			.mockResolvedValueOnce({
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'Second response' }],
				},
				meta: {
					providerId: 'provider-1',
					providerName: 'Provider',
					modelName: 'model-a',
				},
			})

		const firstService = new ChatService(createPlugin() as never)
		await firstService.ensureSession()
		await firstService.sendMessage('First session message')
		await firstService.createSession()
		await firstService.sendMessage('Second session message')

		const secondSessionId = firstService.getViewProps().activeSessionId!
		const storedBeforeReload = await storageState.chatSessionKV.dump()
		expect(Object.keys(storedBeforeReload)).toHaveLength(2)

		const reloadedService = new ChatService(createPlugin() as never)
		await reloadedService.ensureSession()

		const props = reloadedService.getViewProps()
		expect(props.activeSessionId).toBe(secondSessionId)
		expect(props.sessionHistory).toHaveLength(2)
		const inactiveSession = props.sessionHistory.find(
			(session: ChatSessionHistoryItem) => session.id !== secondSessionId,
		)!
		const activeSession = getActiveSession(reloadedService)
		expect(activeSession.fragments[0].messages[0].message.content?.[0]).toEqual({
			type: 'text',
			text: 'Second session message',
		})

		await reloadedService.switchSession(inactiveSession.id)
		const switched = getLoadedSession(reloadedService, inactiveSession.id)
		expect(switched.fragments[0].messages[0].message.content?.[0]).toEqual({
			type: 'text',
			text: 'First session message',
		})
	})

	it('hard deletes a non-active session from storage and index', async () => {
		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()
		const firstSessionId = service.getViewProps().activeSessionId!

		await service.createSession()
		const secondSessionId = service.getViewProps().activeSessionId!

		await service.deleteSession(firstSessionId)

		const props = service.getViewProps()
		expect(props.activeSessionId).toBe(secondSessionId)
		expect(
			props.sessionHistory.map((session: ChatSessionHistoryItem) => session.id),
		).toEqual([secondSessionId])
		expect(await storageState.chatSessionKV.get(firstSessionId)).toBeNull()
		expect(await storageState.chatMetaKV.get('chat_meta')).toEqual({
			activeSessionId: secondSessionId,
			orderedSessionIds: [secondSessionId],
		})
	})

	it('allows deleting the last session and recreates one on the next send', async () => {
		generateAssistantTurn.mockResolvedValueOnce({
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'New response' }],
			},
			meta: {
				providerId: 'provider-1',
				providerName: 'Provider',
				modelName: 'model-a',
			},
		})

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()
		const sessionId = service.getViewProps().activeSessionId!

		await service.deleteSession(sessionId)

		expect(service.getViewProps().activeSessionId).toBeUndefined()
		expect(service.getViewProps().sessionHistory).toHaveLength(0)
		expect(service.getViewProps().selectedProviderId).toBe('provider-1')
		expect(service.getViewProps().selectedModelId).toBe('model-1')
		expect(service.getViewProps().canSend).toBe(true)
		expect(await storageState.chatSessionKV.get(sessionId)).toBeNull()
		expect(await storageState.chatMetaKV.get('chat_meta')).toEqual({
			activeSessionId: undefined,
			orderedSessionIds: [],
		})

		await service.sendMessage('Recreated session')

		const props = service.getViewProps()
		expect(props.activeSessionId).toBeTruthy()
		expect(props.sessionHistory).toHaveLength(1)
		expect(getActiveSession(service).fragments[0].messages[0].message.content?.[0]).toEqual({
			type: 'text',
			text: 'Recreated session',
		})
	})

	it('allows changing provider and model in the empty state before creating a new session', async () => {
		const service = new ChatService(createPluginWithTwoProviders() as never)
		await service.ensureSession()
		const sessionId = service.getViewProps().activeSessionId!

		await service.deleteSession(sessionId)

		service.selectProvider('provider-2')
		service.selectModel('model-2')

		const emptyStateProps = service.getViewProps()
		expect(emptyStateProps.selectedProviderId).toBe('provider-2')
		expect(emptyStateProps.selectedModelId).toBe('model-2')

		await service.createSession()

		const created = getActiveSession(service)
		expect(created.providerId).toBe('provider-2')
		expect(created.modelId).toBe('model-2')
	})

	it('deletes a thinking session after stopping the active run', async () => {
		const response = deferredResult<{
			message: {
				role: 'assistant'
				content: { type: 'text'; text: string }[]
				tool_calls?: never[]
			}
			meta: {
				providerId?: string
				providerName?: string
				modelName?: string
			}
		}>()

		generateAssistantTurn.mockImplementationOnce(() => response.promise)

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()

		const sendPromise = service.sendMessage('Delete me while thinking')
		await vi.waitFor(() => {
			expect(service.getViewProps().runState).toBe('thinking')
		})

		const sessionId = service.getViewProps().activeSessionId!
		const deletePromise = service.deleteSession(sessionId)

		response.resolve({
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'Late reply' }],
			},
			meta: {
				providerId: 'provider-1',
				providerName: 'Provider',
				modelName: 'model-a',
			},
		})

		await sendPromise
		await deletePromise

		expect(service.getViewProps().activeSessionId).toBeUndefined()
		expect(service.getViewProps().sessionHistory).toHaveLength(0)
		expect(await storageState.chatSessionKV.get(sessionId)).toBeNull()
	})

	it('cancels interrupted tasks during rehydration', async () => {
		generateAssistantTurn.mockResolvedValueOnce({
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'Initial response' }],
			},
			meta: {
				providerId: 'provider-1',
				providerName: 'Provider',
				modelName: 'model-a',
			},
		})

		const service = new ChatService(createPlugin() as never)
		await service.ensureSession()
		await service.sendMessage('Original message')

		const sessionId = service.getViewProps().activeSessionId!
		const stored = await storageState.chatSessionKV.get(sessionId)
		stored.tasks = [
			{
				id: 'task-1',
				sessionId,
				depth: 1,
				maxDepth: 2,
				label: 'Background work',
				task: 'Do something',
				status: 'running',
				createdAt: 1,
				startedAt: 2,
			},
		]
		await storageState.chatSessionKV.set(sessionId, stored)

		const reloadedService = new ChatService(createPlugin() as never)
		await reloadedService.ensureSession()

		const reloaded = getActiveSession(reloadedService)
		const userMessages = reloaded.fragments[0].messages.filter(
			(item: any) => item.message.role === 'user',
		)
		expect(userMessages.at(-1)?.message.content?.[0]).toEqual({
			type: 'text',
			text: 'Original message',
		})
		expect(reloadedService.getViewProps().pendingMessages).toHaveLength(0)
		expect(reloaded.tasks[0]).toMatchObject({
			status: 'cancelled',
			cancelReason: 'interrupted_by_restart',
		})
	})

	it('coerces numeric string arguments before executing tools', async () => {
		const service = new ChatService(createPlugin() as never)
		const execute = vi.fn(async (params: Record<string, unknown>) => ({
			depthType: typeof params.depth,
			depth: params.depth,
			limitType: typeof params.limit,
			limit: params.limit,
		}))

		const result = await (service as any).executeToolCall(
			[
				{
					name: 'test_tool',
					description: 'test',
					inputSchema: z.object({
						depth: z.number().int(),
						limit: z.number(),
					}),
					execute,
				},
			],
			'test_tool',
			JSON.stringify({
				depth: 2,
				limit: 20.5,
			}),
			{
				session: { id: 'session-1' },
				depth: 0,
				maxDepth: 2,
			},
		)

		expect(execute).toHaveBeenCalledOnce()
		expect(result).toEqual({
			depthType: 'number',
			depth: 2,
			limitType: 'number',
			limit: 20.5,
		})
	})
})
