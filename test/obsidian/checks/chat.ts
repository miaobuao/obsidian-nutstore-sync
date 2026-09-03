import type { App } from 'obsidian'
import type { PersistedChatSession } from '~/ai/chat/session/session-persistence'
import { assert } from './assert'

function sessionSnapshot(id: string): PersistedChatSession {
	return {
		schemaVersion: 2,
		id,
		createdAt: 1,
		updatedAt: 2,
		subagents: {
			master: {
				id: 'master',
				type: 'master',
				status: 'idle',
				createdAt: 1,
				timeline: [],
				pendingInputs: [],
				operations: {},
				toolTimings: {},
				subagents: {},
			},
		},
	} as PersistedChatSession
}

export async function persistsChatSessions(app: App) {
	const { SessionsFileBackend } =
		await import('~/ai/chat/session/session-files')
	const backend = new SessionsFileBackend(app.vault)
	const id = 'session-neutral-🌱'
	await backend.writeSessionFile(id, {
		session: sessionSnapshot(id),
		title: 'neutral session / 中性会话 🌱',
	})
	const payload = await backend.readSessionFile(id)
	assert(payload.session.id === id, 'Session ID did not persist')
	assert(
		payload.title === 'neutral session / 中性会话 🌱',
		'Session title did not persist',
	)
	assert(
		(await backend.listSessionIds()).includes(id),
		'Session file was not listed',
	)
	await backend.deleteSessionFile(id)
	assert(
		!(await backend.listSessionIds()).includes(id),
		'Session file was not deleted',
	)
}

export async function readsMemoryFiles(app: App) {
	const { MEMORY_ROOT, MemoryIndexRepository } =
		await import('~/ai/chat/context/memory-index')
	const path = `${MEMORY_ROOT}/2026/2026-09-01.md`
	await app.vault.adapter.mkdir(`${MEMORY_ROOT}/2026`)
	await app.vault.adapter.write(
		path,
		'---\nindex: neutral index 中性索引 🌱\n---\n\nneutral body',
	)
	const repository = new MemoryIndexRepository(app, {
		now: () => new Date('2026-09-01T12:00:00.000Z'),
	})
	await repository.refresh()
	const delta = repository
		.getDeltas()
		.find((entry) => entry.key === 'memory:2026-09-01')
	assert(delta, 'Memory file was not indexed')
	const content = delta.content as { index: string }
	assert(
		content.index === 'neutral index 中性索引 🌱',
		'Memory frontmatter was not read',
	)
}

export async function toleratesCorruptChatMeta(app: App) {
	const { SessionsFileBackend } =
		await import('~/ai/chat/session/session-files')
	const backend = new SessionsFileBackend(app.vault)
	const meta = { orderedSessionIds: [], sessions: {} }
	await backend.writeMetaFile(meta)
	assert(
		JSON.stringify(await backend.readMetaFile()) === JSON.stringify(meta),
		'Chat meta file did not round-trip',
	)
	await app.vault.adapter.write('.agents/nutstore-sync/chat-meta.json', '[[[')
	assert(
		(await backend.readMetaFile()) === null,
		'Corrupt chat meta file was accepted',
	)
}
