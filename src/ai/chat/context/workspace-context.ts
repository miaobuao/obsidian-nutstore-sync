import type { App, WorkspaceLeaf } from 'obsidian'
import { hash as hashObject } from 'ohash'

import type { AppUIMessage, WorkspaceContextDelta } from '~/ai/chat/types'
import { getWorkspaceContextDeltas } from '~/ai/chat/messages/ui-message'
import type { SkillRepository } from '~/ai/skills/repository'
import type { MemoryIndexRepository } from '~/ai/chat/context/memory-index'

type View = WorkspaceLeaf['view'] & {
	file?: {
		path: string
	}
	containerEl?: HTMLElement
}

interface CurrentDateContext {
	date: string
	weekday: string
	timezone?: string
}

const ENGLISH_WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
] as const

export interface WorkspaceContextOptions {
	/** Clock override for deterministic date-context tests. */
	now?: () => Date
}

function formatLocalDate(date: Date) {
	return [
		String(date.getFullYear()).padStart(4, '0'),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-')
}

function getEnglishWeekday(date: Date) {
	try {
		if (
			typeof Intl !== 'undefined' &&
			typeof Intl.DateTimeFormat === 'function'
		) {
			return new Intl.DateTimeFormat('en-US', {
				weekday: 'long',
			}).format(date)
		}
	} catch {
		// Fall back for old or partial WebView Intl implementations.
	}
	return ENGLISH_WEEKDAYS[date.getDay()] ?? 'Sunday'
}

function getLocalTimezone() {
	try {
		if (
			typeof Intl !== 'undefined' &&
			typeof Intl.DateTimeFormat === 'function'
		) {
			const timezone = Intl.DateTimeFormat().resolvedOptions?.().timeZone
			return typeof timezone === 'string' && timezone ? timezone : undefined
		}
	} catch {
		// Timezone metadata is optional and must not block context injection.
	}
	return undefined
}

function captureCurrentDateContext(date: Date): CurrentDateContext {
	const timezone = getLocalTimezone()
	return {
		date: formatLocalDate(date),
		weekday: getEnglishWeekday(date),
		...(timezone ? { timezone } : {}),
	}
}

function getConnectedFilePath(leaf: WorkspaceLeaf): string | null {
	const view = leaf.view as unknown as View
	if (
		!view?.file?.path ||
		!(
			view.getViewType() in
			['markdown', 'canvas', 'pdf', 'image', 'video', 'audio', 'bases']
		) ||
		!view.containerEl?.isConnected
	) {
		return null
	}
	return view.file.path
}

export function captureWorkspaceContexts(
	app: App,
	skillRepository?: SkillRepository,
	memoryIndexRepository?: MemoryIndexRepository,
	options: WorkspaceContextOptions = {},
): WorkspaceContextDelta[] {
	const activeFile = app.workspace.getActiveFile()?.path ?? null
	const currentDate = captureCurrentDateContext(options.now?.() ?? new Date())

	const openFilePaths = new Set<string>()
	app.workspace.iterateAllLeaves((leaf) => {
		const filePath = getConnectedFilePath(leaf)
		if (filePath) {
			openFilePaths.add(filePath)
		}
	})
	const openFiles = Array.from(openFilePaths).sort()
	const contexts: WorkspaceContextDelta[] = [
		{
			key: 'currentDate',
			content: currentDate,
			hash: hashObject(currentDate),
		},
		{ key: 'activeFile', content: activeFile, hash: hashObject(activeFile) },
		{ key: 'openFiles', content: openFiles, hash: hashObject(openFiles) },
	]
	if (skillRepository) {
		const skills = skillRepository.getCatalog()
		contexts.push({ key: 'skills', content: skills, hash: hashObject(skills) })
	}
	if (memoryIndexRepository) {
		contexts.push(...memoryIndexRepository.getDeltas())
	}
	return contexts
}

export function computeChangedContexts(
	prevMessages: AppUIMessage[],
	current: WorkspaceContextDelta[],
): WorkspaceContextDelta[] {
	const lastHashByKey = new Map<string, string>()
	for (let i = prevMessages.length - 1; i >= 0; i--) {
		const ctx = getWorkspaceContextDeltas(prevMessages[i])
		if (!ctx.length) continue
		for (const entry of ctx) {
			if (!lastHashByKey.has(entry.key)) {
				lastHashByKey.set(entry.key, entry.hash)
			}
		}
		if (lastHashByKey.size === current.length) break
	}
	return current.filter((entry) => lastHashByKey.get(entry.key) !== entry.hash)
}
