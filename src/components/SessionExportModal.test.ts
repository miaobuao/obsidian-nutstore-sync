import { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import SessionExportModal from './SessionExportModal'

describe('SessionExportModal', () => {
	it('defaults to including tool call messages', () => {
		const modal = new SessionExportModal(new App(), () => undefined)

		expect(
			(modal as unknown as { includeToolMessages: boolean })
				.includeToolMessages,
		).toBe(true)
	})
})
