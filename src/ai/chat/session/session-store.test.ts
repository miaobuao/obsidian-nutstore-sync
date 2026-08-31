import { describe, expect, it } from 'vitest'
import { createMemoryVault } from 'test/mocks/memory-vault'
import type { ChatSession } from '~/ai/chat/domain'
import { ChatState } from '~/ai/chat/runtime/chat-state'
import { RuntimeStates } from '~/ai/chat/runtime/runtime-state'
import type { Selection } from '~/ai/chat/runtime/selection'
import {
	SessionsFileBackend,
	CHAT_SESSIONS_DIR,
} from '~/ai/chat/session/session-files'
import {
	decodeChatSessionFromStorage,
	encodeChatSessionForStorage,
	type PersistedChatSession,
} from '~/ai/chat/session/session-persistence'
import type { ReversibleToolOp } from '~/ai/chat/types'
import {
	SessionUnavailableError,
	SessionStore,
	type SessionLegacyStore,
} from '~/ai/chat/session/session-store'
import { BASH_TMP_MOUNT_POINT } from '~/ai/tools/bash/mount-points'

function createState() {
	return new ChatState()
}

function createSelection(): Selection {
	return {
		sanitizeSessionSelection: () => false,
	} as unknown as Selection
}

function legacyV1PersistedRecord(id = 'legacy1'): PersistedChatSession {
	return {
		schemaVersion: 2,
		id,
		createdAt: 1,
		updatedAt: 1,
		subagents: {
			master: {
				id: 'master',
				type: 'master',
				status: 'idle',
				createdAt: 1,
				timeline: [
					{
						id: 'm1',
						role: 'user',
						metadata: { createdAt: 1 },
						parts: [
							{
								type: 'data-user-context',
								data: {
									items: [
										{
											type: 'image',
											hash: 'x',
											mimeType: 'image/png',
											size: 5,
											blob: {
												__nutstore_chat_blob_v1: true,
												type: 'image/png',
												data: new Uint8Array([1, 2, 3, 4, 5]).buffer,
											},
										},
									],
								},
							},
						],
					},
				],
				pendingInputs: [],
				operations: {},
				toolTimings: {},
				subagents: {},
			},
		},
	} as unknown as PersistedChatSession
}

function legacyTimelinePersistedRecord(id = 'legacy1'): PersistedChatSession {
	return {
		id,
		createdAt: 1,
		updatedAt: 2,
		activeFragmentId: 'fragment1',
		fragments: [
			{
				id: 'fragment1',
				createdAt: 1,
				updatedAt: 2,
				messages: [
					{
						id: 'message1',
						createdAt: 1,
						message: { role: 'user', content: 'Hello / 你好' },
						userContext: [
							{
								type: 'image',
								hash: 'image1',
								mimeType: 'image/png',
								size: 5,
								blob: {
									__nutstore_chat_blob_v1: true,
									type: 'image/png',
									data: new Uint8Array([1, 2, 3, 4, 5]).buffer,
								},
							},
						],
					},
				],
			},
		],
	} as unknown as PersistedChatSession
}

describe('SessionStore (vault file persistence)', () => {
	it('loads a complete valid index from meta without reading session bodies', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const sessions = [
			{ id: 'session-a', title: 'Session A / 会话甲 🙂', updatedAt: 3 },
			{ id: 'session-b', title: 'Session B / 会话乙 🌿', updatedAt: 2 },
		]
		for (const session of sessions) {
			await backend.writeSessionFile(session.id, {
				session: legacyV1PersistedRecord(session.id),
				title: session.title,
			})
		}
		await backend.writeMetaFile({
			activeSessionId: 'session-b',
			orderedSessionIds: ['session-b', 'session-a'],
			sessions: Object.fromEntries(
				sessions.map((session) => [
					session.id,
					{
						title: session.title,
						createdAt: 1,
						updatedAt: session.updatedAt,
					},
				]),
			),
		})
		const sessionReads: string[] = []
		const read = vault.adapter.read.bind(vault.adapter)
		vault.adapter.read = async (path) => {
			if (path.startsWith(`${CHAT_SESSIONS_DIR}/`)) sessionReads.push(path)
			return read(path)
		}
		const state = createState()
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			{
				listSessionKeys: async () => [],
				getSession: async () => undefined,
				unsetSession: async () => undefined,
				getMeta: async () => ({ meta: null, index: [] }),
			},
		)

		await store.loadSessionIndex()

		expect(state.sessionIndex).toEqual([
			{
				id: 'session-b',
				title: 'Session B / 会话乙 🌿',
				createdAt: 1,
				updatedAt: 2,
			},
			{
				id: 'session-a',
				title: 'Session A / 会话甲 🙂',
				createdAt: 1,
				updatedAt: 3,
			},
		])
		expect(state.activeSessionId).toBe('session-b')
		expect(sessionReads).toEqual([])
	})

	it('removes a corrupt non-active session after lazy loading fails', async () => {
		const { vault, files } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		await backend.writeSessionFile('valid', {
			session: legacyV1PersistedRecord('valid'),
			title: 'Valid / 有效会话 🌿',
		})
		files.set(`${CHAT_SESSIONS_DIR}/corrupt.json`, {
			type: 'file',
			content: JSON.stringify({
				session: {
					schemaVersion: 2,
					id: 'corrupt',
					createdAt: 1,
					updatedAt: 1,
					binary: {
						__nutstore_chat_binary_v2: true,
						kind: 'Uint8Array',
						data: 'invalid!',
					},
				},
			}),
			mtime: 2,
		})
		await backend.writeMetaFile({
			activeSessionId: 'valid',
			orderedSessionIds: ['valid', 'corrupt'],
			sessions: {
				valid: {
					title: 'Valid / 有效会话 🌿',
					createdAt: 1,
					updatedAt: 1,
				},
				corrupt: {
					title: 'Unavailable / 不可用会话',
					createdAt: 1,
					updatedAt: 1,
				},
			},
		})
		const emptyLegacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const state = createState()
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			emptyLegacy,
		)

		await store.loadSessionIndex()
		expect(state.sessionIndex.map((item) => item.id)).toEqual([
			'valid',
			'corrupt',
		])
		await expect(store.loadSessionById('corrupt')).rejects.toBeInstanceOf(
			SessionUnavailableError,
		)
		expect(state.sessionIndex.map((item) => item.id)).toEqual(['valid'])

		const reloadedState = createState()
		const reloadedStore = new SessionStore(
			reloadedState,
			new RuntimeStates(reloadedState),
			createSelection(),
			backend,
			emptyLegacy,
		)
		await reloadedStore.loadSessionIndex()
		expect(reloadedState.sessionIndex.map((item) => item.id)).toEqual(['valid'])
	})

	it('migrates legacy IndexedDB sessions into vault files', async () => {
		const { vault, files } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const state = createState()
		const legacy = {
			listSessionKeys: async () => ['legacy1'],
			getSession: async () => legacyTimelinePersistedRecord(),
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			legacy,
		)

		await store.loadSessionIndex()

		expect([...files.keys()]).toContain(`${CHAT_SESSIONS_DIR}/legacy1.json`)
		expect(state.sessionIndex.map((item) => item.id)).toEqual(['legacy1'])
		expect(state.activeSessionId).toBe('legacy1')
		const payload = await backend.readSessionFile('legacy1')
		expect(payload.session).toMatchObject({
			schemaVersion: 2,
			id: 'legacy1',
		})
		expect(payload.session).not.toHaveProperty('fragments')
		expect(JSON.stringify(payload)).not.toContain('__nutstore_chat_blob_v1')

		const session = await store.loadSessionById('legacy1')
		expect(session.id).toBe('legacy1')
		const item = session.subagents.master.timeline[0].parts.find(
			(part) => part.type === 'data-user-context',
		)
		if (!item) throw new Error('expected context')
		if (item.type !== 'data-user-context') throw new Error('expected context')
		const blob = (item.data as { items: Array<{ blob: Blob }> }).items[0].blob
		expect(blob).toBeInstanceOf(Blob)
		expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
			new Uint8Array([1, 2, 3, 4, 5]),
		)
	})

	it('migrates only missing legacy sessions and preserves legacy metadata', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		await backend.writeSessionFile('existing', {
			session: legacyV1PersistedRecord('existing'),
			title: 'Existing / 现有会话',
		})
		const state = createState()
		const legacyLookups: string[] = []
		const legacy = {
			listSessionKeys: async () => ['existing', 'legacy-only'],
			getSession: async (id: string) => {
				legacyLookups.push(id)
				return legacyV1PersistedRecord(id)
			},
			unsetSession: async () => undefined,
			getMeta: async () => ({
				meta: {
					orderedSessionIds: ['legacy-only', 'existing'],
					activeSessionId: 'existing',
				},
				index: [
					{
						id: 'legacy-only',
						title: 'Migrated / 已迁移会话',
						createdAt: 1,
						updatedAt: 1,
					},
				],
			}),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			legacy,
		)

		await store.loadSessionIndex()

		expect(legacyLookups).toEqual(['legacy-only'])
		expect(state.sessionIndex.map((item) => item.id)).toEqual([
			'legacy-only',
			'existing',
		])
		expect(state.sessionIndex[0].title).toBe('Migrated / 已迁移会话')
		expect(state.activeSessionId).toBe('existing')
	})

	it('skips corrupt indexed files and selects a valid session', async () => {
		const { vault, files } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		await backend.writeSessionFile('valid', {
			session: legacyV1PersistedRecord('valid'),
			title: 'Valid / 有效会话',
		})
		files.set(`${CHAT_SESSIONS_DIR}/corrupt.json`, {
			type: 'file',
			content: JSON.stringify({
				session: {
					schemaVersion: 2,
					id: 'corrupt',
					createdAt: 1,
					updatedAt: 1,
					subagents: { master: {} },
					attachment: {
						__nutstore_chat_blob_v2: true,
						type: 'text/plain',
						data: 'invalid!',
					},
				},
			}),
			mtime: 42,
		})
		await backend.writeMetaFile({
			activeSessionId: 'corrupt',
			orderedSessionIds: ['corrupt', 'valid'],
			sessions: {
				corrupt: { title: 'Corrupt / 损坏会话', createdAt: 1, updatedAt: 1 },
				valid: { title: 'Valid / 有效会话', createdAt: 1, updatedAt: 1 },
			},
		})
		const state = createState()
		const legacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			legacy,
		)

		await store.loadInitialSession()

		expect(state.sessionIndex.map((item) => item.id)).toEqual(['valid'])
		expect(state.activeSessionId).toBe('valid')
		expect(state.loadedSessions.get('valid')).toMatchObject({
			id: 'valid',
		})
	})

	it('rebuilds the index when the meta file is lost', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		await backend.writeSessionFile('a', {
			session: legacyV1PersistedRecord(),
			title: 'Alpha',
		})
		const state = createState()
		const emptyLegacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			emptyLegacy,
		)

		await store.loadSessionIndex()
		const meta = await backend.readMetaFile()

		expect(state.sessionIndex.map((item) => item.id)).toEqual(['a'])
		expect(state.sessionIndex[0].title).toBe('Alpha')
		expect(meta?.orderedSessionIds).toEqual(['a'])
		expect(meta?.sessions['a']?.title).toBe('Alpha')
	})

	it('deletes the session file', async () => {
		const { vault, files } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		await backend.writeSessionFile('gone', {
			session: legacyV1PersistedRecord(),
		})
		const state = createState()
		let unsetCalled = false
		const legacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => {
				unsetCalled = true
			},
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			legacy,
		)

		await store.deleteSession('gone')

		expect([...files.keys()]).not.toContain(`${CHAT_SESSIONS_DIR}/gone.json`)
		expect(unsetCalled).toBe(true)
	})

	it('persists a session snapshot that survives JSON round-trip', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const state = createState()
		const emptyLegacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			emptyLegacy,
		)

		const session = decodeChatSessionFromStorage(
			legacyV1PersistedRecord(),
		) as ChatSession
		await store.persistSession(session)
		const payload = await backend.readSessionFile('legacy1')

		expect(() => JSON.stringify(payload)).not.toThrow()
		expect(JSON.stringify(payload)).not.toContain('"__nutstore_chat_blob_v1"')
		expect(JSON.stringify(payload)).not.toContain('"0":1')
	})

	it('does not recreate a session deleted during an in-flight write', async () => {
		const { vault, files } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const originalWrite = backend.writeSessionFile.bind(backend)
		let releaseWrite: (() => void) | undefined
		const writeBlocked = new Promise<void>((resolve) => {
			releaseWrite = resolve
		})
		let markWriteStarted: (() => void) | undefined
		const writeStarted = new Promise<void>((resolve) => {
			markWriteStarted = resolve
		})
		backend.writeSessionFile = async (id, payload) => {
			markWriteStarted?.()
			await writeBlocked
			await originalWrite(id, payload)
		}
		const state = createState()
		const legacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			legacy,
		)
		const session = decodeChatSessionFromStorage(
			legacyV1PersistedRecord('pending'),
		) as ChatSession

		const persist = store.persistSession(session)
		await writeStarted
		const deletion = store.deleteSession('pending')
		releaseWrite?.()
		await Promise.all([persist, deletion])

		expect([...files.keys()]).not.toContain(`${CHAT_SESSIONS_DIR}/pending.json`)
	})

	async function writeSessionWithOps(
		backend: SessionsFileBackend,
		id: string,
		operations: ReversibleToolOp[],
	) {
		const session = decodeChatSessionFromStorage(
			legacyV1PersistedRecord(id),
		) as ChatSession
		session.subagents.master.operations = { m1: operations }
		await backend.writeSessionFile(id, {
			session: await encodeChatSessionForStorage(session),
			title: `Archived / 归档 ${id}`,
		})
		return session
	}

	it('rewrites absolute /vault op paths to relative when loading a persisted session', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const state = createState()
		const emptyLegacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			emptyLegacy,
		)

		await writeSessionWithOps(backend, 'conv-abs', [
			{
				vaultPath: '/vault/notes/example.md',
				operation: 'update',
				before: { kind: 'file', contentBase64: 'YQo=' },
			},
		] as ReversibleToolOp[])

		const loaded = await store.loadSessionById('conv-abs')
		expect(
			loaded.subagents.master.operations.m1?.map((op) => op.vaultPath),
		).toEqual(['notes/example.md'])

		const payload = await backend.readSessionFile('conv-abs')
		const serialized = JSON.stringify(payload)
		expect(serialized).not.toContain('/vault/notes/example.md')
		expect(serialized).toContain('notes/example.md')
	})

	it('normalizes the legacy vault prefix without rewriting the legacy tmp alias', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const state = createState()
		const emptyLegacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			emptyLegacy,
		)

		await writeSessionWithOps(backend, 'conv-mixed', [
			{
				vaultPath: '/vault/随笔/日常记录.md',
				operation: 'update',
				before: { kind: 'file', contentBase64: '5a+56K+0Cg==' },
			},
			{
				vaultPath: '/tmp/scratch.txt',
				operation: 'update',
				before: { kind: 'file', contentBase64: 'YQo=' },
			},
		] as ReversibleToolOp[])

		await store.loadSessionById('conv-mixed')
		const payload = await backend.readSessionFile('conv-mixed')
		const serialized = JSON.stringify(payload)
		expect(serialized).toContain('随笔/日常记录.md')
		expect(serialized).not.toContain('/vault/随笔/日常记录.md')
		expect(serialized).toContain('"vaultPath":"/tmp/scratch.txt"')
	})

	it('does not rewrite the file when ops are already normalized', async () => {
		const { vault } = createMemoryVault()
		const backend = new SessionsFileBackend(vault)
		const state = createState()
		const emptyLegacy = {
			listSessionKeys: async () => [],
			getSession: async () => undefined,
			unsetSession: async () => undefined,
			getMeta: async () => ({ meta: null, index: [] }),
		} as SessionLegacyStore
		const store = new SessionStore(
			state,
			new RuntimeStates(state),
			createSelection(),
			backend,
			emptyLegacy,
		)

		await writeSessionWithOps(backend, 'conv-rel', [
			{
				vaultPath: 'notes/example.md',
				operation: 'update',
				before: { kind: 'file', contentBase64: 'YQo=' },
			},
			{
				vaultPath: `${BASH_TMP_MOUNT_POINT}/scratch.txt`,
				operation: 'update',
				before: { kind: 'file', contentBase64: 'YQo=' },
			},
		] as ReversibleToolOp[])

		let writes = 0
		const originalWrite = backend.writeSessionFile.bind(backend)
		backend.writeSessionFile = async (id, payload) => {
			writes += 1
			await originalWrite(id, payload)
		}

		await store.loadSessionById('conv-rel')

		expect(writes).toBe(0)
		const payload = await backend.readSessionFile('conv-rel')
		expect(JSON.stringify(payload)).toContain('notes/example.md')
		expect(JSON.stringify(payload)).toContain(
			`${BASH_TMP_MOUNT_POINT}/scratch.txt`,
		)
	})
})
