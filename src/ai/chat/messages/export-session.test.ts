import { TFile, type Vault } from 'obsidian'
import { describe, expect, it } from 'vitest'
import type { ChatSession } from '~/ai/chat/domain'
import { createEmptyMasterAgent } from '~/ai/chat/messages/ui-message'
import i18n from '~/i18n'
import {
	exportSessionToMarkdownFile,
	sanitizeExportFileName,
} from './export-session'

function createExportVault() {
	const entries = new Map<string, TFile | { type: 'folder' }>()
	const contents = new Map<string, string>()
	const vault = {
		configDir: '.obsidian',
		adapter: {
			async exists(path: string) {
				return entries.has(path)
			},
		},
		getAbstractFileByPath(path: string) {
			return entries.get(path)
		},
		async createFolder(path: string) {
			entries.set(path, { type: 'folder' })
		},
		async create(path: string, content: string) {
			const file = new TFile()
			entries.set(path, file)
			contents.set(path, content)
			return file
		},
	} as unknown as Vault
	return { vault, contents }
}

describe('sanitizeExportFileName', () => {
	it('normalizes an English title and removes unsupported characters', () => {
		expect(sanitizeExportFileName('  Project / notes: overview?  ')).toBe(
			'Project - notes- overview-',
		)
	})

	it('limits a long English title by UTF-8 byte length', () => {
		const title = sanitizeExportFileName('a'.repeat(300))

		expect(new TextEncoder().encode(title).byteLength).toBe(200)
		expect(title).toBe('a'.repeat(200))
	})

	it('limits a long Chinese title without splitting a character', () => {
		const title = sanitizeExportFileName('示例内容'.repeat(100))

		expect(new TextEncoder().encode(title).byteLength).toBe(198)
		expect(title).toBe('示例内容'.repeat(100).slice(0, 66))
	})

	it('uses a fallback when sanitization leaves no title', () => {
		expect(sanitizeExportFileName(' ... ')).toBe('chat-session')
	})
})

describe('exportSessionToMarkdownFile', () => {
	it('includes the recorded tool call duration in the Markdown export', async () => {
		const master = createEmptyMasterAgent(1)
		master.timeline.push({
			id: 'assistant-message',
			role: 'assistant',
			metadata: { createdAt: 1 },
			parts: [
				{
					type: 'dynamic-tool',
					toolName: 'lookup',
					toolCallId: 'call-1',
					state: 'output-available',
					input: { query: 'neutral value' },
					output: 'neutral result',
				},
			],
		})
		master.toolTimings['call-1'] = { startedAt: 1000, finishedAt: 1125 }
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'session-1',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master },
		}
		const { vault, contents } = createExportVault()

		await exportSessionToMarkdownFile({
			vault,
			manifestId: 'plugin-id',
			manifestVersion: '1.0.0',
			session,
			title: 'Neutral session',
			includeToolMessages: true,
		})

		const exportedFiles = [...contents.entries()]
		expect(exportedFiles).toHaveLength(1)
		const markdown = exportedFiles[0]?.[1]
		expect(markdown).toContain(
			`- ${i18n.t('chatbox.exportMeta.duration')}: \`125ms\``,
		)
	})
})
