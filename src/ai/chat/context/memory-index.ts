import { hash as hashObject } from 'ohash'
import { normalizePath, type App } from 'obsidian'
import { parseYamlFrontmatter } from '~/ai/skills/frontmatter'
import type { WorkspaceContextDelta } from '~/ai/chat/types'

/**
 * Vault-relative root of the long-term memory documents, sibling to the chat
 * sessions (`$CHAT_ROOT_DIR/memory`). Mirrors the layout described by the
 * built-in `long-term-memory` Skill: `memory/archive/<YYYY>/<YYYY-MM-DD>.md`.
 *
 * This archive is the single authoritative memory source. The plugin only
 * ever scans it (see `refresh`) and never writes any memory file. The Agent
 * maintains a derived per-year retrieval catalog (`memory/catalog/<YYYY>.tsv`)
 * rebuilt from the daily files — never authoritative — and reaches memory
 * beyond the window via `find`/`grep`.
 */
export const MEMORY_ROOT = '.agents/nutstore-sync/memory/archive'

/** How many days of memory files are carried in the injected index. */
export const MEMORY_INDEX_DAYS = 30

export interface MemoryIndexOptions {
	/** Clock override for deterministic tests. */
	now?: () => Date
	/** Size of the injected index window in days. */
	windowDays?: number
	/** Whether long-term memory injection is enabled (settings gate). */
	enabled?: boolean
}

export interface MemoryIndexEntryContent {
	/** Vault-relative path; the trailing date segment doubles as the date. */
	path: string
	/** Natural-language index written by the agent; absent when unwritten. */
	index?: string
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function dayKey(date: Date) {
	return date.toISOString().slice(0, 10)
}

function isDateWithinWindow(date: string, cutoffDay: string, todayDay: string) {
	return date >= cutoffDay && date <= todayDay
}

/**
 * Builds the per-file `memory:` workspace-context deltas from the long-term
 * memory directory. Mirrors the Skill repository's refresh/capture split:
 * `refresh()` re-reads the vault (async), `getDeltas()` is a cheap sync read
 * of the result, so `captureWorkspaceContexts` stays synchronous.
 *
 * Only files within the recent window are injected; older memory is reached by
 * the agent via `find`/`grep` over the archive and its derived catalog (see the
 * built-in Skill). Each file is its own delta key
 * (`memory:<YYYY-MM-DD>`), so an unchanged memory file is never re-sent by the
 * existing hash comparison in `computeChangedContexts`.
 */
export class MemoryIndexRepository {
	private readonly now: () => Date
	private readonly windowDays: number
	private enabled: boolean
	private deltas: WorkspaceContextDelta[] = []

	constructor(
		private app: App,
		options: MemoryIndexOptions = {},
	) {
		this.now = options.now ?? (() => new Date())
		this.windowDays = options.windowDays ?? MEMORY_INDEX_DAYS
		this.enabled = options.enabled ?? true
	}

	/** Gate updated live from settings; a disabled store always yields no deltas. */
	setEnabled(enabled: boolean) {
		if (this.enabled === enabled) return
		this.enabled = enabled
		if (!enabled) this.deltas = []
	}

	get enabledFlag() {
		return this.enabled
	}

	async refresh(): Promise<void> {
		if (!this.enabled) {
			this.deltas = []
			return
		}
		const adapter = this.app.vault.adapter
		const today = this.now()
		const todayDay = dayKey(today)
		const cutoff = new Date(today.getTime() - this.windowDays * 86_400_000)
		const cutoffDay = dayKey(cutoff)
		const cutoffYear = cutoffDay.slice(0, 4)
		const todayYear = todayDay.slice(0, 4)
		try {
			const root = await adapter.list(MEMORY_ROOT)
			const entries: WorkspaceContextDelta[] = []
			for (const yearDir of [...root.folders].sort()) {
				const year = yearDir.split('/').at(-1) ?? ''
				if (!/^\d{4}$/.test(year) || year < cutoffYear || year > todayYear) {
					continue
				}
				let files: string[]
				try {
					files = (await adapter.list(yearDir)).files
				} catch {
					continue
				}
				for (const file of [...files].sort()) {
					const date = (file.split('/').at(-1) ?? '').replace(/\.md$/, '')
					if (!DATE_PATTERN.test(date)) continue
					if (!isDateWithinWindow(date, cutoffDay, todayDay)) continue
					let index: string | undefined
					try {
						const frontmatter = parseYamlFrontmatter(await adapter.read(file))
						const raw = frontmatter?.index
						if (typeof raw === 'string' && raw.trim()) {
							index = raw.trim()
						}
					} catch {
						index = undefined
					}
					const content: MemoryIndexEntryContent = {
						path: normalizePath(file),
						...(index === undefined ? {} : { index }),
					}
					entries.push({
						key: `memory:${date}`,
						content,
						hash: hashObject(content),
					})
				}
			}
			this.deltas = entries
		} catch {
			this.deltas = []
		}
	}

	getDeltas(): WorkspaceContextDelta[] {
		return this.deltas.map((delta) => ({ ...delta }))
	}
}
