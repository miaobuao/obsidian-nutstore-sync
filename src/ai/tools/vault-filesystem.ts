import { MountableFs, type IFileSystem } from 'just-bash/browser'
import { normalizePath, type App } from 'obsidian'
import { createBuiltinSkillsFs } from '~/ai/skills/builtin'
import type { PermissionGuard } from '~/ai/tools/permission-guard'
import { ObsidianVaultFs, ReversibleOpRecorder } from './bash/fs'
import {
	AGENTS_MOUNT_POINT,
	BUILTIN_SKILLS_MOUNT_POINT,
	getConfigDirMountPoint,
	SETTINGS_MOUNT_POINT,
} from './bash/mount-points'
import { ReversibleFs } from './bash/reversible-fs'
import { SettingsFs } from './settings-fs'
import type { SettingsSnapshotFn, SettingsUpdater } from './tool-context'

export interface CreateVaultFileSystemOptions {
	permissionGuard?: PermissionGuard
	recorder?: ReversibleOpRecorder
	onRead?: (vaultPath: string) => void
	getSettingsSnapshot?: SettingsSnapshotFn
	updateSettings?: SettingsUpdater
	fileSystemManager?: VaultFileSystemManager
}

interface SharedVaultFileSystem {
	builtinSkillsFs: IFileSystem
}

/**
 * just-bash expands globs from IFileSystem.getAllPaths() before it asks the
 * filesystem to read a directory. Seed that synchronous index from the
 * adapter, which is the authoritative view for every path exposed by this
 * filesystem.
 */
async function getInitialVaultPaths(app: App) {
	const paths = new Set(app.vault.getAllLoadedFiles().map((file) => file.path))
	const directories = ['']
	const scannedDirectories = new Set<string>()

	while (directories.length > 0) {
		const directory = directories.pop()!
		if (scannedDirectories.has(directory)) continue
		scannedDirectories.add(directory)
		try {
			const listed = await app.vault.adapter.list(directory)
			for (const path of listed.files) paths.add(normalizePath(path))
			for (const path of listed.folders) {
				const normalized = normalizePath(path)
				paths.add(normalized)
				directories.push(normalized)
			}
		} catch {
			// The loaded Vault index still provides a useful fallback when an
			// adapter directory is temporarily unavailable.
		}
	}

	return [...paths]
}

/**
 * Shares immutable built-in Skills for one plugin instance. Vault access,
 * permissions, read tracking, settings IO, and reversible operation recording
 * remain scoped to each tool invocation.
 */
export class VaultFileSystemManager {
	private sharedPromise?: Promise<SharedVaultFileSystem>

	constructor(private readonly app: App) {}

	async create(options: CreateVaultFileSystemOptions = {}) {
		const shared = await this.getShared()
		return createScopedVaultFileSystem(this.app, shared, options)
	}

	private getShared() {
		if (!this.sharedPromise) {
			this.sharedPromise = createBuiltinSkillsFs()
				.then((builtinSkillsFs) => ({ builtinSkillsFs }))
				.catch((error) => {
					this.sharedPromise = undefined
					throw error
				})
		}
		return this.sharedPromise
	}
}

async function createScopedVaultFileSystem(
	app: App,
	shared: SharedVaultFileSystem,
	options: CreateVaultFileSystemOptions,
) {
	const onRead = (path: string) => {
		if (!options.recorder?.isCapturing) options.onRead?.(path)
	}
	const configDirMountPoint = getConfigDirMountPoint(
		normalizePath(app.vault.configDir),
	)
	const vaultFs = new ObsidianVaultFs(
		app.vault,
		await getInitialVaultPaths(app),
		options.permissionGuard,
		onRead,
	)
	const settingsFs =
		options.getSettingsSnapshot && options.updateSettings
			? new SettingsFs({
					getSettings: options.getSettingsSnapshot,
					updateSettings: options.updateSettings,
					permissionGuard: options.permissionGuard,
					onRead,
				})
			: undefined
	const mountable = new MountableFs({
		base: vaultFs,
		mounts: [
			{
				mountPoint: BUILTIN_SKILLS_MOUNT_POINT,
				filesystem: shared.builtinSkillsFs,
			},
			...(settingsFs
				? [
						{
							mountPoint: SETTINGS_MOUNT_POINT,
							filesystem: settingsFs,
						},
					]
				: []),
		],
	})
	return options.recorder
		? new ReversibleFs(mountable, options.recorder, {
				absoluteMountPoints: [
					AGENTS_MOUNT_POINT,
					configDirMountPoint,
					SETTINGS_MOUNT_POINT,
				],
			})
		: mountable
}

export async function createVaultFileSystem(
	app: App,
	options: CreateVaultFileSystemOptions = {},
) {
	const manager = options.fileSystemManager ?? new VaultFileSystemManager(app)
	return manager.create(options)
}

export {
	AGENTS_MOUNT_POINT,
	BUILTIN_SKILLS_MOUNT_POINT,
	SETTINGS_MOUNT_POINT,
	VAULT_MOUNT_POINT,
} from './bash/mount-points'
