import { Notice, Setting } from 'obsidian'
import { join } from 'path'
import CacheRestoreModal from '~/components/CacheRestoreModal'
import CacheSaveModal from '~/components/CacheSaveModal'
import SelectRemoteBaseDirModal from '~/components/SelectRemoteBaseDirModal'
import i18n from '~/i18n'
import { deltaCacheKV, syncRecordKV } from '~/storage/kv'
import { getDBKey } from '~/utils/get-db-key'
import logger from '~/utils/logger'
import { stdRemotePath } from '~/utils/std-remote-path'
import BaseSettings from './settings.base'

export interface ExportedStorage {
	deltaCache: string
	exportedAt: string
}

export default class CacheSettings extends BaseSettings {
	async display() {
		this.containerEl.empty()
		this.containerEl.createEl('h2', { text: i18n.t('settings.cache.title') })

		// set remote cache directory
		new Setting(this.containerEl)
			.setName(i18n.t('settings.cache.remoteCacheDir.name'))
			.setDesc(i18n.t('settings.cache.remoteCacheDir.desc'))
			.addText((text) => {
				text
					.setPlaceholder(i18n.t('settings.cache.remoteCacheDir.placeholder'))
					.setValue(this.remoteCacheDir)
					.onChange(async (value) => {
						this.plugin.settings.remoteCacheDir = value
						await this.plugin.saveSettings()
					})
				text.inputEl.addEventListener('blur', async () => {
					this.plugin.settings.remoteCacheDir = this.remoteCacheDir
					await this.plugin.saveSettings()
					this.display()
				})
			})
			.addButton((button) => {
				button.setIcon('folder').onClick(() => {
					new SelectRemoteBaseDirModal(this.app, this.plugin, async (path) => {
						this.plugin.settings.remoteCacheDir = path
						await this.plugin.saveSettings()
						this.display()
					}).open()
				})
			})

		// Save and restore cache
		new Setting(this.containerEl)
			.setName(i18n.t('settings.cache.dumpName'))
			.setDesc(i18n.t('settings.cache.dumpDesc'))
			.addButton((button) => {
				button.setButtonText(i18n.t('settings.cache.dump')).onClick(() => {
					new CacheSaveModal(this.app, this.plugin, this.remoteCacheDir, () =>
						this.display(),
					).open()
				})
			})
			.addButton((button) => {
				button.setButtonText(i18n.t('settings.cache.restore')).onClick(() => {
					new CacheRestoreModal(
						this.app,
						this.plugin,
						this.remoteCacheDir,
						() => this.display(),
					).open()
				})
			})

		// clear
		new Setting(this.containerEl)
			.setName(i18n.t('settings.cache.clearName'))
			.setDesc(i18n.t('settings.cache.clearDesc'))
			.addButton((button) => {
				let confirmed = false
				button
					.setButtonText(i18n.t('settings.cache.clear'))
					.onClick(async () => {
						if (confirmed) {
							try {
								await this.clearCache()
								new Notice(i18n.t('settings.cache.cleared'))
							} catch (error) {
								logger.error('Error clearing cache:', error)
								new Notice(`Error clearing cache: ${error.message}`)
							} finally {
								button.setButtonText(i18n.t('settings.cache.clear'))
								button.buttonEl.classList.remove('mod-warning')
								confirmed = false
							}
						} else {
							confirmed = true
							button
								.setButtonText(i18n.t('settings.cache.confirm'))
								.setWarning()
						}
					})
				button.buttonEl.addEventListener('blur', () => {
					if (confirmed) {
						confirmed = false
						button.setButtonText(i18n.t('settings.cache.clear'))
						button.buttonEl.classList.remove('mod-warning')
					}
				})
			})
	}

	get remoteCacheDir() {
		return stdRemotePath(
			this.plugin.settings.remoteCacheDir?.trim() ||
				this.plugin.manifest.name.trim(),
		)
	}

	get remoteCachePath() {
		const filename = getDBKey(
			this.app.vault.getName(),
			this.plugin.settings.remoteDir,
		)
		return join(this.remoteCacheDir, filename + '.json')
	}

	async createRemoteCacheDir() {
		const webdav = await this.plugin.createWebDAVClient()
		return await webdav.createDirectory(this.remoteCacheDir, {
			recursive: true,
		})
	}

	/**
	 * Clear the local cache
	 */
	async clearCache() {
		await deltaCacheKV.clear()
		await syncRecordKV.clear()
	}
}
