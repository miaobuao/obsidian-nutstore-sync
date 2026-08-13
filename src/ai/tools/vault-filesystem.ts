import { MountableFs } from 'just-bash/browser'
import type { IFileSystem } from 'just-bash/browser'
import type { App } from 'obsidian'
import { createBuiltinSkillsFs } from '~/ai/skills/builtin'
import type { PermissionGuard } from '~/ai/tools/permission-guard'
import { ObsidianAdapterFs } from './bash/adapter-fs'
import {
	BASH_TMP_MOUNT_POINT,
	createBashTmpFs,
	ensureBashTmpDirectory,
} from './bash/tmp-fs'
import {
	AGENTS_MOUNT_POINT,
	AGENTS_VAULT_PATH,
	BUILTIN_SKILLS_RELATIVE_MOUNT_POINT,
	SETTINGS_MOUNT_POINT,
	VAULT_MOUNT_POINT,
} from './bash/mount-points'
import {
	listVaultPaths,
	ObsidianVaultFs,
	ReversibleOpRecorder,
} from './bash/fs'
import { SettingsFs } from './settings-fs'
import { ReversibleFs } from './bash/reversible-fs'
import type { SettingsSnapshotFn, SettingsUpdater } from './tool-context'

export interface CreateVaultFileSystemOptions {
	permissionGuard?: PermissionGuard
	recorder?: ReversibleOpRecorder
	onRead?: (vaultPath: string) => void
	scratch?: IFileSystem
	getSettingsSnapshot?: SettingsSnapshotFn
	updateSettings?: SettingsUpdater
}

export async function createVaultFileSystem(
	app: App,
	options: CreateVaultFileSystemOptions = {},
) {
	const onRead = (path: string) => {
		if (!options.recorder?.isCapturing) options.onRead?.(path)
	}
	const initialPaths = await listVaultPaths(app)
	const vaultFs = new ObsidianVaultFs(
		app.vault,
		initialPaths,
		options.permissionGuard,
		onRead,
	)
	await ensureBashTmpDirectory(app)
	const agentsFs = await ObsidianAdapterFs.create(
		app.vault.adapter,
		AGENTS_VAULT_PATH,
		options.permissionGuard,
		onRead,
		AGENTS_MOUNT_POINT,
	)
	const tmpFs = await createBashTmpFs(app, options.permissionGuard, onRead)
	const settingsFs =
		options.getSettingsSnapshot && options.updateSettings
			? new SettingsFs({
					getSettings: options.getSettingsSnapshot,
					updateSettings: options.updateSettings,
					permissionGuard: options.permissionGuard,
					onRead,
				})
			: undefined
	const agentsNamespace = new MountableFs({
		base: agentsFs,
		mounts: [
			{
				mountPoint: BUILTIN_SKILLS_RELATIVE_MOUNT_POINT,
				filesystem: await createBuiltinSkillsFs(),
			},
		],
	})
	const mountable = new MountableFs({
		base: options.scratch,
		mounts: [
			{ mountPoint: BASH_TMP_MOUNT_POINT, filesystem: tmpFs },
			{ mountPoint: VAULT_MOUNT_POINT, filesystem: vaultFs },
			{ mountPoint: AGENTS_MOUNT_POINT, filesystem: agentsNamespace },
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
		? new ReversibleFs(mountable, options.recorder)
		: mountable
}

export {
	AGENTS_MOUNT_POINT,
	BUILTIN_SKILLS_MOUNT_POINT,
	SETTINGS_MOUNT_POINT,
	VAULT_MOUNT_POINT,
} from './bash/mount-points'
