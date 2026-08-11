import { describe, expect, it } from 'vitest'
import { Bash } from 'just-bash/browser'
import { gunzipSync, gzipSync } from '~/shims/node-zlib'

const content = 'English text 与中文内容\nSecond neutral line 第二行\n'

function createBash() {
	return new Bash({
		cwd: '/',
		files: {
			'/sample.txt': content,
		},
	})
}

describe('browser zlib shim', () => {
	it('round-trips bilingual text through the shim', () => {
		const input = new TextEncoder().encode(content)

		expect(new TextDecoder().decode(gunzipSync(gzipSync(input)))).toBe(content)
	})

	it('runs gzip and gunzip with bilingual text', async () => {
		const bash = createBash()

		const result = await bash.exec('gzip -c sample.txt | gunzip -c')

		expect(result).toMatchObject({
			stdout: content,
			stderr: '',
			exitCode: 0,
		})
	})

	it('runs zcat on a gzip file with bilingual text', async () => {
		const bash = createBash()

		const compressed = await bash.exec('gzip -c sample.txt > sample.txt.gz')
		const result = await bash.exec('zcat sample.txt.gz')

		expect(compressed).toMatchObject({ stderr: '', exitCode: 0 })
		expect(result).toMatchObject({
			stdout: content,
			stderr: '',
			exitCode: 0,
		})
	})

	it('enforces the decompression output limit', () => {
		const input = new TextEncoder().encode(content)
		const compressed = gzipSync(input)

		expect(() => gunzipSync(compressed, { maxOutputLength: 1 })).toThrow(
			'exceeds',
		)
	})
})
