import { Notice } from 'obsidian'
import { deflate, inflate } from 'pako'
import { join } from 'path'
import superjson from 'superjson'
import { BufferLike } from 'webdav'
import { getDirectoryContents } from '~/api/webdav'
import i18n from '~/i18n'
import { ExportedStorage } from '~/settings/cache'
import { deltaCacheKV } from '~/storage/kv'
import { fileStatToStatModel } from '~/utils/file-stat-to-stat-model'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'

/**
 * Service for handling cache operations (save, restore, delete, list)
 */
export default class CacheService {
	constructor(
		private plugin: NutstorePlugin,
		private remoteCacheDir: string,
	) {}

	/**
	 * Save the current cache to a file in the remote cache directory
	 */
	async saveCache(filename: string) {
		try {
			if (!filename.endsWith('.v1')) {
				filename += '.v1'
			}
			const webdav = await this.plugin.createWebDAVClient()
			const deltaCache = await deltaCacheKV.dump()
			const exportedStorage: ExportedStorage = {
				deltaCache: superjson.stringify(deltaCache),
				exportedAt: new Date().toISOString(),
			}
			const exportedStorageStr = JSON.stringify(exportedStorage)
			const deflatedStorage = deflate(exportedStorageStr, { level: 9 })
			await webdav.createDirectory(this.remoteCacheDir, { recursive: true })

			const filePath = join(this.remoteCacheDir, filename)
			await webdav.putFileContents(filePath, deflatedStorage.buffer, {
				overwrite: true,
			})

			new Notice(i18n.t('settings.cache.saveModal.success'))
			return Promise.resolve()
		} catch (error) {
			logger.error('Error saving cache:', error)
			new Notice(
				i18n.t('settings.cache.saveModal.error', {
					message: error.message,
				}),
			)
			return Promise.reject(error)
		}
	}

	/**
	 * Restore the cache from a file in the remote cache directory
	 */
	async restoreCache(filename: string) {
		try {
			const webdav = await this.plugin.createWebDAVClient()
			const filePath = join(this.remoteCacheDir, filename)

			const fileExists = await webdav.exists(filePath).catch(() => false)
			if (!fileExists) {
				new Notice(i18n.t('settings.cache.restoreModal.fileNotFound'))
				return Promise.reject(new Error('File not found'))
			}

			const fileContent = (await webdav.getFileContents(filePath, {
				format: 'binary',
			})) as BufferLike
			const inflatedFileContent = inflate(new Uint8Array(fileContent))
			const decoder = new TextDecoder()
			const exportedStorage: ExportedStorage = JSON.parse(
				decoder.decode(inflatedFileContent),
			)
			const { deltaCache } = exportedStorage
			await deltaCacheKV.restore(superjson.parse(deltaCache))

			new Notice(i18n.t('settings.cache.restoreModal.success'))
			return Promise.resolve()
		} catch (error) {
			logger.error('Error restoring cache:', error)
			new Notice(
				i18n.t('settings.cache.restoreModal.error', {
					message: error.message,
				}),
			)
			return Promise.reject(error)
		}
	}

	/**
	 * Delete a cache file from the remote cache directory
	 */
	async deleteCache(filename: string): Promise<void> {
		try {
			const webdav = await this.plugin.createWebDAVClient()
			const filePath = join(this.remoteCacheDir, filename)

			await webdav.deleteFile(filePath)

			new Notice(i18n.t('settings.cache.restoreModal.deleteSuccess'))
			return Promise.resolve()
		} catch (error) {
			logger.error('Error deleting cache file:', error)
			new Notice(
				i18n.t('settings.cache.restoreModal.deleteError', {
					message: error.message,
				}),
			)
			return Promise.reject(error)
		}
	}

	/**
	 * Load the list of cache files from the remote cache directory
	 */
	async loadCacheFileList() {
		try {
			const webdav = await this.plugin.createWebDAVClient()

			const dirExists = await webdav
				.exists(this.remoteCacheDir)
				.catch(() => false)
			if (!dirExists) {
				await webdav.createDirectory(this.remoteCacheDir, { recursive: true })
				return []
			}

			const files = await getDirectoryContents(
				await this.plugin.getToken(),
				this.remoteCacheDir,
			)
			return files.map(fileStatToStatModel)
		} catch (error) {
			logger.error('Error loading cache file list:', error)
			throw error
		}
	}
}
