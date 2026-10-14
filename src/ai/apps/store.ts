import type { App } from 'obsidian'
import { z } from 'zod/mini'
import { mkdirsVault } from '~/utils/mkdirs-vault'
import {
	readLocalText,
	writeLocalTextAtomic,
	removeLocalPath,
} from '~/utils/local-vault-io'
import createId from '~/utils/create-id'
import {
	appCodeSchema,
	appIdSchema,
	APP_ROOT_DIR,
	changeKV,
	validateKV,
	type AppRecord,
	type AppRevision,
	type AppKV,
	type SavedApp,
	type KVChange,
} from './domain'

const recordSchema = z.object({
	schemaVersion: z.literal(1),
	id: appIdSchema,
	createdAt: z.number(),
	updatedAt: z.number(),
	currentRevisionId: appIdSchema,
	revisionIds: z.array(appIdSchema),
	pinned: z.boolean(),
	kv: z.record(z.string(), z.unknown()),
})
const sourceSchema = z.object({
	id: z.string().check(z.regex(/^s[1-9]\d*$/)),
	pathAtCapture: z.string(),
	currentPath: z.optional(z.string()),
	titleAtCapture: z.string(),
	capturedAt: z.number(),
	fileVersion: z.string(),
	evidenceArtifactId: z.string(),
	toolCallId: z.string(),
	locator: z.union([
		z.object({ kind: z.literal('file') }),
		z.object({ kind: z.literal('heading'), heading: z.string() }),
	]),
})
const revisionSchema = z.object({
	schemaVersion: z.literal(1),
	id: appIdSchema,
	parentRevisionId: z.nullable(appIdSchema),
	createdAt: z.number(),
	code: appCodeSchema,
	evidence: z.array(z.object({ source: sourceSchema, content: z.string() })),
})
export function validateRevision(value: unknown): AppRevision {
	const revision = revisionSchema.parse(value)
	if (
		revision.code.assets.reduce((sum, asset) => sum + asset.dataUrl.length, 0) >
		4_000_000
	)
		throw new Error('App resources exceed their limit')
	const names = new Set<string>()
	for (const asset of revision.code.assets) {
		if (
			names.has(asset.name) ||
			!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(
				asset.dataUrl,
			)
		)
			throw new Error('Invalid App image resource')
		names.add(asset.name)
	}
	if (
		revision.code.sourceRefs.some(
			(ref) => !revision.evidence.some((item) => item.source.id === ref),
		)
	)
		throw new Error('Invalid App source reference')
	return revision as AppRevision
}

/** One queue per App serializes code, pin and KV commits. Disk is read before every mutation. */
export class AppStore {
	private readonly queues = new Map<string, Promise<unknown>>()
	private readonly listeners = new Set<() => void>()
	constructor(private readonly app: Pick<App, 'vault' | 'fileManager'>) {}
	subscribe(listener: () => void) {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	private notify() {
		for (const listener of this.listeners) listener()
	}
	private directory(id: string) {
		return `${APP_ROOT_DIR}/${appIdSchema.parse(id)}`
	}
	private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
		const next = (this.queues.get(id) ?? Promise.resolve())
			.catch(() => {})
			.then(action)
		this.queues.set(id, next)
		void next
			.finally(() => {
				if (this.queues.get(id) === next) this.queues.delete(id)
			})
			.catch(() => {})
		return next
	}
	private async readRecord(id: string): Promise<AppRecord> {
		const directory = this.directory(id)
		const parsed = recordSchema.parse(
			JSON.parse(await readLocalText(this.app.vault, `${directory}/app.json`)),
		)
		if (
			parsed.id !== id ||
			!parsed.revisionIds.includes(parsed.currentRevisionId)
		)
			throw new Error('Invalid App record')
		return { ...parsed, kv: validateKV(parsed.kv) }
	}
	async read(id: string): Promise<SavedApp> {
		const record = await this.readRecord(id)
		return {
			record,
			revision: await this.readRevision(id, record.currentRevisionId),
		}
	}
	async readKV(id: string, revisionId: string) {
		const record = await this.readRecord(id)
		if (record.currentRevisionId !== revisionId)
			throw new Error('This App version is no longer active')
		return record.kv
	}
	async readRevision(id: string, revisionId: string) {
		const revision = validateRevision(
			JSON.parse(
				await readLocalText(
					this.app.vault,
					`${this.directory(id)}/revisions/${appIdSchema.parse(revisionId)}.json`,
				),
			),
		)
		if (revision.id !== revisionId)
			throw new Error('Invalid App revision identity')
		return revision
	}
	async list(): Promise<Array<{ id: string; app?: SavedApp; error?: string }>> {
		if (!(await this.app.vault.adapter.exists(APP_ROOT_DIR))) return []
		const { folders } = await this.app.vault.adapter.list(APP_ROOT_DIR)
		return Promise.all(
			folders.map(async (folder) => {
				const id = folder.split('/').pop()!
				try {
					return { id, app: await this.read(id) }
				} catch (error) {
					return {
						id,
						error: error instanceof Error ? error.message : String(error),
					}
				}
			}),
		)
	}
	private async writeRecord(record: AppRecord, notify = true) {
		await writeLocalTextAtomic(
			this.app.vault,
			`${this.directory(record.id)}/app.json`,
			JSON.stringify(record, null, 2),
		)
		if (notify) this.notify()
	}
	private async writeRevision(id: string, revision: AppRevision) {
		validateRevision(revision)
		const directory = `${this.directory(id)}/revisions`
		await mkdirsVault(this.app.vault, directory)
		await writeLocalTextAtomic(
			this.app.vault,
			`${directory}/${revision.id}.json`,
			JSON.stringify(revision, null, 2),
		)
	}
	async create(revision: AppRevision, kv: AppKV): Promise<SavedApp> {
		const id = createId('app')
		// Saving starts the independent App's own version history; draft ancestors stay in the conversation archive.
		const root: AppRevision = {
			...revision,
			id: createId('app-revision'),
			parentRevisionId: null,
		}
		return this.serial(id, async () => {
			const checked = validateKV(kv)
			await this.writeRevision(id, root)
			const record: AppRecord = {
				schemaVersion: 1,
				id,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				currentRevisionId: root.id,
				revisionIds: [root.id],
				pinned: false,
				kv: checked,
			}
			await this.writeRecord(record)
			return { record, revision: root }
		})
	}
	async commit(id: string, revision: AppRevision): Promise<SavedApp> {
		return this.serial(id, async () => {
			const current = await this.readRecord(id)
			if (current.currentRevisionId !== revision.parentRevisionId)
				throw new Error('App changed; reload before modifying it')
			await this.writeRevision(id, revision)
			const record = {
				...current,
				updatedAt: Date.now(),
				currentRevisionId: revision.id,
				revisionIds: [...current.revisionIds, revision.id],
			}
			await this.writeRecord(record)
			return { record, revision }
		})
	}
	async restore(id: string, revisionId: string) {
		return this.serial(id, async () => {
			const current = await this.readRecord(id)
			if (!current.revisionIds.includes(revisionId))
				throw new Error('Unknown App revision')
			await this.readRevision(id, revisionId)
			await this.writeRecord({
				...current,
				currentRevisionId: revisionId,
				updatedAt: Date.now(),
			})
		})
	}
	async setPinned(id: string, pinned: boolean) {
		return this.serial(id, async () => {
			const record = await this.readRecord(id)
			await this.writeRecord({ ...record, pinned, updatedAt: Date.now() })
		})
	}
	async transact(id: string, revisionId: string, changes: KVChange[]) {
		return this.serial(id, async () => {
			const record = await this.readRecord(id)
			if (record.currentRevisionId !== revisionId)
				throw new Error('This App version is no longer active')
			await this.writeRecord(
				{ ...record, kv: changeKV(record.kv, changes), updatedAt: Date.now() },
				false,
			)
		})
	}
	async remove(id: string) {
		return this.serial(id, async () => {
			await removeLocalPath(this.app, this.directory(id), true)
			this.notify()
		})
	}
	async settle() {
		while (this.queues.size) await Promise.allSettled([...this.queues.values()])
	}
}
