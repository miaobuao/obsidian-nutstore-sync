import { describe, expect, it } from 'vitest'
import { traverseLocalVault } from './traverse-local-vault'

type Listed = { files: string[]; folders: string[] }

function fakeVault(listing: Record<string, Listed | Error>) {
	return {
		configDir: '.obsidian',
		adapter: {
			list: async (path: string) => {
				const entry = listing[path]
				if (entry instanceof Error) {
					throw entry
				}
				if (entry) {
					return entry
				}
				return { files: [], folders: [] }
			},
			stat: async () => ({ type: 'file', mtime: 1700000000000, size: 10 }),
		},
		getAbstractFileByPath: () => null,
	} as never
}

describe('traverseLocalVault fail-closed scanning', () => {
	it('rejects when listing a subfolder fails instead of silently pruning it', async () => {
		const vault = fakeVault({
			// Root lists fine and contains a subfolder...
			'': { files: ['a.md'], folders: ['notes', '文档'] },
			notes: { files: ['notes/a.md'], folders: [] },
			// ...but this subfolder's listing fails (lock / IO error).
			文档: new Error('EBUSY: another process holds the folder'),
		})

		await expect(traverseLocalVault(vault, '/')).rejects.toThrow(
			/Local scan failed/,
		)
	})

	it('rejects when listing the root folder fails', async () => {
		const vault = fakeVault({
			'': new Error('EACCES: permission denied'),
		})

		await expect(traverseLocalVault(vault, '/')).rejects.toThrow(
			/Local scan failed/,
		)
	})

	it('returns stats for a healthy scan of English and Chinese paths', async () => {
		const vault = fakeVault({
			'': { files: ['a.md'], folders: ['notes', '文档'] },
			notes: { files: ['notes/a.md'], folders: [] },
			文档: { files: ['文档/示例.md'], folders: [] },
		})

		const stats = await traverseLocalVault(vault, '/')

		const paths = stats.map((s) => s.path).sort()
		expect(paths).toEqual(
			['a.md', 'notes', 'notes/a.md', '文档', '文档/示例.md'].sort(),
		)
	})
})
