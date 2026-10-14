// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { AppRuntime, runtimeDocument } from './runtime'
import { validateAppIcon, appIconContent } from './icon'
import type { AppRevision } from './domain'

const revision: AppRevision = {
	schemaVersion: 1,
	id: 'revision-neutral',
	parentRevisionId: null,
	createdAt: 1,
	evidence: [],
	code: {
		title: '中性计数器 Neutral counter 🌿',
		iconSvg:
			'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>',
		html: '<button id="add">增加 Add 🌿</button>',
		css: '',
		javascript: '',
		dataVersion: 1,
		assets: [],
		sourceRefs: [],
	},
}

describe('App runtime and trusted SVG boundary', () => {
	it('updates streamed presentation only from its parent channel and sanitizes every update', async () => {
		const dom = new JSDOM(runtimeDocument(revision, 'neutralpreview'), {
			runScripts: 'dangerously',
		})
		const send = (
			channel: string,
			html: string,
			source: Window = dom.window as unknown as Window,
		) =>
			dom.window.dispatchEvent(
				new dom.window.MessageEvent('message', {
					source,
					data: {
						channel,
						event: 'presentation',
						html,
						css: 'button { color: green; }',
					},
				}),
			)
		const html =
			'<button id="updated" onclick="window.bad = 1">更新 Updated 中文 🌿</button><script>window.bad = 1</script><iframe srcdoc="active"></iframe>'
		send('other', html)
		send('neutralpreview', html, window)
		expect(dom.window.document.querySelector('#updated')).toBeNull()
		send('neutralpreview', html)
		expect(dom.window.document.querySelector('#updated')?.textContent).toBe(
			'更新 Updated 中文 🌿',
		)
		expect(
			dom.window.document.querySelector('#updated')?.hasAttribute('onclick'),
		).toBe(false)
		expect(dom.window.document.querySelector('iframe, script')).toBeNull()
		expect(dom.window.document.head.lastElementChild?.textContent).toBe(
			'button { color: green; }',
		)
		expect((dom.window as unknown as { bad?: number }).bad).toBeUndefined()
		const button = dom.window.document.querySelector('#updated')
		send('neutralpreview', html)
		expect(dom.window.document.querySelector('#updated')).toBe(button)
		dom.window.close()
		await Promise.resolve()
	})
	it('accepts geometry and rejects active SVG before entering host DOM', () => {
		expect(
			appIconContent(validateAppIcon(revision.code.iconSvg, document)),
		).toContain('circle')
		for (const svg of [
			'<svg viewBox="0 0 100 100"><script>1</script></svg>',
			'<svg viewBox="0 0 100 100"><path onload="1"/></svg>',
			'<svg viewBox="0 0 100 100"><image href="https://example.test/image"/></svg>',
			'<svg viewBox="0 0 100 100"><path fill="url(#x)"/></svg>',
			'<svg viewBox="0 0 100 100"><foreignObject/></svg>',
		])
			expect(() => validateAppIcon(svg, document)).toThrow()
	})
	it('authenticates source and instance channel, validates data and revokes on close', async () => {
		Object.defineProperty(document, 'win', {
			configurable: true,
			value: {
				// eslint-disable-next-line obsidianmd/prefer-create-el -- Mock Obsidian's DOM factory using the underlying browser API.
				createEl: (tag: string) => document.createElement(tag),
			},
		})
		const host = {
			readKV: vi.fn(async () => ({ '进度 Progress 🌿': 1 })),
			transact: vi.fn(async () => {}),
			openSource: vi.fn(async () => {}),
			error: vi.fn(),
		}
		const runtime = new AppRuntime(document.body, revision, host)
		const channel = runtime.frame.srcdoc.match(/"channel":"([^"]+)"/)![1]
		const send = (data: unknown, source = runtime.frame.contentWindow) =>
			window.dispatchEvent(new MessageEvent('message', { source, data }))
		send({
			channel: 'other',
			id: 1,
			method: 'kv.get',
			args: ['进度 Progress 🌿'],
		})
		send(
			{ channel, id: 1, method: 'kv.get', args: ['进度 Progress 🌿'] },
			window,
		)
		expect(host.readKV).not.toHaveBeenCalled()
		send({
			channel,
			id: 2,
			method: 'kv.transact',
			args: [[{ key: '进度 Progress 🌿', value: 2 }]],
		})
		await Promise.resolve()
		expect(host.transact).toHaveBeenCalledWith([
			{ key: '进度 Progress 🌿', value: 2 },
		])
		send({
			channel,
			id: 3,
			method: 'kv.transact',
			args: [[{ key: '__proto__', value: 2 }]],
		})
		await Promise.resolve()
		expect(host.transact).toHaveBeenCalledTimes(1)
		send({ channel, event: 'ready' })
		await runtime.ready
		const frame = runtime.frame.contentWindow
		runtime.destroy()
		send(
			{
				channel,
				id: 4,
				method: 'kv.transact',
				args: [[{ key: '进度 Progress 🌿', value: 3 }]],
			},
			frame,
		)
		expect(host.transact).toHaveBeenCalledTimes(1)
		expect(runtime.frame.getAttribute('sandbox')).toBe('allow-scripts')
	})
	it('executes Unicode source and working controls without srcdoc/script breakout', async () => {
		const messages: Record<string, unknown>[] = []
		const code = {
			...revision,
			code: {
				...revision.code,
				html: '<button id="add" onclick="bad()">增加 Add 🌿</button><script>window.bad = 1</script>',
				javascript:
					'const marker = "</script>中文 Unicode 🌿"; document.querySelector("#add").addEventListener("click", () => app.kv.set("进度 Progress 🌿", marker));',
			},
		}
		const dom = new JSDOM(runtimeDocument(code, 'neutral'), {
			runScripts: 'dangerously',
			beforeParse(win) {
				win.postMessage = (message: Record<string, unknown>) => {
					messages.push(message)
					if (message.id)
						win.dispatchEvent(
							new win.MessageEvent('message', {
								source: win as unknown as Window,
								data: { channel: 'neutral', id: message.id, value: null },
							}),
						)
				}
			},
		})
		await new Promise((resolve) => window.setTimeout(resolve, 20))
		expect(messages.some((message) => message.event === 'ready')).toBe(true)
		expect((dom.window as unknown as { bad?: number }).bad).toBeUndefined()
		expect(
			dom.window.document.querySelector('#add')!.hasAttribute('onclick'),
		).toBe(false)
		;(dom.window.document.querySelector('#add') as HTMLButtonElement).click()
		expect(
			messages.find((message) => message.method === 'kv.transact')?.args,
		).toEqual([
			[{ key: '进度 Progress 🌿', value: '</script>中文 Unicode 🌿' }],
		])
		dom.window.close()
	})
})
