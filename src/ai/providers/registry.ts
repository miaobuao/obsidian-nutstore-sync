import type { AIProviderConfig } from '~/ai/types'
import { openAIProviderResolver } from './openai'

const providerResolvers = {
	'openai-chat': openAIProviderResolver,
} as const

export function getProviderResolver(provider: AIProviderConfig) {
	return providerResolvers[provider.type]
}
