import { useSettings } from '~/settings'
import { syncRecordKV } from '~/storage'
import { SyncRecord } from '~/storage/sync-record'
import { NutstoreSync } from '~/sync'
import TwoWaySyncDecider from '~/sync/decision/two-way.decider'
import { getSyncRecordNamespace } from '~/utils/get-sync-record-namespace'
import waitUntil from '~/utils/wait-until'
import type NutstorePlugin from '..'

export interface SyncOptions {
	showNotice?: boolean
}

export default class SyncExecutorService {
	constructor(private plugin: NutstorePlugin) {}

	async executeSync(options: SyncOptions = {}) {
		const settings = await useSettings()

		if (this.plugin.isSyncing) {
			return false
		}

		await waitUntil(() => this.plugin.isSyncing === false, 500)

		const sync = new NutstoreSync(this.plugin, {
			vault: this.plugin.app.vault,
			token: await this.plugin.getToken(),
			remoteBaseDir: this.plugin.remoteBaseDir,
			webdav: await this.plugin.webDAVService.createWebDAVClient(),
		})

		const syncRecord = new SyncRecord(
			getSyncRecordNamespace(
				this.plugin.app.vault.getName(),
				this.plugin.remoteBaseDir,
			),
			syncRecordKV,
		)

		const decider = new TwoWaySyncDecider(sync, syncRecord)
		const decided = await decider.decide()

		if (decided.length === 0) {
			return false
		}

		await sync.start({
			showNotice: options.showNotice ?? false,
		})

		return true
	}
}
