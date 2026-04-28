import { describe, expect, it, vi } from 'vitest'
import { obsidianFetch } from './obsidian-fetch'

const { requestUrl } = vi.hoisted(() => ({
	requestUrl: vi.fn(),
}))

vi.mock('~/utils/request-url', () => ({
	default: requestUrl,
}))

describe('obsidianFetch', () => {
	it('routes requests through requestUrl and returns a Response', async () => {
		requestUrl.mockResolvedValueOnce({
			status: 200,
			headers: {
				'content-type': 'application/json',
			},
			arrayBuffer: new TextEncoder().encode('{"ok":true}').buffer,
			text: '{"ok":true}',
			json: { ok: true },
		})

		const response = await obsidianFetch(
			'https://example.com/v1/chat/completions',
			{
				method: 'POST',
				headers: {
					authorization: 'Bearer key',
				},
				body: JSON.stringify({ hello: 'world' }),
			},
		)

		expect(requestUrl).toHaveBeenCalledWith({
			url: 'https://example.com/v1/chat/completions',
			method: 'POST',
			headers: {
				authorization: 'Bearer key',
			},
			body: expect.any(ArrayBuffer),
			throw: false,
		})
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ ok: true })
	})
})
