import { z } from 'zod/mini'
import createId from '~/utils/create-id'
import {
	changeKV,
	jsonValue,
	validateKey,
	type AppRevision,
	type AppKV,
	type JsonValue,
	type KVChange,
} from './domain'

export interface AppRuntimeAPI {
	kv: {
		get(key: string): Promise<JsonValue | null>
		list(): Promise<string[]>
		set(key: string, value: JsonValue): Promise<void>
		delete(key: string): Promise<void>
		transact(changes: KVChange[]): Promise<void>
	}
	assets: { get(name: string): Promise<string> }
	sources: { open(ref: string): Promise<void> }
}
const requestSchema = z.object({
	channel: z.string(),
	id: z.number().check(z.int(), z.minimum(1)),
	method: z.enum([
		'kv.get',
		'kv.list',
		'kv.transact',
		'assets.get',
		'sources.open',
	]),
	args: z.array(z.unknown()).check(z.maxLength(2)),
})
export interface RuntimeHost {
	readKV(): Promise<AppKV>
	transact(changes: KVChange[]): Promise<void>
	openSource(ref: string): Promise<void>
	error(message: string): void
}

/** This function is serialized into srcdoc. Keep it self-contained and browser-only. */
/* eslint-disable obsidianmd/prefer-create-el -- Serialized sandbox code runs in a standard browser document without Obsidian DOM extensions. */
function bootstrap(payload: {
	channel: string
	nonce: string
	html: string
	css: string
	javascript: string
	theme: Record<string, string>
}) {
	let nextId = 0
	const pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void }
	>()
	const send = (message: Record<string, unknown>) =>
		parent.postMessage({ ...message, channel: payload.channel }, '*')
	const rpc = (method: string, ...args: unknown[]): Promise<unknown> =>
		new Promise((resolve, reject) => {
			if (pending.size >= 100) {
				reject(new Error('Too many pending App requests'))
				return
			}
			const id = ++nextId
			pending.set(id, { resolve, reject })
			send({ id, method, args })
		})
	window.addEventListener('message', (event: MessageEvent<unknown>) => {
		if (
			event.source !== parent ||
			!event.data ||
			typeof event.data !== 'object'
		)
			return
		const data = event.data as {
			channel?: unknown
			id?: unknown
			error?: unknown
			value?: unknown
			event?: unknown
			html?: unknown
			css?: unknown
		}
		if (data.channel !== payload.channel) return
		if (
			data.event === 'presentation' &&
			typeof data.html === 'string' &&
			typeof data.css === 'string'
		) {
			present(data.html, data.css)
			return
		}
		if (typeof data.id !== 'number') return
		const reply = pending.get(data.id)
		if (!reply) return
		pending.delete(data.id)
		if (typeof data.error === 'string') reply.reject(new Error(data.error))
		else reply.resolve(data.value)
	})
	const report = (message: string) =>
		send({ event: 'error', message: message.slice(0, 3000) })
	window.addEventListener('error', (event) => report(event.message))
	window.addEventListener('unhandledrejection', (event) =>
		report(String(event.reason)),
	)
	const api: AppRuntimeAPI = {
		kv: {
			get: (key) => rpc('kv.get', key) as Promise<JsonValue | null>,
			list: () => rpc('kv.list') as Promise<string[]>,
			set: (key, value) =>
				rpc('kv.transact', [{ key, value }]) as Promise<void>,
			delete: (key) =>
				rpc('kv.transact', [{ key, delete: true }]) as Promise<void>,
			transact: (changes) => rpc('kv.transact', changes) as Promise<void>,
		},
		assets: { get: (name) => rpc('assets.get', name) as Promise<string> },
		sources: { open: (ref) => rpc('sources.open', ref) as Promise<void> },
	}
	Object.defineProperty(window, 'app', {
		value: Object.freeze(api),
		writable: false,
	})
	Object.defineProperty(window, '__appStarted', {
		value: () => send({ event: 'ready' }),
		writable: false,
	})
	for (const [key, value] of Object.entries(payload.theme))
		document.documentElement.style.setProperty(key, value)
	// eslint-disable-next-line obsidianmd/no-forbidden-elements -- The sandbox owns its generated stylesheet.
	const style = document.createElement('style')
	document.head.append(style)
	let presentedHTML: string | undefined
	const present = (html: string, css: string) => {
		style.textContent = css
		// Style streaming must retain the visible DOM and its scroll position.
		if (html === presentedHTML) return
		presentedHTML = html
		const template = document.createElement('template')
		// eslint-disable-next-line no-unsanitized/property, @microsoft/sdl/no-inner-html -- Model markup is parsed only inside the opaque-origin sandbox, never the Obsidian host DOM.
		template.innerHTML = html
		// The host owns scripts, CSP and document structure. URL-bearing markup cannot navigate or embed another document.
		for (const el of Array.from(template.content.querySelectorAll('*'))) {
			if (
				[
					'script',
					'iframe',
					'object',
					'embed',
					'base',
					'meta',
					'link',
					'style',
				].includes(el.localName)
			) {
				el.remove()
				continue
			}
			for (const attr of Array.from(el.attributes)) {
				if (
					/^on/i.test(attr.name) ||
					[
						'srcdoc',
						'action',
						'formaction',
						'target',
						'nonce',
						'srcset',
						'ping',
					].includes(attr.name)
				)
					el.removeAttribute(attr.name)
				if (
					['href', 'xlink:href', 'src'].includes(attr.name) &&
					!/^#|^data:image\/(png|jpeg|webp|gif);base64,/.test(attr.value)
				)
					el.removeAttribute(attr.name)
			}
		}
		document.body.replaceChildren(template.content)
	}
	present(payload.html, payload.css)
	const script = document.createElement('script')
	script.nonce = payload.nonce
	script.textContent = `(async () => {\n${payload.javascript}\n})().then(window.__appStarted).catch(error => { throw error; });`
	document.body.append(script)
}
/* eslint-enable obsidianmd/prefer-create-el -- Host code below runs with Obsidian DOM extensions. */

export function runtimeDocument(
	revision: AppRevision,
	channel: string,
	theme: Record<string, string> = {},
) {
	if (!/^[a-zA-Z0-9]+$/.test(channel))
		throw new Error('Invalid App runtime identity')
	const payload = JSON.stringify({
		channel,
		nonce: channel,
		...revision.code,
		theme,
	}).replace(/</g, '\\u003c')
	const policy = `default-src 'none'; script-src 'nonce-${channel}'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html{color-scheme:light dark}body{margin:0;padding:16px;color:var(--text-normal);background:var(--background-primary);font-family:system-ui,sans-serif}*{box-sizing:border-box}button,input,textarea,select{font:inherit}img,canvas,svg{max-width:100%}</style></head><body><script nonce="${channel}">(${bootstrap.toString()})(${payload});</script></body></html>`
}

/** Each mount owns a revocable capability. A sandbox's opaque origin is authenticated by source + instance channel. */
export class AppRuntime {
	readonly frame: HTMLIFrameElement
	readonly ready: Promise<void>
	private destroyed = false
	private presentationSignature = ''
	private settled = false
	private errors = 0
	private requestCount = 0
	private requestWindow = Date.now()
	private resolve!: () => void
	private reject!: (error: Error) => void
	private readonly channel = createId('runtime').replaceAll('-', '')
	private readonly win: Window
	private readonly timer: number
	constructor(
		container: HTMLElement,
		readonly revision: AppRevision,
		private readonly host: RuntimeHost,
	) {
		const doc = container.ownerDocument
		this.win = doc.defaultView!
		this.frame = doc.win.createEl('iframe')
		this.frame.className = 'ns-app-runtime'
		this.frame.title = revision.code.title
		this.frame.setAttribute('sandbox', 'allow-scripts')
		this.frame.setAttribute('referrerpolicy', 'no-referrer')
		this.ready = new Promise((resolve, reject) => {
			this.resolve = resolve
			this.reject = reject
		})
		// Subscribe before srcdoc executes; all asynchronous errors are observed even during teardown.
		void this.ready.catch(() => {})
		this.win.addEventListener('message', this.receive)
		const computed = this.win.getComputedStyle(container)
		const theme = Object.fromEntries(
			[
				'--text-normal',
				'--text-muted',
				'--background-primary',
				'--background-secondary',
				'--interactive-accent',
			].map((key) => [key, computed.getPropertyValue(key)]),
		)
		this.frame.srcdoc = runtimeDocument(revision, this.channel, theme)
		container.append(this.frame)
		this.timer = this.win.setTimeout(
			() => this.fail('App startup timed out'),
			8000,
		)
	}
	private fail(message: string) {
		if (this.destroyed || this.errors++ >= 10) return
		this.host.error(message)
		if (!this.settled) {
			this.settled = true
			this.win.clearTimeout(this.timer)
			this.reject(new Error(message))
		}
	}
	private receive = (event: MessageEvent<unknown>) => {
		if (
			this.destroyed ||
			event.source !== this.frame.contentWindow ||
			!event.data ||
			typeof event.data !== 'object'
		)
			return
		const data = event.data as Record<string, unknown>
		if (data.channel !== this.channel) return
		if (data.event === 'error') {
			this.fail(String(data.message).slice(0, 3000))
			return
		}
		if (data.event === 'ready') {
			if (!this.settled) {
				this.settled = true
				this.win.clearTimeout(this.timer)
				this.resolve()
			}
			return
		}
		const parsed = requestSchema.safeParse(data)
		if (!parsed.success) return
		const request = parsed.data
		if (Date.now() - this.requestWindow > 1000) {
			this.requestWindow = Date.now()
			this.requestCount = 0
		}
		const execute = async () => {
			if (++this.requestCount > 60) throw new Error('App request rate exceeded')
			switch (request.method) {
				case 'kv.get': {
					if (request.args.length !== 1) throw new Error('Invalid App request')
					const key = request.args[0]
					validateKey(key)
					return (await this.host.readKV())[key] ?? null
				}
				case 'kv.list':
					return Object.keys(await this.host.readKV())
				case 'kv.transact': {
					const input = request.args[0]
					if (request.args.length !== 1 || !Array.isArray(input))
						throw new Error('Invalid App transaction')
					const changes = input.map((item: unknown) => {
						if (!item || typeof item !== 'object')
							throw new Error('Invalid App transaction')
						const change = item as Record<string, unknown>
						validateKey(change.key)
						if (change.delete === true) return { key: change.key, delete: true }
						return { key: change.key, value: jsonValue(change.value) }
					})
					changeKV({}, changes)
					if (this.destroyed) throw new Error('App closed')
					await this.host.transact(changes)
					return null
				}
				case 'assets.get': {
					const asset = this.revision.code.assets.find(
						(item) => item.name === request.args[0],
					)
					if (!asset) throw new Error('Unknown App resource')
					return asset.dataUrl
				}
				case 'sources.open': {
					const ref = request.args[0]
					if (
						typeof ref !== 'string' ||
						!this.revision.code.sourceRefs.includes(ref)
					)
						throw new Error('Unknown App source')
					if (this.destroyed) throw new Error('App closed')
					await this.host.openSource(ref)
					return null
				}
			}
		}
		void execute().then(
			(value) => {
				if (!this.destroyed)
					this.frame.contentWindow?.postMessage(
						{ channel: this.channel, id: request.id, value },
						'*',
					)
			},
			(error: unknown) => {
				if (!this.destroyed)
					this.frame.contentWindow?.postMessage(
						{
							channel: this.channel,
							id: request.id,
							error: error instanceof Error ? error.message : String(error),
						},
						'*',
					)
			},
		)
	}
	/** Streamed markup uses the same sanitizer and sandbox without executing partial JavaScript. */
	updatePresentation(html: string, css: string) {
		if (this.destroyed) return
		const signature = JSON.stringify([html, css])
		if (signature === this.presentationSignature) return
		this.presentationSignature = signature
		this.frame.contentWindow?.postMessage(
			{ channel: this.channel, event: 'presentation', html, css },
			'*',
		)
	}
	destroy() {
		if (this.destroyed) return
		this.destroyed = true
		this.win.clearTimeout(this.timer)
		this.win.removeEventListener('message', this.receive)
		this.frame.remove()
		if (!this.settled) {
			this.settled = true
			this.reject(new Error('App closed'))
		}
	}
}
