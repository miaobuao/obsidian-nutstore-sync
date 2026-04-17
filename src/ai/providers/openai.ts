import { createOpenAI } from '@ai-sdk/openai'
import { obsidianFetch } from '~/ai/transport/obsidian-fetch'
import type { OpenAIProviderConfig } from '~/ai/types'
import i18n from '~/i18n'
import type { AIProviderResolver } from './types'

function assertOpenAIProviderUsable(provider: OpenAIProviderConfig) {
	if (!provider.apiKey.trim()) {
		throw new Error(i18n.t('chatbox.errors.apiKeyRequired'))
	}
}

export const openAIProviderResolver: AIProviderResolver<OpenAIProviderConfig> =
	{
		type: 'openai-chat',
		assertUsable: assertOpenAIProviderUsable,
		createLanguageModel(provider, modelId) {
			assertOpenAIProviderUsable(provider)
			const factory = createOpenAI({
				name: provider.name || 'openai',
				baseURL: provider.baseUrl,
				apiKey: provider.apiKey,
				organization: provider.organization,
				project: provider.project,
				fetch: obsidianFetch,
			})

			return {
				model: factory.chat(modelId),
				providerName: provider.name || 'OpenAI',
			}
		},
	}
