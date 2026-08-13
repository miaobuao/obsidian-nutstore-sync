import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onEndSync } from '~/events'
import { SyncPolicy } from '~/settings'
import { syncRecordKV } from '~/storage'
import { SyncRecord } from '~/storage/sync-record'
import SkippedTask, { SkipReason } from './tasks/skipped.task'
import { createSyncLogger } from './log'

const h = vi.hoisted(() => ({
	decide: vi.fn(),
	cacheRestore: vi.fn(async () => undefined),
	cacheSave: vi.fn(async () => undefined),
}))

const storageMock = vi.hoisted(() => {
	const map = new Map<string, unknown>()
	return {
		getItem: vi.fn(async (key: string) => map.get(key) ?? null),
		setItem: vi.fn(async (key: string, value: unknown) => {
			map.set(key, value)
			return value
		}),
		removeItem: vi.fn(async (key: string) => {
			map.delete(key)
		}),
		keys: vi.fn(async () => [...map.keys()]),
		clear: vi.fn(async () => {
			map.clear()
		}),
	}
})

vi.mock('localforage', () => ({
	default: {
		createInstance: () => storageMock,
	},
	createInstance: () => storageMock,
}))

vi.mock('~/services/cache.service.v1', () => ({
	default: class {
		restoreRemoteTraversalCacheIfMissing = h.cacheRestore
		saveRemoteTraversalCache = h.cacheSave
	},
}))

vi.mock('~/fs/nutstore', () => ({
	NutstoreFileSystem: class {},
}))

vi.mock('~/fs/local-vault', () => ({
	LocalVaultFileSystem: class {},
}))

vi.mock('./decision/two-way.decider', () => ({
	default: class {
		decide = h.decide
	},
}))

vi.mock('./decision/send-only.decider', () => ({
	default: class {
		decide = h.decide
	},
	SendOnlyOverrideChangesSyncDecider: class {
		decide = h.decide
	},
}))

vi.mock('./decision/receive-only.decider', () => ({
	default: class {
		decide = h.decide
	},
	ReceiveOnlyRevertLocalChangesSyncDecider: class {
		decide = h.decide
	},
}))

import { NutstoreSync, SyncStartMode } from './index'

function createPlugin() {
	const settings = {
		loginMode: 'sso',
		nutstoreEnterpriseBaseUrl: '',
		remoteDir: '/三宝/',
		syncMode: 'loose',
		realtimeSync: false,
		autoSyncIntervalSeconds: 120,
		startupSyncDelaySeconds: 0,
		confirmBeforeSync: false,
		confirmBeforeDeleteInAutoSync: false,
		configDirSyncMode: 'none',
		conflictStrategy: 'no-conflict-merge',
		filterRules: { rules: [] },
		skipLargeFiles: { maxSize: '30 MB' },
	} as never
	return {
		settings,
		localSettings: { syncPolicy: SyncPolicy.TwoWay },
		manifest: { id: 'nutstore-sync' },
		app: {
			vault: {
				getName: () => 'test-vault',
				configDir: '.obsidian',
				getRoot: () => ({ path: '' }),
			},
		},
		remoteBaseDir: '/三宝/',
	}
}

function createWebDAV() {
	return {
		exists: vi.fn(async () => true),
		createDirectory: vi.fn(async () => undefined),
		stat: vi.fn(),
	}
}

function buildSync() {
	const webdav = createWebDAV()
	const plugin = createPlugin()
	const sync = new NutstoreSync(plugin as never, {
		vault: plugin.app.vault as never,
		token: 'token',
		remoteAccountId: 'account',
		remoteBaseDir: '/三宝/',
		webdav: webdav as never,
	})
	return { sync, webdav, plugin }
}

function captureEndSync() {
	const events: Array<{ showNotice: boolean; failedCount: number }> = []
	const subscription = onEndSync().subscribe((event) => events.push(event))
	return { events, subscription }
}

describe('NutstoreSync.start endSync emission', () => {
	beforeEach(() => {
		h.decide.mockReset()
		h.cacheRestore.mockClear()
		h.cacheSave.mockClear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('emits endSync for a no-change auto sync without task side effects', async () => {
		h.decide.mockResolvedValue([])
		const { sync } = buildSync()
		const { events, subscription } = captureEndSync()

		const result = await sync.start({
			mode: SyncStartMode.AUTO_SYNC,
			syncPolicy: SyncPolicy.TwoWay,
		})

		subscription.unsubscribe()
		expect(events).toEqual([{ showNotice: false, failedCount: 0 }])
		expect(result).toEqual({
			ended: false,
			ranTasks: false,
			shouldReloadSettings: false,
		})
	})

	it('emits endSync for a no-change manual sync and reports ended', async () => {
		h.decide.mockResolvedValue([])
		const { sync } = buildSync()
		const { events, subscription } = captureEndSync()

		const result = await sync.start({
			mode: SyncStartMode.MANUAL_SYNC,
			syncPolicy: SyncPolicy.TwoWay,
		})

		subscription.unsubscribe()
		expect(events).toEqual([{ showNotice: true, failedCount: 0 }])
		expect(result).toEqual({
			ended: true,
			ranTasks: false,
			shouldReloadSettings: false,
		})
	})

	it('emits endSync after auto sync with tasks completes', async () => {
		const { sync, webdav, plugin } = buildSync()
		h.decide.mockResolvedValue([
			new SkippedTask({
				vault: plugin.app.vault as never,
				webdav: webdav as never,
				remoteBaseDir: '/三宝/',
				remotePath: '/三宝/a.md',
				localPath: 'a.md',
				syncRecord: new SyncRecord('test-key', syncRecordKV),
				logger: createSyncLogger('[Test]'),
				reason: SkipReason.ConflictInSendOnlyMode,
			}),
		])
		const { events, subscription } = captureEndSync()

		const result = await sync.start({
			mode: SyncStartMode.AUTO_SYNC,
			syncPolicy: SyncPolicy.TwoWay,
		})

		subscription.unsubscribe()
		expect(events).toEqual([{ showNotice: false, failedCount: 0 }])
		expect(result).toEqual({
			ended: true,
			ranTasks: true,
			shouldReloadSettings: false,
		})
	})
})
