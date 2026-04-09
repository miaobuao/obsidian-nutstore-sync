import {
	InMemoryFs,
	type BufferEncoding,
	type CpOptions,
	type FileContent,
	type FsStat,
	type IFileSystem,
	type MkdirOptions,
	type RmOptions,
} from 'just-bash/browser'
import {
	normalizePath,
	type App,
	type TAbstractFile,
	type TFile,
	type TFolder,
	type Vault,
} from 'obsidian'
import { posix as pathPosix } from 'path-browserify'

const FILE_MODE = 0o644
const DIR_MODE = 0o755
const VAULT_MOUNT_POINT = '/vault'
type ReadFileOptions = { encoding?: BufferEncoding | null }
type WriteFileOptions = { encoding?: BufferEncoding }

function getEncoding(
	options?: ReadFileOptions | WriteFileOptions | BufferEncoding | null,
) {
	if (!options) {
		return 'utf8'
	}
	return typeof options === 'string' ? options : (options.encoding ?? 'utf8')
}

function decodeContent(
	content: Uint8Array,
	options?: ReadFileOptions | BufferEncoding,
) {
	const encoding = getEncoding(options)
	if (encoding === 'base64') {
		if (typeof Buffer !== 'undefined') {
			return Buffer.from(content).toString('base64')
		}
		let binary = ''
		for (const byte of content) {
			binary += String.fromCharCode(byte)
		}
		return btoa(binary)
	}
	return new TextDecoder(encoding === 'utf-8' ? 'utf-8' : 'utf-8').decode(
		content,
	)
}

function encodeContent(
	content: FileContent,
	options?: WriteFileOptions | BufferEncoding,
) {
	if (content instanceof Uint8Array) {
		return content
	}

	const encoding = getEncoding(options)
	if (encoding === 'base64') {
		if (typeof Buffer !== 'undefined') {
			return Uint8Array.from(Buffer.from(content, 'base64'))
		}
		const decoded = atob(content)
		return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
	}

	return new TextEncoder().encode(content)
}

function toArrayBuffer(content: Uint8Array) {
	return content.buffer.slice(
		content.byteOffset,
		content.byteOffset + content.byteLength,
	) as ArrayBuffer
}

function normalizeVirtualPath(inputPath: string) {
	const normalized = pathPosix.normalize(pathPosix.resolve('/', inputPath))
	return normalized === '' ? '/' : normalized
}

function joinVirtualPath(parent: string, name: string) {
	return parent === '/' ? `/${name}` : `${parent}/${name}`
}

function ensureNotEscapingRoot(inputPath: string) {
	const normalized = normalizeVirtualPath(inputPath)
	if (!normalized.startsWith('/')) {
		throw new Error(`EINVAL: invalid path '${inputPath}'`)
	}
	return normalized
}

function mapStat(stat: {
	type: 'file' | 'folder'
	size: number
	mtime: number
}): FsStat {
	return {
		isFile: stat.type === 'file',
		isDirectory: stat.type === 'folder',
		isSymbolicLink: false,
		mode: stat.type === 'folder' ? DIR_MODE : FILE_MODE,
		size: stat.type === 'file' ? stat.size : 0,
		mtime: new Date(stat.mtime),
	}
}

function mapAbstractFileStat(file: TAbstractFile): FsStat {
	if (isFolder(file)) {
		return mapStat({
			type: 'folder',
			size: 0,
			mtime: 0,
		})
	}

	const textFile = file as TFile
	return mapStat({
		type: 'file',
		size: textFile.stat.size,
		mtime: textFile.stat.mtime,
	})
}

function isFolder(file: TAbstractFile | null | undefined): file is TFolder {
	return Boolean(file && 'children' in file && Array.isArray(file.children))
}

function isFile(file: TAbstractFile | null | undefined): file is TFile {
	return Boolean(file && !isFolder(file))
}

async function copyRecursive(
	fs: IFileSystem,
	src: string,
	dest: string,
	options?: CpOptions,
) {
	const sourceStat = await fs.stat(src)
	if (sourceStat.isDirectory) {
		if (!options?.recursive) {
			throw new Error(`EISDIR: illegal operation on a directory, copy '${src}'`)
		}
		await fs.mkdir(dest, { recursive: true })
		for (const entry of await fs.readdir(src)) {
			await copyRecursive(
				fs,
				joinVirtualPath(src, entry),
				joinVirtualPath(dest, entry),
				options,
			)
		}
		return
	}

	const content = await fs.readFileBuffer(src)
	await fs.writeFile(dest, content)
}

async function removeRecursive(
	fs: IFileSystem,
	targetPath: string,
	options?: RmOptions,
) {
	const stat = await fs.stat(targetPath)
	if (stat.isDirectory) {
		const children = await fs.readdir(targetPath)
		if (children.length > 0 && !options?.recursive) {
			throw new Error(`ENOTEMPTY: directory not empty, remove '${targetPath}'`)
		}
		for (const child of children) {
			await removeRecursive(fs, joinVirtualPath(targetPath, child), options)
		}
	}
	await fs.rm(targetPath, options)
}

export async function listVaultPaths(app: App) {
	const paths = new Set<string>(['/'])
	const queue = [...app.vault.getRoot().children]

	while (queue.length > 0) {
		const current = queue.shift()
		if (!current) {
			continue
		}

		paths.add(`/${normalizePath(current.path)}`)
		if (isFolder(current)) {
			queue.push(...current.children)
		}
	}

	return [...paths]
}

export class ObsidianVaultFs implements IFileSystem {
	private readonly snapshot = new Set<string>()

	constructor(
		private readonly vault: Vault,
		initialPaths: string[] = [],
	) {
		for (const path of initialPaths) {
			this.snapshot.add(ensureNotEscapingRoot(path))
		}
		this.snapshot.add('/')
	}

	private toVaultPath(inputPath: string) {
		const normalized = ensureNotEscapingRoot(inputPath)
		return normalized === '/' ? '' : normalizePath(normalized.slice(1))
	}

	private async statInternal(inputPath: string) {
		const target = this.vault.getAbstractFileByPath(this.toVaultPath(inputPath))
		if (!target) {
			throw new Error(`ENOENT: no such file or directory, stat '${inputPath}'`)
		}
		return target
	}

	private recordPath(inputPath: string) {
		const normalized = ensureNotEscapingRoot(inputPath)
		const parts = normalized.split('/').filter(Boolean)
		this.snapshot.add('/')
		let current = ''
		for (const part of parts) {
			current = `${current}/${part}`
			this.snapshot.add(current)
		}
	}

	private forgetPath(inputPath: string) {
		const normalized = ensureNotEscapingRoot(inputPath)
		for (const path of [...this.snapshot]) {
			if (path === normalized || path.startsWith(`${normalized}/`)) {
				this.snapshot.delete(path)
			}
		}
		this.snapshot.add('/')
	}

	private assertExists(path: string) {
		return this.exists(path).then((exists) => {
			if (!exists) {
				throw new Error(`ENOENT: no such file or directory, access '${path}'`)
			}
		})
	}

	async readFile(
		path: string,
		options?: ReadFileOptions | BufferEncoding,
	): Promise<string> {
		return decodeContent(await this.readFileBuffer(path), options)
	}

	async readFileBuffer(path: string): Promise<Uint8Array> {
		const stat = await this.stat(path)
		if (!stat.isFile) {
			throw new Error(
				`EISDIR: illegal operation on a directory, read '${path}'`,
			)
		}
		const target = this.vault.getAbstractFileByPath(this.toVaultPath(path))
		if (!isFile(target)) {
			throw new Error(`ENOENT: no such file or directory, read '${path}'`)
		}
		const buffer = await this.vault.readBinary(target)
		return new Uint8Array(buffer as ArrayBuffer)
	}

	async writeFile(
		path: string,
		content: FileContent,
		options?: WriteFileOptions | BufferEncoding,
	): Promise<void> {
		await this.mkdir(pathPosix.dirname(ensureNotEscapingRoot(path)), {
			recursive: true,
		})
		const encoded = encodeContent(content, options)
		const vaultPath = this.toVaultPath(path)
		const target = this.vault.getAbstractFileByPath(vaultPath)
		if (target) {
			if (!isFile(target)) {
				throw new Error(
					`EISDIR: illegal operation on a directory, write '${path}'`,
				)
			}
			await this.vault.modifyBinary(target, toArrayBuffer(encoded))
		} else {
			await this.vault.createBinary(vaultPath, toArrayBuffer(encoded))
		}
		this.recordPath(path)
	}

	async appendFile(
		path: string,
		content: FileContent,
		options?: WriteFileOptions | BufferEncoding,
	): Promise<void> {
		const encoded = encodeContent(content, options)
		const existing = (await this.exists(path))
			? await this.readFileBuffer(path)
			: (new Uint8Array(0) as Uint8Array)
		const merged = new Uint8Array(existing.length + encoded.length)
		merged.set(existing)
		merged.set(encoded, existing.length)
		await this.writeFile(path, merged)
	}

	async exists(path: string): Promise<boolean> {
		const normalized = ensureNotEscapingRoot(path)
		if (normalized === '/') {
			return true
		}
		return Boolean(
			this.vault.getAbstractFileByPath(this.toVaultPath(normalized)),
		)
	}

	async stat(path: string): Promise<FsStat> {
		if (ensureNotEscapingRoot(path) === '/') {
			return {
				isFile: false,
				isDirectory: true,
				isSymbolicLink: false,
				mode: DIR_MODE,
				size: 0,
				mtime: new Date(0),
			}
		}
		return mapAbstractFileStat(await this.statInternal(path))
	}

	async mkdir(path: string, options?: MkdirOptions): Promise<void> {
		const normalized = ensureNotEscapingRoot(path)
		if (normalized === '/') {
			return
		}

		const segments = normalized.split('/').filter(Boolean)
		let current = ''
		for (let index = 0; index < segments.length; index += 1) {
			current = `${current}/${segments[index]}`
			if (await this.exists(current)) {
				continue
			}
			if (!options?.recursive && index !== segments.length - 1) {
				throw new Error(
					`ENOENT: no such file or directory, mkdir '${normalized}'`,
				)
			}
			await this.vault.createFolder(this.toVaultPath(current))
			this.recordPath(current)
		}
	}

	async readdir(path: string): Promise<string[]> {
		const stat = await this.stat(path)
		if (!stat.isDirectory) {
			throw new Error(`ENOTDIR: not a directory, scandir '${path}'`)
		}
		const target =
			this.toVaultPath(path) === ''
				? this.vault.getRoot()
				: this.vault.getAbstractFileByPath(this.toVaultPath(path))
		if (!isFolder(target)) {
			throw new Error(`ENOTDIR: not a directory, scandir '${path}'`)
		}
		return [...target.children]
			.map((item) => item.name)
			.filter((item): item is string => Boolean(item))
			.sort()
	}

	async readdirWithFileTypes(path: string) {
		const stat = await this.stat(path)
		if (!stat.isDirectory) {
			throw new Error(`ENOTDIR: not a directory, scandir '${path}'`)
		}
		const target =
			this.toVaultPath(path) === ''
				? this.vault.getRoot()
				: this.vault.getAbstractFileByPath(this.toVaultPath(path))
		if (!isFolder(target)) {
			throw new Error(`ENOTDIR: not a directory, scandir '${path}'`)
		}
		return [...target.children]
			.map((item) => ({
				name: item.name,
				isFile: isFile(item),
				isDirectory: isFolder(item),
				isSymbolicLink: false,
			}))
			.sort((left, right) => left.name.localeCompare(right.name))
	}

	async rm(path: string, options?: RmOptions): Promise<void> {
		const normalized = ensureNotEscapingRoot(path)
		if (normalized === '/') {
			throw new Error(`EPERM: operation not permitted, remove '${path}'`)
		}

		if (!(await this.exists(normalized))) {
			if (options?.force) {
				return
			}
			throw new Error(`ENOENT: no such file or directory, remove '${path}'`)
		}

		const target = this.vault.getAbstractFileByPath(
			this.toVaultPath(normalized),
		)
		if (!target) {
			throw new Error(`ENOENT: no such file or directory, remove '${path}'`)
		}
		await this.vault.delete(target, Boolean(options?.recursive))
		this.forgetPath(normalized)
	}

	async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
		await copyRecursive(this, src, dest, options)
	}

	async mv(src: string, dest: string): Promise<void> {
		await this.mkdir(pathPosix.dirname(ensureNotEscapingRoot(dest)), {
			recursive: true,
		})
		const target = this.vault.getAbstractFileByPath(this.toVaultPath(src))
		if (!target) {
			throw new Error(`ENOENT: no such file or directory, move '${src}'`)
		}
		await this.vault.rename(target, this.toVaultPath(dest))
		this.forgetPath(src)
		this.recordPath(dest)
	}

	resolvePath(base: string, path: string): string {
		return ensureNotEscapingRoot(pathPosix.resolve(base || '/', path))
	}

	getAllPaths(): string[] {
		return [...this.snapshot].sort()
	}

	async chmod(path: string, _mode: number): Promise<void> {
		await this.assertExists(path)
	}

	async symlink(_target: string, linkPath: string): Promise<void> {
		throw new Error(
			`ENOTSUP: symbolic links are not supported in vault fs, link '${linkPath}'`,
		)
	}

	async link(_existingPath: string, newPath: string): Promise<void> {
		throw new Error(
			`ENOTSUP: hard links are not supported in vault fs, link '${newPath}'`,
		)
	}

	async readlink(path: string): Promise<string> {
		throw new Error(`EINVAL: not a symbolic link, readlink '${path}'`)
	}

	async lstat(path: string): Promise<FsStat> {
		return this.stat(path)
	}

	async realpath(path: string): Promise<string> {
		await this.assertExists(path)
		return ensureNotEscapingRoot(path)
	}

	async utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
		const stat = await this.stat(path)
		if (stat.isDirectory) {
			return
		}
		const content = await this.readFileBuffer(path)
		await this.writeFile(path, content)
	}
}

export class MountedVaultFs implements IFileSystem {
	private readonly scratch = new InMemoryFs()

	constructor(private readonly vaultFs: ObsidianVaultFs) {}

	private isRoot(path: string) {
		return ensureNotEscapingRoot(path) === '/'
	}

	private isVaultMount(path: string) {
		return ensureNotEscapingRoot(path) === VAULT_MOUNT_POINT
	}

	private isVaultPath(path: string) {
		const normalized = ensureNotEscapingRoot(path)
		return (
			normalized === VAULT_MOUNT_POINT ||
			normalized.startsWith(`${VAULT_MOUNT_POINT}/`)
		)
	}

	private toVaultRelative(path: string) {
		const normalized = ensureNotEscapingRoot(path)
		if (normalized === VAULT_MOUNT_POINT) {
			return '/'
		}
		return normalized.slice(VAULT_MOUNT_POINT.length) || '/'
	}

	private route(path: string) {
		const normalized = ensureNotEscapingRoot(path)
		if (this.isVaultPath(normalized)) {
			return {
				fs: this.vaultFs as IFileSystem,
				path: this.toVaultRelative(normalized),
			}
		}
		return {
			fs: this.scratch as IFileSystem,
			path: normalized,
		}
	}

	private async genericCp(src: string, dest: string, options?: CpOptions) {
		const sourceStat = await this.stat(src)
		if (sourceStat.isDirectory) {
			if (!options?.recursive) {
				throw new Error(
					`EISDIR: illegal operation on a directory, copy '${src}'`,
				)
			}
			await this.mkdir(dest, { recursive: true })
			for (const entry of await this.readdir(src)) {
				await this.genericCp(
					joinVirtualPath(src, entry),
					joinVirtualPath(dest, entry),
					options,
				)
			}
			return
		}
		await this.writeFile(dest, await this.readFileBuffer(src))
	}

	async readFile(
		path: string,
		options?: ReadFileOptions | BufferEncoding,
	): Promise<string> {
		if (this.isVaultMount(path)) {
			throw new Error(
				`EISDIR: illegal operation on a directory, read '${path}'`,
			)
		}
		const routed = this.route(path)
		return routed.fs.readFile(routed.path, options)
	}

	async readFileBuffer(path: string): Promise<Uint8Array> {
		if (this.isVaultMount(path)) {
			throw new Error(
				`EISDIR: illegal operation on a directory, read '${path}'`,
			)
		}
		const routed = this.route(path)
		return routed.fs.readFileBuffer(routed.path)
	}

	async writeFile(
		path: string,
		content: FileContent,
		options?: WriteFileOptions | BufferEncoding,
	): Promise<void> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			throw new Error(
				`EISDIR: illegal operation on a directory, write '${path}'`,
			)
		}
		const routed = this.route(path)
		await routed.fs.writeFile(routed.path, content, options)
	}

	async appendFile(
		path: string,
		content: FileContent,
		options?: WriteFileOptions | BufferEncoding,
	): Promise<void> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			throw new Error(
				`EISDIR: illegal operation on a directory, append '${path}'`,
			)
		}
		const routed = this.route(path)
		await routed.fs.appendFile(routed.path, content, options)
	}

	async exists(path: string): Promise<boolean> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			return true
		}
		const routed = this.route(path)
		return routed.fs.exists(routed.path)
	}

	async stat(path: string): Promise<FsStat> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			return {
				isFile: false,
				isDirectory: true,
				isSymbolicLink: false,
				mode: DIR_MODE,
				size: 0,
				mtime: new Date(0),
			}
		}
		const routed = this.route(path)
		return routed.fs.stat(routed.path)
	}

	async mkdir(path: string, options?: MkdirOptions): Promise<void> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			return
		}
		const routed = this.route(path)
		await routed.fs.mkdir(routed.path, options)
	}

	async readdir(path: string): Promise<string[]> {
		if (this.isRoot(path)) {
			const base = await this.scratch.readdir('/')
			return [...new Set(['vault', ...base])].sort()
		}
		if (this.isVaultMount(path)) {
			return this.vaultFs.readdir('/')
		}
		const routed = this.route(path)
		return routed.fs.readdir(routed.path)
	}

	async readdirWithFileTypes(path: string) {
		if (this.isRoot(path)) {
			const base = this.scratch.readdirWithFileTypes
				? await this.scratch.readdirWithFileTypes('/')
				: (await this.scratch.readdir('/')).map((name) => ({
						name,
						isFile: true,
						isDirectory: false,
						isSymbolicLink: false,
					}))
			return [
				{
					name: 'vault',
					isFile: false,
					isDirectory: true,
					isSymbolicLink: false,
				},
				...base.filter((entry) => entry.name !== 'vault'),
			].sort((left, right) => left.name.localeCompare(right.name))
		}
		if (this.isVaultMount(path)) {
			return this.vaultFs.readdirWithFileTypes?.('/') ?? []
		}
		const routed = this.route(path)
		return routed.fs.readdirWithFileTypes?.(routed.path) ?? []
	}

	async rm(path: string, options?: RmOptions): Promise<void> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			throw new Error(`EPERM: operation not permitted, remove '${path}'`)
		}
		const routed = this.route(path)
		return routed.fs.rm(routed.path, options)
	}

	async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
		await this.genericCp(src, dest, options)
	}

	async mv(src: string, dest: string): Promise<void> {
		if (this.isRoot(src) || this.isVaultMount(src)) {
			throw new Error(`EPERM: operation not permitted, move '${src}'`)
		}
		const source = this.route(src)
		const target = this.route(dest)
		if (source.fs === target.fs) {
			await source.fs.mv(source.path, target.path)
			return
		}
		await this.genericCp(src, dest, { recursive: true })
		await removeRecursive(this, src, { recursive: true, force: false })
	}

	resolvePath(base: string, path: string): string {
		return ensureNotEscapingRoot(pathPosix.resolve(base || '/', path))
	}

	getAllPaths(): string[] {
		const basePaths = this.scratch.getAllPaths().filter((path) => path !== '/')
		const vaultPaths = this.vaultFs
			.getAllPaths()
			.filter((path) => path !== '/')
			.map((path) => `${VAULT_MOUNT_POINT}${path}`)
		return ['/', VAULT_MOUNT_POINT, ...basePaths, ...vaultPaths].sort()
	}

	async chmod(path: string, mode: number): Promise<void> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			return
		}
		const routed = this.route(path)
		await routed.fs.chmod(routed.path, mode)
	}

	async symlink(target: string, linkPath: string): Promise<void> {
		if (this.isVaultPath(linkPath) || this.isVaultPath(target)) {
			throw new Error(
				`ENOTSUP: symbolic links are not supported in vault fs, link '${linkPath}'`,
			)
		}
		return this.scratch.symlink(target, linkPath)
	}

	async link(existingPath: string, newPath: string): Promise<void> {
		if (this.isVaultPath(existingPath) || this.isVaultPath(newPath)) {
			throw new Error(
				`ENOTSUP: hard links are not supported in vault fs, link '${newPath}'`,
			)
		}
		return this.scratch.link(existingPath, newPath)
	}

	async readlink(path: string): Promise<string> {
		if (this.isVaultPath(path)) {
			throw new Error(`EINVAL: not a symbolic link, readlink '${path}'`)
		}
		return this.scratch.readlink(path)
	}

	async lstat(path: string): Promise<FsStat> {
		return this.stat(path)
	}

	async realpath(path: string): Promise<string> {
		await this.stat(path)
		return ensureNotEscapingRoot(path)
	}

	async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
		if (this.isRoot(path) || this.isVaultMount(path)) {
			return
		}
		const routed = this.route(path)
		await routed.fs.utimes(routed.path, atime, mtime)
	}
}

export { VAULT_MOUNT_POINT }
