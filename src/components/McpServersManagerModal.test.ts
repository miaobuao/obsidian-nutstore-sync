import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpServerDraft } from './McpServerEditorModal'
import McpServersManagerModal from './McpServersManagerModal'
import type NutstorePlugin from '..'
import logger from '~/utils/logger'

describe('McpServersManagerModal saving', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns false and forwards a bilingual draft when saving fails', async () => {
		const loggerError = vi
			.spyOn(logger, 'error')
			.mockImplementation(() => undefined)
		const saveError = new Error('Example save failure / 示例保存失败')
		const saveServers = vi.fn(async () => {
			throw saveError
		})
		const plugin = {
			app: {},
			mcpService: {
				getServers: () => ({}),
				saveServers,
			},
		} as unknown as NutstorePlugin
		const modal = new McpServersManagerModal(plugin, vi.fn())
		const saveDraft = (
			modal as unknown as {
				saveDraft: (draft: McpServerDraft) => Promise<boolean>
			}
		).saveDraft.bind(modal)

		const draft = {
			name: 'neutral-server',
			config: {
				type: 'http' as const,
				url: 'https://example.com/mcp',
				headers: { 'X-Example': '示例' },
			},
		}

		await expect(saveDraft(draft)).resolves.toBe(false)
		expect(saveServers).toHaveBeenCalledTimes(1)
		expect(saveServers).toHaveBeenCalledWith({
			'neutral-server': draft.config,
		})
		expect(loggerError).toHaveBeenCalledWith(saveError)
	})
})
