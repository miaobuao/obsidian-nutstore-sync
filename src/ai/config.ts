import {
	AIModelConfig,
	AIProviderConfig,
	AIProviderType,
	OpenAIProviderConfig,
} from './types'
import createId from '~/utils/create-id'

function normalizeModel(model: Partial<AIModelConfig>): AIModelConfig | null {
	return {
		id: model.id?.trim() || createId('model'),
		name: model.name?.trim() || '',
	}
}

function normalizeOpenAIProvider(
	provider: Partial<OpenAIProviderConfig>,
): OpenAIProviderConfig | null {
	const models = (provider.models || [])
		.map((model) => normalizeModel(model))
		.filter((model): model is AIModelConfig => !!model)

	return {
		id: provider.id?.trim() || createId('provider'),
		name: provider.name?.trim() || '',
		type: 'openai',
		apiKey: provider.apiKey || '',
		baseUrl: provider.baseUrl?.trim() || undefined,
		organization: provider.organization?.trim() || undefined,
		project: provider.project?.trim() || undefined,
		models,
	}
}

export function normalizeProviderType(
	value?: string,
): AIProviderType {
	return value === 'openai' ? value : 'openai'
}

function normalizeProvider(
	provider: Partial<AIProviderConfig>,
): AIProviderConfig | null {
	switch (normalizeProviderType(typeof provider.type === 'string' ? provider.type : undefined)) {
		case 'openai':
			return normalizeOpenAIProvider(provider)
	}
}

export function sanitizeProviders(
	providers: Partial<AIProviderConfig>[] | undefined,
): AIProviderConfig[] {
	return (providers || [])
		.map((provider) => normalizeProvider(provider))
		.filter((provider): provider is AIProviderConfig => !!provider)
}

export function sanitizeDefaultSelections(
	providers: AIProviderConfig[],
	defaultProviderId?: string,
	defaultModelId?: string,
) {
	const provider = providers.find((item) => item.id === defaultProviderId)
	const model = provider?.models.find((item) => item.id === defaultModelId)

	return {
		defaultProviderId: provider?.id,
		defaultModelId: model?.id,
	}
}

export function resolveInitialSelection(
	providers: AIProviderConfig[],
	defaultProviderId?: string,
	defaultModelId?: string,
) {
	const defaults = sanitizeDefaultSelections(
		providers,
		defaultProviderId,
		defaultModelId,
	)
	return {
		providerId: defaults.defaultProviderId,
		modelId: defaults.defaultModelId,
	}
}

export function createProviderDraft(type: AIProviderType = 'openai'): AIProviderConfig {
	const providerId = createId('provider')
	switch (type) {
		case 'openai':
			return {
				id: providerId,
				name: 'New OpenAI Provider',
				type: 'openai',
				apiKey: '',
				baseUrl: undefined,
				organization: undefined,
				project: undefined,
				models: [],
			}
	}
}

export function createModelDraft(): AIModelConfig {
	return {
		id: createId('model'),
		name: 'new-model',
	}
}

export function getProviderById(
	providers: AIProviderConfig[],
	providerId?: string,
) {
	return providerId ? providers.find((item) => item.id === providerId) : undefined
}

export function getModelById(provider: AIProviderConfig | undefined, modelId?: string) {
	return modelId ? provider?.models.find((item) => item.id === modelId) : undefined
}
