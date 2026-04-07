import { App, normalizePath, TFile, TFolder } from 'obsidian'
import { dirname } from 'path-browserify'
import { z } from 'zod'
import i18n from '~/i18n'
import GlobMatch, { needIncludeFromGlobRules } from '~/utils/glob-match'
import { AIToolDefinition } from './types'
import { filterVaultEntries } from './search-path-filter'
import { flattenTreeNodes, type TreeNode } from './tree'

const DEFAULT_RESULT_LIMIT = 20
const MAX_RESULT_LIMIT = 200
const DEFAULT_FILE_LIMIT = 200
const MAX_FILE_LIMIT = 1000

interface SearchMatch {
	start: number
	end: number
	patternIndex: number
}

interface SearchLineResult {
	path: string
	lineNumber: number
	lineText: string
	matches?: SearchMatch[]
}

interface VaultEntry {
	path: string
	type: 'file' | 'folder'
	file?: TFile
}

interface ReplaceResult {
	content: string
	matchCount: number
}

const trimmedString = (field: string) =>
	z
		.string()
		.trim()
		.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field }))

const textValue = (field: string) =>
	z.string({
		error: () => i18n.t('chatbox.errors.toolFieldRequired', { field }),
	})

const positiveInteger = (field: string, fallback: number) =>
	z
		.number()
		.int(i18n.t('chatbox.errors.invalidPositiveInteger', { field }))
		.min(1, i18n.t('chatbox.errors.invalidPositiveInteger', { field }))
		.default(fallback)

function clampLimit(value: unknown, fallback: number, max = MAX_RESULT_LIMIT) {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return fallback
	}
	return Math.max(1, Math.min(max, Math.floor(value)))
}

function normalizeVaultPath(pathValue: string) {
	return pathValue === '/' ? '' : normalizePath(pathValue)
}

interface SpawnToolHandler {
	(params: {
		task: string
		label?: string
		parentTaskId?: string
		depth: number
		maxDepth: number
		sessionId: string
	}): Promise<Record<string, unknown>>
}

interface CreateAIToolsOptions {
	spawnTask?: SpawnToolHandler
	allowSpawn?: boolean
}

function normalizeQuery(value: unknown) {
	if (typeof value !== 'string') {
		return ''
	}
	return value.trim().toLowerCase()
}

function getParentFolderPath(filePath: string) {
	const parent = dirname(filePath)
	return parent === '.' ? '' : normalizeVaultPath(parent)
}

function createGlobRules(patterns: string[]) {
	return patterns.map(
		(pattern) =>
			new GlobMatch(pattern, {
				caseSensitive: false,
			}),
	)
}

function getIgnoredFolderRules(app: App) {
	return createGlobRules([`${app.vault.configDir}/plugins/*/node_modules`])
}

function shouldIncludeByGlob(
	entryPath: string,
	inclusionRules: GlobMatch[],
	exclusionRules: GlobMatch[],
) {
	return needIncludeFromGlobRules(entryPath, inclusionRules, exclusionRules)
}

function collectVaultEntries(
	folder: TFolder,
	ignoredFolderRules: GlobMatch[],
	results: VaultEntry[],
) {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			if (!shouldIncludeByGlob(`${child.path}/`, [], ignoredFolderRules)) {
				continue
			}
			results.push({
				path: child.path,
				type: 'folder',
			})
			collectVaultEntries(child, ignoredFolderRules, results)
			continue
		}
		if (!(child instanceof TFile)) {
			continue
		}

		results.push({
			path: child.path,
			type: 'file',
			file: child,
		})
	}
}

function getVaultEntries(app: App, rawPath: string) {
	const path = normalizeVaultPath(rawPath)
	const target = path ? app.vault.getAbstractFileByPath(path) : app.vault.getRoot()

	if (!target) {
		throw new Error(i18n.t('chatbox.errors.folderNotFound', { path: rawPath }))
	}
	if (!(target instanceof TFolder)) {
		throw new Error(i18n.t('chatbox.errors.notFolder', { path: rawPath }))
	}
	const folder = target as TFolder

	const entries: VaultEntry[] = []
	collectVaultEntries(folder, getIgnoredFolderRules(app), entries)
	return {
		basePath: path,
		target: folder,
		entries,
	}
}

function collectTreeItems(folder: TFolder, depth: number) {
	const toTreeNode = (child: TFolder | TFile): TreeNode => ({
		name: child.name,
		path: child.path,
		type: child instanceof TFolder ? 'folder' : 'file',
		...(child instanceof TFolder
			? { children: child.children.map((nested) => toTreeNode(nested as TFolder | TFile)) }
			: {}),
	})

	return flattenTreeNodes(
		folder.children.map((child) => toTreeNode(child as TFolder | TFile)),
		depth,
	)
}

async function ensureParentFolder(app: App, filePath: string) {
	const parentPath = getParentFolderPath(filePath)
	if (!parentPath) {
		return
	}

	const existing = app.vault.getAbstractFileByPath(parentPath)
	if (existing) {
		if (!(existing instanceof TFolder)) {
			throw new Error(
				i18n.t('chatbox.errors.parentPathNotFolder', { path: parentPath }),
			)
		}
		return
	}

	await ensureParentFolder(app, parentPath)
	await app.vault.createFolder(parentPath)
}

function createLiteralRegExp(pattern: string, caseSensitive: boolean) {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(escaped, caseSensitive ? 'g' : 'gi')
}

function createSearchRegExp(
	pattern: string,
	index: number,
	regex: boolean,
	caseSensitive: boolean,
) {
	if (!regex) {
		return createLiteralRegExp(pattern, caseSensitive)
	}

	try {
		return new RegExp(pattern, caseSensitive ? 'g' : 'gi')
	} catch {
		throw new Error(
			i18n.t('chatbox.errors.invalidRegex', {
				index: index + 1,
				pattern,
			}),
		)
	}
}

function findMatchesInLine(lineText: string, regex: RegExp, patternIndex: number) {
	const matches: SearchMatch[] = []
	regex.lastIndex = 0

	while (true) {
		const match = regex.exec(lineText)
		if (!match) {
			break
		}

		const text = match[0] ?? ''
		const start = match.index
		const end = start + text.length
		matches.push({
			start,
			end,
			patternIndex,
		})

		if (text.length === 0) {
			regex.lastIndex += 1
		}
	}

	return matches
}

function collectLineMatches(
	lineText: string,
	patterns: string[],
	mode: 'or' | 'and',
	regex: boolean,
	caseSensitive: boolean,
) {
	const perPatternMatches = patterns.map((pattern, index) =>
		findMatchesInLine(
			lineText,
			createSearchRegExp(pattern, index, regex, caseSensitive),
			index,
		),
	)
	const isMatched =
		mode === 'and'
			? perPatternMatches.every((matches) => matches.length > 0)
			: perPatternMatches.some((matches) => matches.length > 0)

	if (!isMatched) {
		return null
	}

	return perPatternMatches.flat().sort((left, right) => {
		if (left.start !== right.start) {
			return left.start - right.start
		}
		if (left.end !== right.end) {
			return left.end - right.end
		}
		return left.patternIndex - right.patternIndex
	})
}

function replaceUniqueOccurrence(content: string, oldText: string, newText: string) {
	let matchIndex = content.indexOf(oldText)
	let matchCount = 0

	while (matchIndex !== -1) {
		matchCount += 1
		if (matchCount > 1) {
			break
		}
		matchIndex = content.indexOf(oldText, matchIndex + oldText.length)
	}

	if (matchCount === 0) {
		throw new Error(i18n.t('chatbox.errors.editMatchNotFound'))
	}
	if (matchCount > 1) {
		throw new Error(i18n.t('chatbox.errors.editMatchNotUnique'))
	}

	return {
		content: content.replace(oldText, newText),
		matchCount,
	} satisfies ReplaceResult
}

export function createAITools(
	app: App,
	options: CreateAIToolsOptions = {},
): AIToolDefinition[] {
	const tools: AIToolDefinition[] = [
		{
			name: 'tree',
			description: 'Browse a vault folder tree to a specified depth.',
			inputSchema: z.object({
				path: z.string().default('/'),
				depth: positiveInteger('depth', 1),
			}),
			execute: async (params) => {
				const rawPath = params.path
				const depth = params.depth
				const path = normalizeVaultPath(rawPath)
				const target = path ? app.vault.getAbstractFileByPath(path) : app.vault.getRoot()

				if (!target) {
					throw new Error(i18n.t('chatbox.errors.folderNotFound', { path: rawPath }))
				}
				if (!(target instanceof TFolder)) {
					throw new Error(i18n.t('chatbox.errors.notFolder', { path: rawPath }))
				}

				return {
					path: rawPath,
					items: collectTreeItems(target, depth),
				}
			},
		},
		{
			name: 'read_file',
			description: 'Read a UTF-8 text note from the Obsidian vault.',
			inputSchema: z.object({
				path: trimmedString('path'),
			}),
			execute: async (params) => {
				const path = params.path
				const target = app.vault.getAbstractFileByPath(normalizePath(path))

				if (!target) {
					throw new Error(i18n.t('chatbox.errors.fileNotFound', { path }))
				}
				if (!(target instanceof TFile)) {
					throw new Error(i18n.t('chatbox.errors.notFile', { path }))
				}

				return {
					path: target.path,
					content: await app.vault.cachedRead(target),
				}
			},
		},
		{
			name: 'write_file',
			description:
				'Write the full text content of a vault file. Creates a new file when missing. To replace an existing file, set overwrite to true.',
			inputSchema: z.object({
				path: trimmedString('path'),
				content: textValue('content'),
				overwrite: z.boolean().default(false),
			}),
			execute: async (params) => {
				const path = params.path
				const content = params.content
				const normalizedPath = normalizePath(path)
				const overwrite = params.overwrite
				const target = app.vault.getAbstractFileByPath(normalizedPath)

				if (target) {
					if (!(target instanceof TFile)) {
						throw new Error(i18n.t('chatbox.errors.notFile', { path }))
					}
					if (!overwrite) {
						throw new Error(i18n.t('chatbox.errors.fileExists', { path }))
					}
					await app.vault.modify(target, content)
					return {
						path: normalizedPath,
						created: false,
						overwritten: true,
					}
				}

				await ensureParentFolder(app, normalizedPath)
				await app.vault.create(normalizedPath, content)
				return {
					path: normalizedPath,
					created: true,
					overwritten: false,
				}
			},
		},
		{
			name: 'edit_file',
			description:
				'Edit a vault text file by replacing one exact, uniquely matched text block with new text.',
			inputSchema: z.object({
				path: trimmedString('path'),
				oldText: z
					.string()
					.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'oldText' })),
				newText: textValue('newText'),
			}),
			execute: async (params) => {
				const path = params.path
				const oldText = params.oldText
				const newText = params.newText
				const normalizedPath = normalizePath(path)
				const target = app.vault.getAbstractFileByPath(normalizedPath)

				if (!target) {
					throw new Error(i18n.t('chatbox.errors.fileNotFound', { path }))
				}
				if (!(target instanceof TFile)) {
					throw new Error(i18n.t('chatbox.errors.notFile', { path }))
				}

				const content = await app.vault.cachedRead(target)
				const replaced = replaceUniqueOccurrence(content, oldText, newText)
				await app.vault.modify(target, replaced.content)

				return {
					path: normalizedPath,
					replaced: true,
					matchCount: replaced.matchCount,
				}
			},
		},
		{
			name: 'search_vault',
			description:
				'Search file contents line by line like grep. This only searches file contents, not file names or paths. Supports multiple patterns, regex, and path glob filters. Defaults to markdown files.',
			inputSchema: z.object({
				patterns: z.array(trimmedString('patterns')).min(
					1,
					i18n.t('chatbox.errors.toolFieldRequired', { field: 'patterns' }),
				),
				mode: z.enum(['or', 'and']).default('or'),
				regex: z.boolean().default(false),
				caseSensitive: z.boolean().default(false),
				path: z.string().default('/'),
				include: z.array(z.string().trim()).default([]),
				exclude: z.array(z.string().trim()).default([]),
				extensions: z.array(z.string().trim()).default([]),
				limit: z.number().default(DEFAULT_RESULT_LIMIT),
				fileLimit: z.number().default(DEFAULT_FILE_LIMIT),
				includeMatches: z.boolean().default(true),
			}),
			execute: async (params) => {
				const patterns = params.patterns
				const rawPath = params.path
				const mode = params.mode
				const regex = params.regex
				const caseSensitive = params.caseSensitive
				const includeMatches = params.includeMatches
				const limit = clampLimit(params.limit, DEFAULT_RESULT_LIMIT)
				const fileLimit = clampLimit(
					params.fileLimit,
					DEFAULT_FILE_LIMIT,
					MAX_FILE_LIMIT,
				)
				const include = params.include.filter(Boolean)
				const exclude = params.exclude.filter(Boolean)
				const extensions = params.extensions.filter(Boolean)
				const { basePath, entries } = getVaultEntries(app, rawPath)
				const files = filterVaultEntries(entries, {
					basePath,
					include,
					exclude,
					type: 'file',
					extensions,
					defaultMarkdownOnly: true,
				})
				const results: SearchLineResult[] = []
				let scannedFiles = 0
				let truncated = false

				for (const entry of files) {
					if (scannedFiles >= fileLimit) {
						truncated = true
						break
					}
					if (!entry.file) {
						continue
					}

					scannedFiles += 1
					const content = await app.vault.cachedRead(entry.file)
					const lines = content.split(/\r?\n/)

					for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
						const lineText = lines[lineIndex]
						const matches = collectLineMatches(
							lineText,
							patterns,
							mode,
							regex,
							caseSensitive,
						)

						if (!matches) {
							continue
						}

						results.push({
							path: entry.path,
							lineNumber: lineIndex + 1,
							lineText,
							...(includeMatches ? { matches } : {}),
						})

						if (results.length >= limit) {
							truncated = true
							break
						}
					}

					if (results.length >= limit) {
						break
					}
				}

				return {
					path: rawPath,
					mode,
					regex,
					caseSensitive,
					scannedFiles,
					truncated,
					results,
				}
			},
		},
		{
			name: 'glob_vault',
			description:
				'Find vault files or folders by matching their paths. Use this for file names, note titles, path fragments, or glob include and exclude filters. Does not read file contents.',
			inputSchema: z.object({
				path: z.string().default('/'),
				include: z.array(z.string().trim()).default([]),
				exclude: z.array(z.string().trim()).default([]),
				query: z.string().default(''),
				type: z.enum(['file', 'folder', 'all']).default('file'),
				limit: z.number().default(DEFAULT_RESULT_LIMIT),
			}),
			execute: async (params) => {
				const rawPath = params.path
				const type = params.type
				const limit = clampLimit(params.limit, DEFAULT_RESULT_LIMIT)
				const include = params.include.filter(Boolean)
				const exclude = params.exclude.filter(Boolean)
				const query = normalizeQuery(params.query)
				const { basePath, entries } = getVaultEntries(app, rawPath)
				const filteredEntries = filterVaultEntries(entries, {
					basePath,
					include,
					exclude,
					type,
					defaultMarkdownOnly: false,
				})
					.filter((entry) =>
						!query ? true : entry.path.toLowerCase().includes(query),
					)
				const results = filteredEntries.slice(0, limit).map((entry) => ({
					path: entry.path,
					type: entry.type,
				}))

				return {
					path: rawPath,
					query: query || null,
					type,
					truncated: filteredEntries.length > limit,
					results,
				}
			},
		},
		{
			name: 'current_time',
			description: 'Get the current local time from the running device.',
			inputSchema: z.object({}),
			execute: async () => {
				const now = new Date()
				const timezone =
					Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

				return {
					iso: now.toISOString(),
					local: now.toLocaleString(),
					timezone,
					timestamp: now.getTime(),
				}
			},
		},
	]

	if (options.spawnTask && options.allowSpawn !== false) {
		tools.push({
			name: 'spawn',
			description:
				'Run a large independent background task and return its task result when finished.',
			inputSchema: z.object({
				task: trimmedString('task'),
				label: z.string().trim().optional(),
			}),
			execute: async (params, context) => {
				return options.spawnTask!({
					task: params.task,
					label: params.label,
					parentTaskId: context.parentTaskId,
					depth: context.depth + 1,
					maxDepth: context.maxDepth,
					sessionId: context.session.id,
				})
			},
		})
	}

	return tools
}
