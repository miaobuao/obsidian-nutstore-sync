// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type NutstorePlugin from '~/index'
import type { NutstoreLocalSettings } from '~/settings'
import { ModuleState } from '~/modules/lifecycle'
import SettingsService from './settings.service'

// Settings defaults share a module with the settings UI; stub its host classes.
vi.mock('obsidian', () => {
	class HostClass {}
	return {
		normalizePath: (path: string) => path,
		Notice: HostClass,
		Modal: HostClass,
		PluginSettingTab: HostClass,
		Setting: HostClass,
		Component: HostClass,
		ItemView: HostClass,
		MarkdownView: HostClass,
		Platform: {},
		setIcon: () => {},
		requestUrl: async () => ({}),
	}
})
vi.mock('~/i18n', () => ({ default: { t: (key: string) => key } }))

const LOCAL_PATH = '插件/nutstore-sync 🌱/data.local.json'

function fixture(data: unknown, local?: unknown) {
	const files = new Map<string, string>()
	if (local !== undefined) files.set(LOCAL_PATH, JSON.stringify(local))
	const saveData = vi.fn(async (_data: unknown) => {})
	const plugin = {
		manifest: { dir: '插件/nutstore-sync 🌱' },
		loadData: async () => structuredClone(data),
		saveData,
		applySettings: vi.fn(async () => {}),
		app: {
			vault: {
				adapter: {
					exists: async (path: string) => files.has(path),
					read: async (path: string) => files.get(path)!,
					write: async (path: string, content: string) => {
						files.set(path, content)
					},
				},
			},
		},
	} as unknown as NutstorePlugin
	return { plugin, files, saveData, service: new SettingsService(plugin) }
}

const readLocal = (files: Map<string, string>) =>
	JSON.parse(files.get(LOCAL_PATH)!) as NutstoreLocalSettings

describe('device-local module states', () => {
	it('seeds local states once from legacy synced data and drops them from synced data', async () => {
		const { plugin, files, service } = fixture({
			remoteDir: '/中性目录 🌱',
			syncModule: ModuleState.Disabled,
			aiModule: ModuleState.Enabled,
		})
		await service.onload()
		expect(plugin.localSettings.modules).toEqual({
			sync: ModuleState.Disabled,
			ai: ModuleState.Enabled,
		})
		expect(readLocal(files).modules.sync).toBe(ModuleState.Disabled)
		expect(plugin.settings).not.toHaveProperty('syncModule')
		expect(plugin.settings).not.toHaveProperty('aiModule')
		expect(plugin.settings.remoteDir).toBe('/中性目录 🌱')
	})

	it('keeps the local choice when another device syncs a different legacy value', async () => {
		const { plugin, service } = fixture(
			{ syncModule: ModuleState.Disabled, aiModule: ModuleState.Disabled },
			{ modules: { sync: ModuleState.Enabled, ai: ModuleState.Enabled } },
		)
		await service.onload()
		expect(plugin.localSettings.modules).toEqual({
			sync: ModuleState.Enabled,
			ai: ModuleState.Enabled,
		})
	})

	it('defaults to enabled for fresh or corrupt local data', async () => {
		for (const local of [undefined, { modules: { sync: '中性 🌱' } }]) {
			const { plugin, service } = fixture({}, local)
			await service.onload()
			expect(plugin.localSettings.modules).toEqual({
				sync: ModuleState.Enabled,
				ai: ModuleState.Enabled,
			})
		}
	})

	it('persists toggles locally without writing synced data', async () => {
		const { plugin, files, saveData, service } = fixture({})
		await service.onload()
		await service.setModuleState('ai', ModuleState.Disabled)
		expect(readLocal(files).modules.ai).toBe(ModuleState.Disabled)
		expect(plugin.applySettings).toHaveBeenCalled()
		expect(saveData).not.toHaveBeenCalled()
	})
})

describe('device-local workshop availability', () => {
	it('preserves the existing workshop for devices without a choice', async () => {
		const { plugin, service } = fixture({})
		await service.onload()
		expect(plugin.localSettings.ai.workshopEnabled).not.toBe(false)
	})

	it('persists and restores the choice while preserving model settings', async () => {
		const { plugin, files, saveData, service } = fixture(
			{},
			{
				ai: { presetModelsUpdatedAt: '中性记录 Neutral record 🌱' },
			},
		)
		await service.onload()
		for (const enabled of [false, true]) {
			await service.setWorkshopEnabled(enabled)
			expect(readLocal(files).ai.workshopEnabled).toBe(enabled)
			await service.loadLocalSettings()
			expect(plugin.localSettings.ai.workshopEnabled).toBe(enabled)
			expect(plugin.localSettings.ai.presetModelsUpdatedAt).toBe(
				'中性记录 Neutral record 🌱',
			)
		}
		expect(plugin.applySettings).toHaveBeenCalledTimes(2)
		expect(saveData).not.toHaveBeenCalled()
	})
})
