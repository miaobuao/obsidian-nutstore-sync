import { describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import type { AppUIMessage, WorkspaceContextDelta } from '~/ai/chat/types'
import { computeChangedContexts } from '~/ai/chat/context/workspace-context'
import { MemoryIndexRepository, MEMORY_ROOT } from './memory-index'
import { createMemoryVault } from 'test/mocks/memory-vault'

const NOW = new Date('2026-02-10T12:00:00.000Z')

function createApp(vault: App['vault']) {
	return { vault } as unknown as App
}

function createRepo(vault: App['vault']) {
	return new MemoryIndexRepository(createApp(vault), { now: () => NOW })
}

function frontmatterFile(date: string, index?: string, body = '') {
	return [
		'---',
		`date: ${date}`,
		...(index === undefined ? [] : [`index: ${index}`]),
		'---',
		'',
		body,
	].join('\n')
}

function asPrevMessage(deltas: WorkspaceContextDelta[]): AppUIMessage {
	return {
		id: 'previous',
		role: 'user',
		parts: [{ type: 'data-workspace-context', data: { deltas } }],
	} as AppUIMessage
}

describe('memory index repository', () => {
	it('indexes only memory files within the recent window, one delta per file', async () => {
		const { vault } = createMemoryVault(
			{
				[`${MEMORY_ROOT}/2026/2026-02-10.md`]: frontmatterFile(
					'2026-02-10',
					'Today entry.',
				),
				[`${MEMORY_ROOT}/2026/2026-01-20.md`]: frontmatterFile(
					'2026-01-20',
					'Entry inside the window.',
				),
				// 36 days before now: outside the 30-day window.
				[`${MEMORY_ROOT}/2026/2026-01-05.md`]: frontmatterFile(
					'2026-01-05',
					'Old entry.',
				),
				// Previous year, well outside the window.
				[`${MEMORY_ROOT}/2025/2025-12-25.md`]: frontmatterFile(
					'2025-12-25',
					'Ancient entry.',
				),
			},
			[`${MEMORY_ROOT}/2026`, `${MEMORY_ROOT}/2025`],
		)

		const repo = createRepo(vault)
		await repo.refresh()
		const deltas = repo.getDeltas()

		expect(deltas.map((delta) => delta.key)).toEqual([
			'memory:2026-01-20',
			'memory:2026-02-10',
		])
		expect(deltas[0]).toEqual({
			key: 'memory:2026-01-20',
			content: {
				path: `${MEMORY_ROOT}/2026/2026-01-20.md`,
				index: 'Entry inside the window.',
			},
			hash: expect.any(String),
		})
	})

	it('keeps files without an index in the index with a bare path', async () => {
		const { vault } = createMemoryVault(
			{
				[`${MEMORY_ROOT}/2026/2026-02-09.md`]: frontmatterFile('2026-02-09'),
			},
			[`${MEMORY_ROOT}/2026`],
		)

		const repo = createRepo(vault)
		await repo.refresh()

		expect(repo.getDeltas()).toEqual([
			{
				key: 'memory:2026-02-09',
				content: { path: `${MEMORY_ROOT}/2026/2026-02-09.md` },
				hash: expect.any(String),
			},
		])
	})

	it('tolerates a missing memory directory', async () => {
		const { vault } = createMemoryVault()
		const repo = createRepo(vault)
		await repo.refresh()
		expect(repo.getDeltas()).toEqual([])
	})

	it('never reads the derived catalog or anything outside the archive', async () => {
		const memoryDir = MEMORY_ROOT.slice(0, MEMORY_ROOT.lastIndexOf('/'))
		const { vault } = createMemoryVault(
			{
				[`${MEMORY_ROOT}/2026/2026-02-10.md`]: frontmatterFile(
					'2026-02-10',
					'Today entry.',
				),
				// Sibling derived retrieval catalog — the plugin must ignore it.
				[`${memoryDir}/catalog/2026.tsv`]:
					'2026-02-10\tTab-separated catalog copy of the day index.',
			},
			[`${MEMORY_ROOT}/2026`, `${memoryDir}/catalog`],
		)

		const repo = createRepo(vault)
		await repo.refresh()

		expect(repo.getDeltas().map((delta) => delta.key)).toEqual([
			'memory:2026-02-10',
		])
	})

	it('handles mixed Chinese, English and Emoji content in the index', async () => {
		const { vault } = createMemoryVault(
			{
				[`${MEMORY_ROOT}/2026/2026-02-08.md`]: frontmatterFile(
					'2026-02-08',
					'中文示例条目 · demo entry 🌱 的新组合',
				),
			},
			[`${MEMORY_ROOT}/2026`],
		)

		const repo = createRepo(vault)
		await repo.refresh()

		expect(repo.getDeltas()).toEqual([
			{
				key: 'memory:2026-02-08',
				content: {
					path: `${MEMORY_ROOT}/2026/2026-02-08.md`,
					index: '中文示例条目 · demo entry 🌱 的新组合',
				},
				hash: expect.any(String),
			},
		])
	})

	it('yields no deltas while disabled, and returns them after being enabled', async () => {
		const { vault, files } = createMemoryVault(
			{
				[`${MEMORY_ROOT}/2026/2026-02-10.md`]: frontmatterFile(
					'2026-02-10',
					'Today entry.',
				),
			},
			[`${MEMORY_ROOT}/2026`],
		)
		const repo = new MemoryIndexRepository(createApp(vault), {
			now: () => NOW,
			enabled: false,
		})
		await repo.refresh()
		expect(repo.getDeltas()).toEqual([])

		repo.setEnabled(true)
		await repo.refresh()
		expect(repo.getDeltas().map((delta) => delta.key)).toEqual([
			'memory:2026-02-10',
		])

		// Re-disabling drops the injected entries immediately.
		repo.setEnabled(false)
		await repo.refresh()
		expect(repo.getDeltas()).toEqual([])
		// The file still exists on disk; only injection is off.
		expect(files.get(`${MEMORY_ROOT}/2026/2026-02-10.md`)).toMatchObject({
			type: 'file',
			content: frontmatterFile('2026-02-10', 'Today entry.'),
		})
	})

	it('re-emits only the changed window entry through the delta hashing', async () => {
		const { vault, files } = createMemoryVault(
			{
				[`${MEMORY_ROOT}/2026/2026-02-10.md`]: frontmatterFile(
					'2026-02-10',
					'Original index.',
				),
				[`${MEMORY_ROOT}/2026/2026-02-09.md`]: frontmatterFile(
					'2026-02-09',
					'Stable entry.',
				),
			},
			[`${MEMORY_ROOT}/2026`],
		)

		const repo = createRepo(vault)
		await repo.refresh()
		const previous = repo.getDeltas()

		// The agent rewrites today's frontmatter index on the next turn.
		files.set(`${MEMORY_ROOT}/2026/2026-02-10.md`, {
			type: 'file',
			content: frontmatterFile('2026-02-10', 'Updated index with new fact.'),
			mtime: 999,
		})

		await repo.refresh()
		const current = repo.getDeltas()
		const changed = computeChangedContexts([asPrevMessage(previous)], current)

		expect(changed.map((delta) => delta.key)).toEqual(['memory:2026-02-10'])
		expect(
			changed.find((delta) => delta.key === 'memory:2026-02-10')?.content,
		).toMatchObject({ index: 'Updated index with new fact.' })
	})
})
