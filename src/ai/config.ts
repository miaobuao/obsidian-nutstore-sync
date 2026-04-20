import createId from '~/utils/create-id'
import { z } from 'zod'
import {
	AIModelConfig,
	AIProviderConfig,
	AIProviderInput,
	AIProviderType,
	aiProviderInputSchema,
	AIModelInput,
	OpenAIProviderInput,
	OpenAIProviderConfig,
} from './types'

function formatSchemaIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
			return `${path}: ${issue.message}`
		})
		.join('; ')
}

function normalizeModel(model: AIModelInput): AIModelConfig {
	return {
		id: model.id?.trim() || createId('model'),
		name: model.name?.trim() || '',
	}
}

function normalizeOpenAIProvider(
	provider: OpenAIProviderInput,
): OpenAIProviderConfig {
	const models = (provider.models || []).map((model) => normalizeModel(model))

	return {
		id: provider.id?.trim() || createId('provider'),
		name: provider.name?.trim() || '',
		type: provider.type,
		apiKey: provider.apiKey || '',
		baseUrl: provider.baseUrl?.trim() || undefined,
		organization: provider.organization?.trim() || undefined,
		project: provider.project?.trim() || undefined,
		models,
	}
}

function normalizeProvider(
	provider: Partial<AIProviderConfig>,
	index: number,
): AIProviderConfig {
	const parsed = aiProviderInputSchema.safeParse(provider)
	if (!parsed.success) {
		throw new Error(
			`Invalid AI provider at index ${index}: ${formatSchemaIssues(parsed.error)}`,
		)
	}

	const typedProvider: AIProviderInput = parsed.data
	switch (typedProvider.type) {
		case 'openai-chat':
			return normalizeOpenAIProvider(typedProvider)
	}
}

export function sanitizeProviders(
	providers: Partial<AIProviderConfig>[] | undefined,
): AIProviderConfig[] {
	return (providers || []).map((provider, index) =>
		normalizeProvider(provider, index),
	)
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
