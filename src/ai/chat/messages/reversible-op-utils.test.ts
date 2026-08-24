import { describe, expect, it } from 'vitest'
import type { ReversibleToolOp } from '~/ai/chat/types'
import {
	normalizeReversibleToolOpRecord,
	normalizeReversibleVaultPath,
} from './reversible-op-utils'
import { BASH_TMP_MOUNT_POINT } from '~/ai/tools/bash/mount-points'

type UpdateOperation = Extract<ReversibleToolOp, { operation: 'update' }>

function makeRecord(overrides: Partial<UpdateOperation> = {}): UpdateOperation {
	return {
		vaultPath: 'note.md',
		operation: 'update',
		before: { kind: 'file', contentBase64: 'YWIK' },
		after: { kind: 'file', contentBase64: 'YWNiCg==' },
		toolCallId: 'call-1',
		...overrides,
	}
}

describe('normalizeReversibleVaultPath', () => {
	it('keeps an already vault-relative path unchanged', () => {
		expect(normalizeReversibleVaultPath('notes/example.md')).toBe(
			'notes/example.md',
		)
	})

	it('strips the /vault mount prefix from a virtual vault path', () => {
		expect(normalizeReversibleVaultPath('/vault/notes/example.md')).toBe(
			'notes/example.md',
		)
	})

	it('keeps a root-mounted vault path absolute for virtual restoration', () => {
		expect(normalizeReversibleVaultPath('/notes/example.md')).toBe(
			'/notes/example.md',
		)
	})

	it('maps the /vault mount root itself to an empty path', () => {
		expect(normalizeReversibleVaultPath('/vault/')).toBe('')
	})

	it('keeps current and legacy virtual mounts absolute until restoration', () => {
		expect(
			normalizeReversibleVaultPath(`${BASH_TMP_MOUNT_POINT}/scratch.txt`),
		).toBe(`${BASH_TMP_MOUNT_POINT}/scratch.txt`)
		expect(normalizeReversibleVaultPath('/tmp/scratch.txt')).toBe(
			'/tmp/scratch.txt',
		)
		expect(normalizeReversibleVaultPath('/.agents/skills/custom')).toBe(
			'/.agents/skills/custom',
		)
		expect(
			normalizeReversibleVaultPath('/.config/nutstore-sync/settings.json'),
		).toBe('/.config/nutstore-sync/settings.json')
	})

	it('strips the /vault prefix from a Chinese-named note path', () => {
		expect(normalizeReversibleVaultPath('/vault/随笔/日常记录.md')).toBe(
			'随笔/日常记录.md',
		)
	})

	it('returns empty string for a blank path', () => {
		expect(normalizeReversibleVaultPath('   ')).toBe('')
		expect(normalizeReversibleVaultPath('')).toBe('')
	})
})

describe('normalizeReversibleToolOpRecord', () => {
	it('stores a vault note path as vault-relative', () => {
		const record = normalizeReversibleToolOpRecord(
			makeRecord({ vaultPath: '/vault/notes/example.md' }),
		)
		expect(record?.vaultPath).toBe('notes/example.md')
	})

	it('keeps a settings path as an absolute virtual path', () => {
		const record = normalizeReversibleToolOpRecord(
			makeRecord({
				vaultPath: '/.config/nutstore-sync/settings.json',
			}),
		)
		expect(record?.vaultPath).toBe('/.config/nutstore-sync/settings.json')
	})

	it('returns null for a blank vault path', () => {
		expect(
			normalizeReversibleToolOpRecord(makeRecord({ vaultPath: '  ' })),
		).toBeNull()
	})
})
