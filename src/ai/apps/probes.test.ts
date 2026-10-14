import { describe, expect, it, vi } from 'vitest'
import { createWorkshopHistory, createAppBuildTurn } from './domain'
import { createAppProbes } from './probes'

vi.mock('obsidian', () => ({
	TFile: class {
		constructor(
			public path: string,
			public basename: string,
			public stat = { mtime: 1, size: 1 },
		) {}
	},
	getAllTags: (cache: { tags: string[] }) => cache.tags,
}))
import { TFile } from 'obsidian'

async function output<T>(
	value: T | AsyncIterable<T> | PromiseLike<T | AsyncIterable<T>>,
): Promise<T> {
	const resolved = await value
	if (
		resolved &&
		typeof resolved === 'object' &&
		Symbol.asyncIterator in resolved
	) {
		let last: T | undefined
		for await (const item of resolved as AsyncIterable<T>) last = item
		if (last === undefined) throw new Error('Empty tool result')
		return last
	}
	return resolved as T
}

function fixture() {
	const files = [new TFile(), new TFile(), new TFile()]
	Object.assign(files[0], {
		path: '资料/Route 🌿.md',
		basename: 'Route 🌿',
		stat: { mtime: 1, size: 100 },
	})
	Object.assign(files[1], {
		path: '资料/Evidence 📘.md',
		basename: 'Evidence 📘',
		stat: { mtime: 1, size: 100 },
	})
	Object.assign(files[2], {
		path: '.agents/Internal.md',
		basename: 'Internal',
		stat: { mtime: 1, size: 100 },
	})
	const content: Record<string, string> = {
		[files[0].path]: '# 路线 Route 🌿\n比较两种路线 Compare two routes.',
		[files[1].path]: '# 依据 Evidence 📘\n路线的原文依据 Route evidence.',
		[files[2].path]: 'Private implementation data',
	}
	const history = createWorkshopHistory()
	const turn = createAppBuildTurn('路线 Route 🌿')
	const artifacts = new Map<string, string>()
	const deps = {
		app: {
			vault: {
				getMarkdownFiles: () => files,
				getAbstractFileByPath: (path: string) =>
					files.find((file) => file.path === path),
				cachedRead: async (file: TFile) => content[file.path],
			},
			metadataCache: {
				getFileCache: () => ({
					tags: ['#路线'],
					frontmatter: { category: '比较 Comparison 🌿' },
				}),
				resolvedLinks: { [files[0].path]: { [files[1].path]: 1 } },
				unresolvedLinks: {},
			},
		} as never,
		history,
		turn,
		allowedRefs: new Set<`s${number}`>(),
		writeArtifact: async (value: string) => {
			const id = String(artifacts.size)
			artifacts.set(id, value)
			return id
		},
		resolvePath: (source: { pathAtCapture: string }) => source.pathAtCapture,
		persist: async () => undefined,
	}
	return { tools: createAppProbes(deps), deps, artifacts, content, files }
}

describe('read-only local probes', () => {
	it('finds a union of keyword phrases once per note and preserves all matching', async () => {
		const { tools } = fixture()
		const options = { toolCallId: 'find', messages: [], context: {} }
		const found = await output(
			tools.find.execute!(
				{ text: ['比较', 'Evidence 📘', 'Route 🌿'], match: 'any' },
				options,
			),
		)
		expect(found.items).toHaveLength(2)
		expect(new Set(found.items.map((item) => item.path)).size).toBe(2)
		const all = await output(
			tools.find.execute!({ text: ['比较', 'Route 🌿'] }, options),
		)
		expect(all.items.map((item) => item.title)).toEqual(['Route 🌿'])
		const phrases = await output(
			tools.find.execute!({ text: ['路线 Route 🌿'] }, options),
		)
		expect(phrases.items.map((item) => item.title)).toEqual(['Route 🌿'])
	})
	it('paginates keyword unions and rejects cursors when matching rules change', async () => {
		const { tools } = fixture()
		const options = { toolCallId: 'find', messages: [], context: {} }
		const query = {
			text: ['比较', 'Evidence 📘', 'Route 🌿'],
			match: 'any' as const,
			limit: 1,
		}
		const first = await output(tools.find.execute!(query, options))
		const next = await output(
			tools.find.execute!({ ...query, cursor: first.nextCursor }, options),
		)
		expect(first.items).toHaveLength(1)
		expect(next.items).toHaveLength(1)
		expect(next.items[0].path).not.toBe(first.items[0].path)
		expect(next.coverage.exhausted).toBe(true)
		for (const change of [{ match: 'all' as const }, { text: ['路线 🌿'] }]) {
			await expect(
				tools.find.execute!(
					{ ...query, ...change, cursor: first.nextCursor },
					options,
				),
			).rejects.toThrow('Search changed')
		}
	})
	it('normalizes Unicode keywords and captures an excerpt around an actual match', async () => {
		const { tools, content, files } = fixture()
		content[files[0].path] =
			`${'中性背景 Neutral background 📘。'.repeat(100)}\n观察 ＲＯＵＴＥ 🌿 结论。`
		const found = await output(
			tools.find.execute!(
				{ text: ['不存在 Absent 🧭', 'route 🌿'], match: 'any' },
				{ toolCallId: 'find', messages: [], context: {} },
			),
		)
		expect(found.items).toHaveLength(1)
		expect(found.items[0].snippet).toContain('观察 ＲＯＵＴＥ 🌿 结论。')
	})
	it('searches Chinese/English/Emoji metadata and reads captured sources only', async () => {
		const { tools, deps, artifacts } = fixture()
		expect(Object.keys(tools)).toEqual(['find', 'read', 'follow'])
		const found = await output(
			tools.find.execute!(
				{ text: '路线 Route', scope: { tags: ['路线'] } },
				{ toolCallId: 'find', messages: [], context: {} },
			),
		)
		expect(found.items).toHaveLength(2)
		const selected = found.items.find((item) => item.path.includes('Route'))!
		const read = await output(
			tools.read.execute!(
				{ refs: [selected.ref], detail: 'content' },
				{ toolCallId: 'read', messages: [], context: {} },
			),
		)
		expect(read.items[0].content).toContain('Compare two routes')
		expect(read.items[0].ref).not.toBe(selected.ref)
		expect(
			deps.history.sources[selected.ref].evidenceArtifactId,
		).not.toBeUndefined()
		expect(
			[...artifacts.values()].some((value) => value.includes('Route 🌿')),
		).toBe(true)
		await expect(
			tools.read.execute!(
				{ refs: ['s99'], detail: 'content' },
				{ toolCallId: 'other', messages: [], context: {} },
			),
		).rejects.toThrow('outside')
	})
	it('paginates without exposing hidden files and follows one-hop note topology', async () => {
		const { tools } = fixture()
		const first = await output(
			tools.find.execute!(
				{ limit: 1 },
				{ toolCallId: 'find', messages: [], context: {} },
			),
		)
		expect(first.coverage.exhausted).toBe(false)
		const next = await output(
			tools.find.execute!(
				{ limit: 1, cursor: first.nextCursor },
				{ toolCallId: 'find-next', messages: [], context: {} },
			),
		)
		expect(next.coverage.exhausted).toBe(true)
		expect(
			[first.items[0].path, next.items[0].path].some((path) =>
				path.startsWith('.'),
			),
		).toBe(false)
		const route = [first, next]
			.flatMap((page) => page.items)
			.find((item) => item.path.includes('Route'))!
		const followed = await output(
			tools.follow.execute!(
				{ refs: [route.ref], direction: 'outgoing' },
				{ toolCallId: 'follow', messages: [], context: {} },
			),
		)
		expect(followed.items[0].path).toContain('Evidence 📘')
	})
	it('honors cancellation before reading the vault', async () => {
		const { tools } = fixture()
		const controller = new AbortController()
		controller.abort()
		await expect(
			tools.find.execute!(
				{},
				{
					toolCallId: 'find',
					messages: [],
					context: {},
					abortSignal: controller.signal,
				},
			),
		).rejects.toThrow()
	})
})
