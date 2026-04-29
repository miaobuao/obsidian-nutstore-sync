import { createOpenAI } from '@ai-sdk/openai'
import { simulateStreamingMiddleware, wrapLanguageModel } from 'ai'
import { obsidianFetch } from '~/ai/transport/obsidian-fetch'
import type { AIProviderConfig } from '~/ai/types'
import i18n from '~/i18n'
import type { AIProviderResolver } from './types'

function assertProviderUsable(provider: AIProviderConfig) {
	if (!provider.apiKey.trim()) {
		throw new Error(i18n.t('chatbox.errors.apiKeyRequired'))
	}
}

export const openAIProviderResolver: AIProviderResolver = {
	assertUsable: assertProviderUsable,
	createLanguageModel(provider, modelId) {
		assertProviderUsable(provider)
		const factory = createOpenAI({
			name: provider.name || 'openai',
			baseURL: provider.api,
			apiKey: provider.apiKey,
			fetch: obsidianFetch,
		})

		return {
			model: wrapLanguageModel({
				model: factory.chat(modelId),
				middleware: [simulateStreamingMiddleware()],
			}),
			providerName: provider.name || 'OpenAI',
		}
	},
}
