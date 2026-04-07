import { describe, expect, it } from 'vitest'
import { createProviderDraft, sanitizeProviders } from './config'

describe('ai config', () => {
	it('creates an openai provider draft', () => {
		const draft = createProviderDraft()

		expect(draft.type).toBe('openai')
		expect(draft.models).toEqual([])
	})

	it('normalizes provider objects to typed openai configs', () => {
		const providers = sanitizeProviders([
			{
				id: 'provider-1',
				name: ' Provider ',
				type: 'openai',
				apiKey: 'key',
				baseUrl: ' https://example.com/v1 ',
				models: [{ id: 'model-1', name: ' gpt-4.1 ' }],
			},
		])

		expect(providers).toEqual([
			{
				id: 'provider-1',
				name: 'Provider',
				type: 'openai',
				apiKey: 'key',
				baseUrl: 'https://example.com/v1',
				organization: undefined,
				project: undefined,
				models: [{ id: 'model-1', name: 'gpt-4.1' }],
			},
		])
	})
})
