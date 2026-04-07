import { describe, expect, it } from 'vitest'
import { createAITools } from './tools'
import { filterVaultEntries, type SearchPathEntry } from './search-path-filter'

function makeEntries(
	paths: Array<{ path: string; type: SearchPathEntry['type'] }>,
): SearchPathEntry[] {
	return paths
}

describe('filterVaultEntries', () => {
	it('treats include patterns as strict filters', () => {
		const entries = makeEntries([
			{ path: '2026-03-30.md', type: 'file' },
			{ path: 'NS_Memo/工作任务.md', type: 'file' },
			{ path: 'NS_Memo/人员列表.md', type: 'file' },
			{ path: 'Excel表格.xlsx', type: 'file' },
		])

		const results = filterVaultEntries(entries, {
			basePath: '',
			include: ['*任务*', '*人员*'],
			exclude: [],
			type: 'file',
			defaultMarkdownOnly: false,
		})

		expect(results.map((entry) => entry.path)).toEqual([
			'NS_Memo/工作任务.md',
			'NS_Memo/人员列表.md',
		])
	})

	it('still excludes files under excluded parent folders', () => {
		const entries = makeEntries([
			{ path: 'NS_Memo/private/任务.md', type: 'file' },
			{ path: 'NS_Memo/public/任务.md', type: 'file' },
		])

		const results = filterVaultEntries(entries, {
			basePath: '',
			include: ['*任务*'],
			exclude: ['NS_Memo/private/'],
			type: 'file',
			defaultMarkdownOnly: false,
		})

		expect(results.map((entry) => entry.path)).toEqual(['NS_Memo/public/任务.md'])
	})

	it('matches folder paths against include patterns when searching folders', () => {
		const entries = makeEntries([
			{ path: '项目', type: 'folder' },
			{ path: '工作台', type: 'folder' },
			{ path: '归档', type: 'folder' },
		])

		const results = filterVaultEntries(entries, {
			basePath: '',
			include: ['*工作*'],
			exclude: [],
			type: 'folder',
			defaultMarkdownOnly: false,
		})

		expect(results.map((entry) => entry.path)).toEqual(['工作台'])
	})

	it('uses zod schemas for tool input validation', () => {
		const tools = createAITools({} as never)
		const treeTool = tools.find((tool) => tool.name === 'tree')

		expect(() =>
			treeTool?.inputSchema.parse({
				path: '/',
				depth: '2',
			}),
		).toThrow()

		expect(
			treeTool?.inputSchema.parse({
				path: '/',
				depth: 2,
			}),
		).toEqual({
			path: '/',
			depth: 2,
		})
	})

	it('registers the current_time tool', () => {
		const tools = createAITools({} as never)

		expect(tools.some((tool) => tool.name === 'current_time')).toBe(true)
	})
})
