import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AppStore } from './store'
import { changeKV, type AppRevision } from './domain'

const disk = vi.hoisted(() => new Map<string, string>())
const control = vi.hoisted(() => ({ fail: false }))
vi.mock('obsidian', () => ({}))
vi.mock('~/utils/mkdirs-vault', () => ({ mkdirsVault: async () => {} }))
vi.mock('~/utils/local-vault-io', () => ({
	readLocalText: async (_vault: unknown, path: string) => {
		if (!disk.has(path)) throw new Error('Missing file')
		return disk.get(path)!
	},
	writeLocalTextAtomic: async (
		_vault: unknown,
		path: string,
		content: string,
	) => {
		if (control.fail) throw new Error('Write failed')
		disk.set(path, content)
	},
	removeLocalPath: async (_app: unknown, path: string) => {
		for (const key of disk.keys())
			if (key.startsWith(`${path}/`)) disk.delete(key)
	},
}))
function revision(
	id = 'revision-neutral',
	parentRevisionId: string | null = null,
): AppRevision {
	return {
		schemaVersion: 1,
		id,
		parentRevisionId,
		createdAt: 1,
		code: {
			title: '中性计数器 Neutral counter 🌿',
			iconSvg:
				'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>',
			html: '<button>增加 Add 🌿</button>',
			css: '',
			javascript: '',
			dataVersion: 1,
			assets: [],
			sourceRefs: [],
		},
		evidence: [],
	}
}
const app = {
	vault: {
		adapter: {
			exists: async (path: string) =>
				[...disk.keys()].some((key) => key.startsWith(path)),
			list: async (path: string) => ({
				folders: [
					...new Set(
						[...disk.keys()].map((key) =>
							key.slice(0, key.indexOf('/', path.length + 1)),
						),
					),
				],
			}),
		},
	},
} as never

beforeEach(() => {
	disk.clear()
	control.fail = false
})
describe('independent App storage', () => {
	it('round-trips code, resources, Unicode data and pin state independently of conversations', async () => {
		const store = new AppStore(app)
		const code = revision()
		code.code.assets = [
			{ name: '图标 Image 🌿', dataUrl: 'data:image/png;base64,AAAA' },
		]
		const saved = await store.create(code, {
			'进度 Progress 🌿': { title: '路线 Route 🧭', count: 1 },
		})
		await store.setPinned(saved.record.id, true)
		const fresh = new AppStore(app)
		expect((await fresh.read(saved.record.id)).revision).toEqual({
			...code,
			id: saved.revision.id,
			parentRevisionId: null,
		})
		expect(saved.revision.id).not.toBe(code.id)
		expect((await fresh.read(saved.record.id)).record).toMatchObject({
			pinned: true,
			kv: { '进度 Progress 🌿': { title: '路线 Route 🧭', count: 1 } },
		})
		expect((await fresh.list())[0].app?.record.id).toBe(saved.record.id)
		expect(
			[...disk.keys()].every((path) =>
				path.includes(`/apps/${saved.record.id}/`),
			),
		).toBe(true)
	})
	it('serializes multi-key transactions and preserves data through code changes and restore', async () => {
		const store = new AppStore(app)
		const saved = await store.create(revision(), {})
		await Promise.all([
			store.transact(saved.record.id, saved.revision.id, [
				{ key: '记录 Record 🌿', value: 2 },
				{ key: '设置 Settings 中文', value: false },
			]),
			store.transact(saved.record.id, saved.revision.id, [
				{ key: '第二 Second 🧭', value: ['完成 Done'] },
			]),
		])
		const next = revision('revision-next', saved.revision.id)
		await store.commit(saved.record.id, next)
		await expect(
			store.transact(saved.record.id, saved.revision.id, [
				{ key: 'stale', value: 1 },
			]),
		).rejects.toThrow('no longer active')
		await expect(
			store.commit(
				saved.record.id,
				revision('revision-conflict', saved.revision.id),
			),
		).rejects.toThrow('changed')
		await store.restore(saved.record.id, saved.revision.id)
		expect((await store.read(saved.record.id)).record.kv).toEqual({
			'记录 Record 🌿': 2,
			'设置 Settings 中文': false,
			'第二 Second 🧭': ['完成 Done'],
		})
	})
	it('failed writes do not acknowledge or expose partial KV updates', async () => {
		const store = new AppStore(app)
		const saved = await store.create(revision(), { count: 1 })
		control.fail = true
		await expect(
			store.transact(saved.record.id, saved.revision.id, [
				{ key: 'count', value: 2 },
				{ key: '文本 Text 🌿', value: '已完成 Done' },
			]),
		).rejects.toThrow('Write failed')
		control.fail = false
		expect((await store.read(saved.record.id)).record.kv).toEqual({ count: 1 })
		await store.transact(saved.record.id, saved.revision.id, [
			{ key: 'count', value: 3 },
		])
		expect((await store.read(saved.record.id)).record.kv.count).toBe(3)
	})
	it('rejects traversal, unsafe keys, lossy values and oversized Unicode values', async () => {
		const store = new AppStore(app)
		await expect(store.read('../other')).rejects.toThrow()
		for (const value of [
			undefined,
			NaN,
			Infinity,
			new Date(),
			{ nested: undefined },
		])
			expect(() =>
				changeKV({}, [{ key: '数据 Data 🌿', value: value as never }]),
			).toThrow()
		expect(() => changeKV({}, [{ key: '__proto__', value: 1 }])).toThrow()
		expect(() =>
			changeKV({}, [{ key: '数据 Data 🌿', value: '中🌿'.repeat(40_000) }]),
		).toThrow('limit')
	})
	it('deleting an App removes its code/data but cannot delete a build conversation', async () => {
		const store = new AppStore(app)
		const saved = await store.create(revision(), {})
		disk.set(
			'.agents/nutstore-sync/sessions/build.json',
			'中性会话 Neutral conversation 🌿',
		)
		await store.remove(saved.record.id)
		expect(disk.get('.agents/nutstore-sync/sessions/build.json')).toContain(
			'中性会话',
		)
		await expect(store.read(saved.record.id)).rejects.toThrow('Missing')
	})
})
