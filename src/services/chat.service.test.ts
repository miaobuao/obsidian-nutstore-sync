import { describe, expect, it } from 'vitest'
import { createMemoryVault } from 'test/mocks/memory-vault'
import {
	CHAT_ROOT_DIR,
	CHAT_SESSIONS_DIR,
} from '~/ai/chat/session/session-files'
import { DEFAULT_SETTINGS } from '~/settings'
import ChatService from './chat.service'
import type NutstorePlugin from '..'

function createPluginForStartupTest() {
	const { vault } = createMemoryVault({
		'笔记-Notes-🙂/内容-Content.md': '中性内容 / Neutral content 🙂',
	})
	const rootListPaths: string[] = []
	const chatStoragePaths: string[] = []
	const adapter = vault.adapter
	const list = adapter.list.bind(adapter)
	adapter.list = async (path) => {
		if (path === '') rootListPaths.push(path)
		if (path.startsWith(CHAT_ROOT_DIR)) chatStoragePaths.push(path)
		return list(path)
	}
	const read = adapter.read.bind(adapter)
	adapter.read = async (path) => {
		if (path.startsWith(CHAT_ROOT_DIR)) chatStoragePaths.push(path)
		return read(path)
	}
	const write = adapter.write.bind(adapter)
	adapter.write = async (path, data) => {
		if (path.startsWith(CHAT_ROOT_DIR)) chatStoragePaths.push(path)
		return write(path, data)
	}
	const plugin = {
		app: { vault },
		settings: structuredClone(DEFAULT_SETTINGS),
		mcpService: {
			refreshIfChanged: async () => undefined,
			getToolsForSession: () => ({}),
			getServerRuntimes: () => [],
		},
		nutstoreLlmGatewayService: {
			ensureProviderReady: async () => undefined,
		},
		settingsService: {
			applySettingsPatch: async () => undefined,
		},
	} as unknown as NutstorePlugin
	return { plugin, rootListPaths, chatStoragePaths }
}

describe('ChatService startup', () => {
	it('loads without scanning the Vault root before ChatBox is used', async () => {
		const { plugin, rootListPaths } = createPluginForStartupTest()
		const service = new ChatService(plugin)

		await service.onload()

		expect(rootListPaths).toEqual([])
	})

	it('does not load ChatBox sessions during plugin startup settings coordination', async () => {
		const { plugin, chatStoragePaths } = createPluginForStartupTest()
		const service = new ChatService(plugin)

		await service.onload()
		await service.handleSettingsChanged()

		expect(chatStoragePaths).toEqual([])
	})

	it('reports loading while the initial ChatBox session is restored', async () => {
		const { plugin } = createPluginForStartupTest()
		let releaseList: (() => void) | undefined
		const listBlocked = new Promise<void>((resolve) => {
			releaseList = resolve
		})
		const list = plugin.app.vault.adapter.list.bind(plugin.app.vault.adapter)
		plugin.app.vault.adapter.list = async (path) => {
			if (path === CHAT_SESSIONS_DIR) await listBlocked
			return list(path)
		}
		const service = new ChatService(plugin)

		const initialization = service.ensureSession()
		expect(service.getViewProps().loading).toBe(true)
		releaseList?.()
		await initialization

		expect(service.getViewProps().loading).toBe(false)
	})
})
