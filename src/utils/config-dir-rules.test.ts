import { describe, expect, it } from 'vitest'
import {
	computeEffectiveFilterRules,
	getConfigDirPruningRule,
	getConfigDirSystemFilterRules,
	getConfigDirSystemTraversalRules,
	shouldUseRemoteTraversalCache,
} from './config-dir-rules'
import {
	compileFilterRules,
	GlobFilterRule,
	isPathIncluded,
} from './glob-match'
import { DEFAULT_SETTINGS } from '~/settings'

function createPluginMock(
	mode: 'none' | 'bookmarks' | 'all',
	filterRules: { rules: GlobFilterRule[] } = { rules: [] },
	configDir = '.obsidian',
) {
	return {
		app: {
			vault: {
				configDir,
			},
		},
		settings: {
			configDirSyncMode: mode,
			filterRules,
		},
	} as any
}

const include = (expr: string): GlobFilterRule => ({
	expr,
	options: { caseSensitive: false },
	type: 'include',
})
const exclude = (expr: string): GlobFilterRule => ({
	expr,
	options: { caseSensitive: false },
	type: 'exclude',
})
const decider = (rules: GlobFilterRule[]) => {
	const compiled = compileFilterRules(rules)
	return (path: string, isDir = path.endsWith('/')) =>
		isPathIncluded(path, compiled, isDir)
}

describe('computeEffectiveFilterRules', () => {
	it('generates traversal and filter rules from shared system source', () => {
		const traversalRules = getConfigDirSystemTraversalRules('.obsidian')
		const filterRules = getConfigDirSystemFilterRules('.obsidian')

		expect(traversalRules).toEqual([
			{
				expr: '.obsidian/plugins/**/node_modules',
				options: { caseSensitive: true },
				type: 'exclude',
			},
			{
				expr: '.obsidian/plugins/**/.git',
				options: { caseSensitive: true },
				type: 'exclude',
			},
			{
				expr: '.obsidian/plugins/**/.pnpm-store',
				options: { caseSensitive: true },
				type: 'exclude',
			},
			{
				expr: '.obsidian/plugins/nutstore-sync/data.local.json',
				options: { caseSensitive: true },
				type: 'exclude',
			},
			{
				expr: '.obsidian/plugins/nutstore-sync/cache/ObsidianNutstoreSync.SyncCache.v1',
				options: { caseSensitive: true },
				type: 'exclude',
			},
			{
				expr: '.obsidian/workspace',
				options: { caseSensitive: true },
				type: 'exclude',
			},
			{
				expr: '.obsidian/workspace.json',
				options: { caseSensitive: true },
				type: 'exclude',
			},
		])
		expect(filterRules).toEqual(
			expect.arrayContaining([
				{
					expr: '.obsidian/plugins/**/node_modules',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/node_modules/**',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/.git',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/.git/**',
					options: { caseSensitive: true },
					type: 'exclude',
				},
			]),
		)
	})

	it('a directory-level exclude prunes children even with a child whitelist', () => {
		const rules = computeEffectiveFilterRules(
			createPluginMock('all', {
				rules: [
					exclude('.obsidian/**'),
					include('.obsidian/snippets/file-tree-colors.css'),
					include('.obsidian/plugins/manual-sorting/data.json'),
				],
			}),
		)
		const decide = decider(rules.rules)

		expect(decide('.obsidian/snippets/file-tree-colors.css')).toBe(false)
		expect(decide('.obsidian/plugins/manual-sorting/data.json')).toBe(false)
		expect(decide('.obsidian/app.json')).toBe(false)
	})

	it('re-including the parent dir enables a child whitelist', () => {
		const rules = computeEffectiveFilterRules(
			createPluginMock('all', {
				rules: [
					exclude('.obsidian/**'),
					include('.obsidian'),
					include('.obsidian/**'),
					exclude('.obsidian/plugins/foo/**'),
					include('.obsidian/snippets/file-tree-colors.css'),
				],
			}),
		)
		const decide = decider(rules.rules)

		expect(decide('.obsidian/snippets/file-tree-colors.css')).toBe(true)
		expect(decide('.obsidian/app.json')).toBe(true)
		expect(decide('.obsidian/plugins/foo/main.js')).toBe(false)
	})

	it('a later user include can bring the config dir back after **/.*', () => {
		const rules = computeEffectiveFilterRules(
			createPluginMock('all', {
				rules: [
					exclude('**/.*'),
					include('.obsidian'),
					include('.obsidian/**'),
				],
			}),
		)
		const decide = decider(rules.rules)

		expect(decide('.obsidian')).toBe(true)
		expect(decide('.obsidian/app.json')).toBe(true)
		expect(decide('.obsidian/plugins/sample/main.js')).toBe(true)
		expect(decide('.trash')).toBe(false)
	})

	it('mode none excludes the whole config dir', () => {
		const rules = computeEffectiveFilterRules(
			createPluginMock('none', {
				rules: [
					exclude('**/.*'),
					include('.obsidian'),
					include('.obsidian/**'),
				],
			}),
		)
		const decide = decider(rules.rules)

		expect(decide('.obsidian/app.json')).toBe(false)
		expect(decide('.obsidian')).toBe(false)
		expect(decide('note.md')).toBe(true)
	})

	it('bookmarks mode syncs only the bookmark file', () => {
		const rules = computeEffectiveFilterRules(createPluginMock('bookmarks'))
		const decide = decider(rules.rules)

		expect(decide('.obsidian/bookmarks.json')).toBe(true)
		expect(decide('.obsidian/app.json')).toBe(false)
		expect(decide('.obsidian/plugins/sample/main.js')).toBe(false)
		expect(decide('note.md')).toBe(true)
	})

	it.each([
		{ label: 'English', configDir: '.obsidian', parentDir: 'notes' },
		{ label: '中文', configDir: '.配置', parentDir: '笔记' },
	])(
		'$label: bookmarks mode does not re-include a nested config directory',
		({ configDir, parentDir }) => {
			const rules = computeEffectiveFilterRules(
				createPluginMock('bookmarks', { rules: [exclude('**/.*')] }, configDir),
			)
			const decide = decider(rules.rules)

			expect(decide(`${configDir}/bookmarks.json`)).toBe(true)
			expect(decide(`${parentDir}/${configDir}/example.json`)).toBe(false)
		},
	)

	it('all mode leaves user rules in full control of the config dir', () => {
		const plugin = createPluginMock('all', {
			rules: [exclude('**/.*'), include('.obsidian'), include('.obsidian/**')],
		})
		const rules = computeEffectiveFilterRules(plugin)
		expect(rules.configDirSyncMode).toBe('all')
		expect(rules.rules.length).toBeGreaterThanOrEqual(3)
	})

	it('system rules sit at the end so they always win', () => {
		const rules = computeEffectiveFilterRules(
			createPluginMock('all', {
				rules: [include('.obsidian'), include('.obsidian/**')],
			}),
		)
		const decide = decider(rules.rules)
		const nodeModulesPath = '.obsidian/plugins/foo/node_modules/pkg/index.js'

		expect(decide('.obsidian/plugins/foo/main.js')).toBe(true)
		expect(decide(nodeModulesPath)).toBe(false)
	})

	it('adds plugin dependency exclusions in all mode', () => {
		const rules = computeEffectiveFilterRules(createPluginMock('all'))
		expect(rules.rules).toEqual(
			expect.arrayContaining([
				{
					expr: '.obsidian/plugins/**/node_modules',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/.git',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/.git/**',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/.pnpm-store',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/.pnpm-store/**',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/**/node_modules/**',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/nutstore-sync/cache/ObsidianNutstoreSync.SyncCache.v1',
					options: { caseSensitive: true },
					type: 'exclude',
				},
				{
					expr: '.obsidian/plugins/nutstore-sync/cache/ObsidianNutstoreSync.SyncCache.v1/**',
					options: { caseSensitive: true },
					type: 'exclude',
				},
			]),
		)
	})

	it.each(['none', 'bookmarks', 'all'] as const)(
		'excludes the automatic remote sync cache file in %s mode',
		(mode) => {
			const rules = computeEffectiveFilterRules(createPluginMock(mode))
			const decide = decider(rules.rules)
			expect(
				decide(
					'.obsidian/plugins/nutstore-sync/cache/ObsidianNutstoreSync.SyncCache.v1',
				),
			).toBe(false)
		},
	)
})

describe('shouldUseRemoteTraversalCache', () => {
	it.each([
		{ label: 'English', configDir: '.obsidian', mode: 'none' as const },
		{ label: '中文', configDir: '.配置', mode: 'bookmarks' as const },
	])(
		'$label: disables the remote traversal cache outside all config synchronization',
		({ configDir, mode }) => {
			expect(
				shouldUseRemoteTraversalCache(configDir, mode, { rules: [] }),
			).toBe(false)
		},
	)

	it('disables the remote traversal cache for a user config directory exclusion', () => {
		expect(
			shouldUseRemoteTraversalCache('.obsidian', 'all', {
				rules: [exclude('.obsidian/**')],
			}),
		).toBe(false)
	})

	it('allows the remote traversal cache when all config synchronization is enabled', () => {
		expect(
			shouldUseRemoteTraversalCache('.obsidian', 'all', { rules: [] }),
		).toBe(true)
	})
})

describe('getConfigDirPruningRule', () => {
	it('returns undefined when nothing prunes the config dir node', () => {
		expect(getConfigDirPruningRule('.obsidian', [])).toBeUndefined()
		expect(
			getConfigDirPruningRule('.obsidian', [exclude('.obsidian/**')]),
		).toBeUndefined()
	})

	it('returns the rule that prunes the config dir node', () => {
		const catchall = exclude(`**/.*`)
		expect(getConfigDirPruningRule('.obsidian', [catchall])?.expr).toBe(`**/.*`)
		expect(
			getConfigDirPruningRule('.obsidian', [exclude('.obsidian/')])?.expr,
		).toBe('.obsidian/')
		expect(
			getConfigDirPruningRule('.obsidian', [exclude('.obsidian')])?.expr,
		).toBe('.obsidian')
	})

	it('respects last-match-wins for the config dir node', () => {
		const rules = [exclude('.obsidian'), include('.obsidian')]
		expect(getConfigDirPruningRule('.obsidian', rules)).toBeUndefined()

		const rules2 = [include('.obsidian'), exclude('.obsidian')]
		expect(getConfigDirPruningRule('.obsidian', rules2)?.expr).toBe('.obsidian')
	})

	it('ignores disabled rules when deciding the pruning rule', () => {
		const disabled = { ...exclude('**/.*'), disabled: true }
		expect(getConfigDirPruningRule('.obsidian', [disabled])).toBeUndefined()

		const activeCatchall = exclude('**/.*')
		expect(
			getConfigDirPruningRule('.obsidian', [disabled, activeCatchall])?.expr,
		).toBe('**/.*')
	})
})

describe('getConfigDirPruningRule edge-case patterns', () => {
	it.each([
		{ label: 'globstar catch-all', expr: '**/*' },
		{ label: 'bare star', expr: '*' },
		{ label: 'globstar plus config dir name', expr: '**/.obsidian' },
		{ label: 'root-anchored config dir', expr: '/.obsidian' },
		{ label: 'root-anchored dir-only', expr: '/.obsidian/' },
		{ label: 'segment wildcard matching the leading dot', expr: '*bsidian' },
		{ label: 'bracket class matching the leading dot', expr: '[.]obsidian' },
		{ label: 'hidden catch-all', expr: '**/.*' },
		{ label: 'dir-only config dir', expr: '.obsidian/' },
		{ label: 'plain config dir', expr: '.obsidian' },
	])('$label: prunes the config dir node', ({ expr }) => {
		const rule = exclude(expr)
		expect(getConfigDirPruningRule('.obsidian', [rule])?.expr).toBe(expr)
	})

	it.each([
		{ label: 'contents-only pattern', expr: '.obsidian/**' },
		{ label: 'deeper path pattern', expr: '.obsidian/plugins/**' },
		{ label: 'plugins-relative pattern', expr: 'plugins/**' },
		{ label: 'segment without the leading dot', expr: 'obsidian' },
		{ label: 'mismatching suffix', expr: '.obsidianx' },
	])('$label: does not prune the config dir node', ({ expr }) => {
		expect(
			getConfigDirPruningRule('.obsidian', [exclude(expr)]),
		).toBeUndefined()
	})

	it('respects per-rule case sensitivity', () => {
		expect(
			getConfigDirPruningRule('.obsidian', [
				{
					expr: '.OBSIDIAN',
					options: { caseSensitive: false },
					type: 'exclude',
				},
			])?.expr,
		).toBe('.OBSIDIAN')
		expect(
			getConfigDirPruningRule('.obsidian', [
				{
					expr: '.OBSIDIAN',
					options: { caseSensitive: true },
					type: 'exclude',
				},
			]),
		).toBeUndefined()
	})

	it('works for a non-ASCII config dir name', () => {
		expect(getConfigDirPruningRule('.配置', [exclude('**/.*')])?.expr).toBe(
			'**/.*',
		)
	})

	it('skips void patterns while scanning', () => {
		const voidRule = {
			expr: '   ',
			options: { caseSensitive: false },
			type: 'exclude' as const,
		}
		expect(getConfigDirPruningRule('.obsidian', [voidRule])).toBeUndefined()
	})

	it('agrees with the sync filter decision for the config dir node', () => {
		const scenarios: GlobFilterRule[][] = [
			[],
			[exclude('**/.*')],
			[exclude('**/*')],
			[exclude('*')],
			[exclude('.obsidian/**')],
			[exclude('*bsidian')],
			[exclude('.OBSIDIAN')],
			[
				{
					expr: '.OBSIDIAN',
					options: { caseSensitive: true },
					type: 'exclude',
				},
			],
			[exclude('**/.obsidian')],
			[exclude('/.obsidian')],
			[exclude('/.obsidian/')],
			[exclude('[.]obsidian')],
			[exclude('obsidian')],
			[exclude('.obsidianx')],
			[exclude('plugins/**')],
			[exclude('**/.*'), exclude('**/.DS_Store')],
			[exclude('**/.*'), include('.obsidian'), include('.obsidian/**')],
			[exclude('.obsidian'), include('.obsidian'), exclude('.obsidian')],
			[include('.obsidian')],
			[exclude('.obsidian/')],
			[{ ...exclude('**/.*'), disabled: true }],
			[exclude('**/.*'), { ...exclude('**/.env'), disabled: true }],
			[exclude('**/.env'), { ...exclude('**/.*'), disabled: true }],
		]
		for (const rules of scenarios) {
			const warned = getConfigDirPruningRule('.obsidian', rules) !== undefined
			const synced = decider(rules)('.obsidian', true)
			expect(warned).toBe(!synced)
		}
	})
})

describe('default filter rules with all mode', () => {
	it('defaults no longer contain a catch-all hidden-path rule', () => {
		expect(
			DEFAULT_SETTINGS.filterRules.rules.some((rule) => rule.expr === `**/.*`),
		).toBe(false)
		expect(
			DEFAULT_SETTINGS.filterRules.rules.some(
				(rule) => rule.expr === '**/.env',
			),
		).toBe(true)
		expect(
			DEFAULT_SETTINGS.filterRules.rules.some(
				(rule) => rule.expr === '**/.vscode',
			),
		).toBe(true)
	})

	it.each([
		{ label: 'English', configDir: '.obsidian', note: 'note.md' },
		{ label: '中文', configDir: '.配置', note: '笔记.md' },
	])(
		'$label: all mode with defaults syncs the config dir while common hidden paths stay excluded',
		({ configDir, note }) => {
			const rules = computeEffectiveFilterRules(
				createPluginMock(
					'all',
					{ rules: DEFAULT_SETTINGS.filterRules.rules },
					configDir,
				),
			)
			const decide = decider(rules.rules)

			expect(decide(`${configDir}/app.json`)).toBe(true)
			expect(decide(`${configDir}/plugins/sample/main.js`)).toBe(true)
			expect(decide(`${configDir}/.DS_Store`)).toBe(false)
			expect(decide(`${configDir}/plugins/foo/node_modules/pkg/index.js`)).toBe(
				false,
			)
			expect(decide('.env')).toBe(false)
			expect(decide('.vscode/settings.json')).toBe(false)
			expect(decide(note)).toBe(true)
		},
	)
})
