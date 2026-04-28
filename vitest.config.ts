import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'test/mocks/obsidian.ts'),
			'~': resolve(__dirname, 'src'),
		},
	},
	test: {
		environment: 'node',
	},
})
