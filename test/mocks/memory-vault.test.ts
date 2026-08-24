import { describe, expect, it } from 'vitest'
import { createMemoryVault } from './memory-vault'

describe('createMemoryVault DataAdapter double', () => {
	it('lists only direct children, matching the Obsidian adapter contract', async () => {
		const { vault } = createMemoryVault(
			{
				'notes/today.md': 'today',
				'notes/archive/old.md': 'old',
				'root.md': 'root',
			},
			['notes', 'notes/archive'],
		)

		expect(await vault.adapter.list('')).toEqual({
			files: ['root.md'],
			folders: ['notes'],
		})
		expect(await vault.adapter.list('notes')).toEqual({
			files: ['notes/today.md'],
			folders: ['notes/archive'],
		})
	})
})
