import { describe, expect, it } from 'vitest'
import type NutstorePlugin from '..'
import ChatboxView from './chatbox.view'

describe('ChatboxView startup', () => {
	it('mounts before session restoration completes', async () => {
		let releaseSession: (() => void) | undefined
		const sessionBlocked = new Promise<void>((resolve) => {
			releaseSession = resolve
		})
		const rootEl = {
			onWindowMigrated: () => () => undefined,
		} as unknown as HTMLDivElement
		const contentEl = {
			empty: () => undefined,
			createDiv: () => rootEl,
		} as unknown as HTMLElement
		const plugin = {
			chatService: {
				setChatModalHost: () => undefined,
				ensureSession: () => sessionBlocked,
			},
		} as unknown as NutstorePlugin
		const view = Object.create(ChatboxView.prototype) as ChatboxView
		let mounts = 0
		Object.defineProperties(view, {
			contentEl: { value: contentEl },
			plugin: { value: plugin },
			captureActiveContextSnapshot: { value: () => undefined },
			remountChatbox: {
				value: () => {
					mounts += 1
				},
			},
		})

		const opening = view.onOpen()
		await Promise.resolve()
		try {
			expect(mounts).toBe(1)
		} finally {
			releaseSession?.()
		}
		await opening
	})
})
