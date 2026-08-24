import { beforeEach, describe, expect, it, vi } from 'vitest'
import logger from '~/utils/logger'

const { emitStopGcMock, emitSyncErrorMock, startMock, nutstoreSyncCtor } =
	vi.hoisted(() => ({
		emitStopGcMock: vi.fn(),
		emitSyncErrorMock: vi.fn(),
		startMock: vi.fn(),
		nutstoreSyncCtor: vi.fn(),
	}))

vi.mock('~/events', () => ({
	emitStopGc: emitStopGcMock,
	emitSyncError: emitSyncErrorMock,
}))

vi.mock('~/sync', () => ({
	SyncStartMode: {
		AUTO_SYNC: 'auto_sync',
		MANUAL_SYNC: 'manual_sync',
	},
	NutstoreSync: nutstoreSyncCtor.mockImplementation(() => ({
		start: startMock,
	})),
}))

const noticeCtor = vi.hoisted(() => vi.fn())

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>()
	return {
		...actual,
		Notice: class {
			constructor(...args: unknown[]) {
				noticeCtor(...args)
			}
		},
	}
})

import { SyncStartMode } from '~/sync'
import type { SyncPolicy } from '~/settings'
import type NutstorePlugin from '..'
import SyncExecutorService from './sync-executor.service'

function createPlugin(): NutstorePlugin {
	return {
		isSyncing: false,
		isAccountConfigured: vi.fn(() => true),
		getToken: vi.fn(async () => 'token'),
		getRemoteAccountId: vi.fn(async () => 'neutral-account'),
		remoteBaseDir: '/remote',
		app: {
			vault: {
				configDir: '.obsidian',
				getName: vi.fn(() => 'vault'),
			},
		},
		webDAVService: {
			createWebDAVClient: vi.fn(async () => ({ client: true })),
		},
		gcService: {
			isRunningNow: vi.fn(() => false),
			waitUntilIdle: vi.fn(async () => undefined),
			runBlobGc: vi.fn(async () => undefined),
		},
		settings: {
			loginMode: 'sso',
			syncMode: 'loose',
			realtimeSync: true,
			autoSyncIntervalSeconds: 300,
			startupSyncDelaySeconds: 10,
			confirmBeforeSync: false,
			confirmBeforeDeleteInAutoSync: true,
			configDirSyncMode: 'bookmarks',
			filterRules: { rules: [] },
		},
		localSettings: {
			syncPolicy: 'two-way',
		},
		settingsService: {
			scheduleReloadSettingsFromDisk: vi.fn(),
		},
	} as unknown as NutstorePlugin
}

describe('SyncExecutorService', () => {
	beforeEach(() => {
		emitStopGcMock.mockReset()
		emitSyncErrorMock.mockReset()
		startMock.mockReset()
		nutstoreSyncCtor.mockClear()
		noticeCtor.mockClear()
	})

	it('delegates directly to NutstoreSync.start and returns its result', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(true)

		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(1)
		expect(startMock).toHaveBeenCalledWith({
			mode: SyncStartMode.AUTO_SYNC,
			syncPolicy: 'two-way',
		})
	})

	it('returns false without constructing sync when account is not configured', async () => {
		const plugin = {
			...createPlugin(),
			isAccountConfigured: vi.fn(() => false),
		} as unknown as NutstorePlugin
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(false)

		expect(nutstoreSyncCtor).not.toHaveBeenCalled()
		expect(startMock).not.toHaveBeenCalled()
	})

	it('returns false when sync is already running', async () => {
		const plugin = {
			...createPlugin(),
			isSyncing: true,
		} as unknown as NutstorePlugin
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(false)

		expect(nutstoreSyncCtor).not.toHaveBeenCalled()
		expect(startMock).not.toHaveBeenCalled()
	})

	it('coalesces an auto sync triggered while running into a single rerun', async () => {
		type StartResult = {
			ended: boolean
			ranTasks: boolean
			shouldReloadSettings: boolean
		}
		let releaseFirst!: (value: StartResult) => void
		startMock.mockImplementationOnce(
			() =>
				new Promise<StartResult>((resolve) => {
					releaseFirst = resolve
				}),
		)
		startMock.mockResolvedValueOnce({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		const first = service.executeSync({ mode: SyncStartMode.AUTO_SYNC })
		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(false)

		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(1)
		expect(startMock).toHaveBeenCalledTimes(1)

		releaseFirst({ ended: true, ranTasks: true, shouldReloadSettings: false })
		await first
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2))
		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(2)
	})

	it('does not schedule a rerun when a manual sync is blocked by a running sync', async () => {
		type StartResult = {
			ended: boolean
			ranTasks: boolean
			shouldReloadSettings: boolean
		}
		let releaseFirst!: (value: StartResult) => void
		startMock.mockImplementationOnce(
			() =>
				new Promise<StartResult>((resolve) => {
					releaseFirst = resolve
				}),
		)
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		const first = service.executeSync({ mode: SyncStartMode.AUTO_SYNC })
		await expect(
			service.executeSync({ mode: SyncStartMode.MANUAL_SYNC }),
		).resolves.toBe(false)

		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(1)

		releaseFirst({ ended: true, ranTasks: true, shouldReloadSettings: false })
		await first

		expect(startMock).toHaveBeenCalledTimes(1)
		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(1)
	})

	it('stops gc and continues sync when gc is running', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const plugin = {
			...createPlugin(),
			gcService: {
				isRunningNow: vi.fn(() => true),
				waitUntilIdle: vi.fn(async () => undefined),
				runBlobGc: vi.fn(async () => undefined),
			},
		} as unknown as NutstorePlugin
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(true)

		expect(emitStopGcMock).toHaveBeenCalledTimes(1)
		expect(plugin.gcService.waitUntilIdle).toHaveBeenCalledTimes(1)
		expect(nutstoreSyncCtor).toHaveBeenCalledTimes(1)
		expect(startMock).toHaveBeenCalledWith({
			mode: SyncStartMode.AUTO_SYNC,
			syncPolicy: 'two-way',
		})
	})

	it('returns true when sync completes without runnable tasks', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: false,
			shouldReloadSettings: false,
		})
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		await expect(
			service.executeSync({ mode: SyncStartMode.AUTO_SYNC }),
		).resolves.toBe(true)
	})

	it('uses a supplied policy for one sync without changing the saved default', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		await service.executeSync({
			mode: SyncStartMode.MANUAL_SYNC,
			syncPolicy: 'receive-only' as SyncPolicy,
		})

		expect(startMock).toHaveBeenCalledWith({
			mode: SyncStartMode.MANUAL_SYNC,
			syncPolicy: 'receive-only',
		})
		expect(plugin.localSettings.syncPolicy).toBe('two-way')
	})

	it('logs sync trigger mode and policy before starting', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger)
		const plugin = createPlugin()
		const service = new SyncExecutorService(plugin)

		await service.executeSync({ mode: SyncStartMode.MANUAL_SYNC })

		expect(infoSpy).toHaveBeenCalledWith('Sync starting with settings:', {
			triggerMode: 'Manual',
			syncPolicy: 'TwoWay',
			loginMode: 'sso',
			remoteBaseDir: '/remote',
			syncMode: 'loose',
			realtimeSync: true,
			autoSyncIntervalSeconds: 300,
			startupSyncDelaySeconds: 10,
			confirmBeforeSync: false,
			confirmBeforeDeleteInAutoSync: true,
			configDirSyncMode: 'bookmarks',
		})
	})

	it('shows a notice on manual sync when a filter rule prunes the config dir', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const plugin = createPlugin()
		plugin.settings.configDirSyncMode = 'all'
		plugin.settings.filterRules.rules = [
			{ expr: '**/.*', options: { caseSensitive: false }, type: 'exclude' },
		]
		const service = new SyncExecutorService(plugin)

		await service.executeSync({ mode: SyncStartMode.MANUAL_SYNC })

		expect(noticeCtor).toHaveBeenCalledWith(expect.stringContaining('**/.*'))
	})

	it('does not show the notice on manual sync without a pruning rule', async () => {
		startMock.mockResolvedValue({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
		const plugin = createPlugin()
		plugin.settings.configDirSyncMode = 'all'
		plugin.settings.filterRules.rules = []
		const service = new SyncExecutorService(plugin)

		await service.executeSync({ mode: SyncStartMode.MANUAL_SYNC })

		expect(noticeCtor).not.toHaveBeenCalled()
	})
})
