import type { AIProviderConfig } from '~/ai/types'
import { openAIProviderResolver } from './openai'

export function getProviderResolver(_provider: AIProviderConfig) {
	return openAIProviderResolver
}
