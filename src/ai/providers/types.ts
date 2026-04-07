import type { AIProviderConfig } from '~/ai/types'

export interface ResolvedLanguageModel {
	model: unknown
	providerName: string
}

export interface AIProviderResolver<TConfig extends AIProviderConfig = AIProviderConfig> {
	type: TConfig['type']
	assertUsable: (provider: TConfig) => void
	createLanguageModel: (provider: TConfig, modelId: string) => ResolvedLanguageModel
}
