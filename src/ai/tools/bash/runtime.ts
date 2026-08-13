import { Bash } from 'just-bash/browser'
import type { IFileSystem } from 'just-bash/browser'
import type { App } from 'obsidian'
import type { PermissionGuard } from '~/ai/tools/permission-guard'
import { ReversibleOpRecorder } from './fs'
import { archiveCommands } from './zip'
import { createVaultFileSystem, VAULT_MOUNT_POINT } from '../vault-filesystem'
import type { SettingsSnapshotFn, SettingsUpdater } from '../tool-context'

export interface VaultBashExecOptions {
	cwd?: string
	stdin?: string
	rawScript?: boolean
	permissionGuard?: PermissionGuard
	onRead?: (vaultPath: string) => void
	scratch?: IFileSystem
	getSettingsSnapshot?: SettingsSnapshotFn
	updateSettings?: SettingsUpdater
}

export async function createVaultBash(
	app: App,
	permissionGuard?: PermissionGuard,
	recorder?: ReversibleOpRecorder,
	onRead?: (vaultPath: string) => void,
	scratch?: IFileSystem,
	settingsIo?: {
		getSettingsSnapshot?: SettingsSnapshotFn
		updateSettings?: SettingsUpdater
	},
) {
	const fs = await createVaultFileSystem(app, {
		permissionGuard,
		recorder,
		onRead,
		scratch,
		getSettingsSnapshot: settingsIo?.getSettingsSnapshot,
		updateSettings: settingsIo?.updateSettings,
	})
	return new Bash({
		fs,
		cwd: VAULT_MOUNT_POINT,
		customCommands: archiveCommands,
	})
}

export async function execVaultBash(
	app: App,
	script: string,
	options: VaultBashExecOptions = {},
) {
	const recorder = new ReversibleOpRecorder()
	const bash = await createVaultBash(
		app,
		options.permissionGuard,
		recorder,
		options.onRead,
		options.scratch,
		{
			getSettingsSnapshot: options.getSettingsSnapshot,
			updateSettings: options.updateSettings,
		},
	)
	const result = await bash.exec(script, {
		cwd: options.cwd ?? VAULT_MOUNT_POINT,
		stdin: options.stdin,
		rawScript: options.rawScript,
	})
	return {
		...result,
		reversibleOps: await recorder.getNetOperations(),
	}
}

export {
	AGENTS_MOUNT_POINT,
	BUILTIN_SKILLS_MOUNT_POINT,
	SETTINGS_MOUNT_POINT,
	VAULT_MOUNT_POINT,
} from '../vault-filesystem'
