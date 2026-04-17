import { Bash } from 'just-bash/browser'
import type { App } from 'obsidian'
import {
	listVaultPaths,
	MountedVaultFs,
	ObsidianVaultFs,
	VAULT_MOUNT_POINT,
} from './fs'

export interface VaultBashExecOptions {
	cwd?: string
	stdin?: string
	rawScript?: boolean
}

export async function createVaultBash(app: App) {
	const initialPaths = await listVaultPaths(app)
	const vaultFs = new ObsidianVaultFs(app.vault, initialPaths)
	const fs = new MountedVaultFs(vaultFs)

	return new Bash({
		fs,
		cwd: VAULT_MOUNT_POINT,
	})
}

export async function execVaultBash(
	app: App,
	script: string,
	options: VaultBashExecOptions = {},
) {
	const bash = await createVaultBash(app)
	return bash.exec(script, {
		cwd: options.cwd ?? VAULT_MOUNT_POINT,
		stdin: options.stdin,
		rawScript: options.rawScript,
	})
}

export { VAULT_MOUNT_POINT }
