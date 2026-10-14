// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ModuleScope } from '~/modules/lifecycle'
import type NutstorePlugin from '~/index'
import type { SavedApp } from '~/ai/apps/domain'
import type { AppStore } from '~/ai/apps/store'
import AppRibbonManager from './AppRibbonManager'

const icons = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }))
vi.mock('obsidian', () => ({ addIcon: icons.add, removeIcon: icons.remove }))
vi.mock('~/utils/logger', () => ({ default: { error: vi.fn() } }))
function fixture() {
	const saved: SavedApp = {
		record: {
			schemaVersion: 1,
			id: 'app-neutral',
			createdAt: 1,
			updatedAt: 1,
			currentRevisionId: 'revision-neutral',
			revisionIds: ['revision-neutral'],
			kv: {},
			pinned: true,
		},
		revision: {
			schemaVersion: 1,
			id: 'revision-neutral',
			parentRevisionId: null,
			createdAt: 1,
			evidence: [],
			code: {
				title: '中性工具 Neutral tool 🌿',
				iconSvg:
					'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>',
				html: '',
				css: '',
				javascript: '',
				dataVersion: 1,
				assets: [],
				sourceRefs: [],
			},
		},
	}
	// eslint-disable-next-line obsidianmd/prefer-create-el -- Unit tests do not load Obsidian's DOM extensions.
	const host = document.createElement('div')
	document.body.append(host)
	const commands = new Map<
		string,
		{ checkCallback(checking: boolean): boolean }
	>()
	const openApp = vi.fn(async () => {})
	const plugin = {
		manifest: { id: 'neutral-plugin' },
		register: () => {},
		app: { workspace: { containerEl: host } },
		ai: { openApp },
		addRibbonIcon: vi.fn((_icon: string, label: string, run: () => void) => {
			// eslint-disable-next-line obsidianmd/prefer-create-el -- Mock the host ribbon factory with the standard DOM API.
			const el = document.createElement('button')
			el.setAttribute('aria-label', label)
			el.addEventListener('click', run)
			host.append(el)
			return el
		}),
		addCommand: vi.fn(
			(command: { id: string; checkCallback(checking: boolean): boolean }) => {
				commands.set(command.id, command)
			},
		),
		removeCommand: vi.fn((id: string) => commands.delete(id)),
	} as unknown as NutstorePlugin
	const listeners = new Set<() => void>()
	const items = [{ id: saved.record.id, app: saved }]
	const store = {
		list: async () => items,
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	} as unknown as AppStore
	const scope = new ModuleScope()
	const manager = new AppRibbonManager(plugin, scope, store)
	return {
		saved,
		host,
		commands,
		openApp,
		plugin,
		store,
		scope,
		manager,
		items,
	}
}
describe('independent App ribbon integration', () => {
	it('registers the App SVG, opens by stable ID and keeps refreshes idempotent', async () => {
		const f = fixture()
		await f.manager.refresh()
		await f.manager.refresh()
		expect(f.host.querySelectorAll('[data-nutstore-app-id]')).toHaveLength(1)
		expect(f.plugin.addRibbonIcon).toHaveBeenCalledWith(
			'nutstore-app-app-neutral',
			'中性工具 Neutral tool 🌿',
			expect.any(Function),
		)
		expect(icons.add).toHaveBeenCalledWith(
			'nutstore-app-app-neutral',
			expect.stringContaining('circle'),
		)
		;(f.host.querySelector('button') as HTMLButtonElement).click()
		await Promise.resolve()
		expect(f.openApp).toHaveBeenCalledWith('app-neutral')
		expect(f.commands.get('open-app-app-neutral')!.checkCallback(true)).toBe(
			true,
		)
		f.scope.close()
		f.host.remove()
	})
	it('restores persisted pins after activation and removes entries on unpin/delete/disable', async () => {
		const f = fixture()
		await f.manager.refresh()
		f.scope.close()
		expect(f.host.querySelectorAll('[data-nutstore-app-id]')).toHaveLength(0)
		expect(f.commands.size).toBe(0)
		const next = new ModuleScope()
		const manager = new AppRibbonManager(f.plugin, next, f.store)
		await manager.refresh()
		expect(f.host.querySelectorAll('[data-nutstore-app-id]')).toHaveLength(1)
		f.saved.record.pinned = false
		await manager.refresh()
		expect(f.host.querySelectorAll('[data-nutstore-app-id]')).toHaveLength(0)
		expect(f.commands.size).toBe(1)
		f.items.length = 0
		await manager.refresh()
		expect(f.commands.size).toBe(0)
		expect(icons.remove).toHaveBeenCalledWith('nutstore-app-app-neutral')
		next.close()
		f.host.remove()
	})
})
