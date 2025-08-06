import { Vault } from 'obsidian'
import { SyncRecordModel } from '~/model/sync-record.model'
import { getDBKey } from '~/utils/get-db-key'
import { syncRecordKV } from './kv'

export class SyncRecord {
	constructor(
		public vault: Vault,
		public remoteBaseDir: string,
	) {}

	private get key() {
		return getDBKey(this.vault.getName(), this.remoteBaseDir)
	}

	async updateFileRecord(path: string, record: SyncRecordModel) {
		const map = (await syncRecordKV.get(this.key)) ?? new Map()
		map.set(path, record)
		await syncRecordKV.set(this.key, map)
	}

	async deleteFileRecord(path: string) {
		const map = await syncRecordKV.get(this.key)
		if (map && map.has(path)) {
			map.delete(path)
			await syncRecordKV.set(this.key, map)
		}
	}

	async getRecords() {
		const map = await syncRecordKV.get(this.key)
		return map ?? new Map<string, SyncRecordModel>()
	}

	async setRecords(records: Map<string, SyncRecordModel>) {
		return await syncRecordKV.set(this.key, records)
	}

	async getRecord(path: string) {
		const map = await syncRecordKV.get(this.key)
		return map?.get(path)
	}

	async drop() {
		await syncRecordKV.unset(this.key)
	}
}
