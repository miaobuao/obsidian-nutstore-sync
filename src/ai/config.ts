import createId from '~/utils/create-id'
import {
	AIModelConfig,
	AIProviderConfig,
	AIProviderType,
	OpenAIProviderConfig,
} from './types'

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
		type: 'openai-chat',
		apiKey: provider.apiKey || '',
		baseUrl: provider.baseUrl?.trim() || undefined,
		organization: provider.organization?.trim() || undefined,
		project: provider.project?.trim() || undefined,
		models,
	}
}

export function normalizeProviderType(value?: string): AIProviderType {
	if (value === 'openai') return 'openai-chat'
	return value === 'openai-chat' ? value : 'openai-chat'
}

function normalizeProvider(
	provider: Partial<AIProviderConfig>,
): AIProviderConfig | null {
	switch (
		normalizeProviderType(
			typeof provider.type === 'string' ? provider.type : undefined,
		)
	) {
		case 'openai-chat':
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
	defaultModel?: { providerId: string; modelId: string },
): { providerId: string; modelId: string } | undefined {
	if (!defaultModel) return undefined
	const provider = providers.find((item) => item.id === defaultModel.providerId)
	const model = provider?.models.find(
		(item) => item.id === defaultModel.modelId,
	)
	if (!provider || !model) return undefined
	return { providerId: provider.id, modelId: model.id }
}

export function resolveInitialSelection(
	providers: AIProviderConfig[],
	defaultModel?: { providerId: string; modelId: string },
) {
	const validated = sanitizeDefaultSelections(providers, defaultModel)
	return {
		providerId: validated?.providerId,
		modelId: validated?.modelId,
	}
}

export function createProviderDraft(
	type: AIProviderType = 'openai-chat',
): AIProviderConfig {
	const providerId = createId('provider')
	switch (type) {
		case 'openai-chat':
			return {
				id: providerId,
				name: 'Provider',
				type: 'openai-chat',
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
	return providerId
		? providers.find((item) => item.id === providerId)
		: undefined
}

export function getModelById(
	provider: AIProviderConfig | undefined,
	modelId?: string,
) {
	return modelId
		? provider?.models.find((item) => item.id === modelId)
		: undefined
}
