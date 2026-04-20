import type {
	ChatMessage as DomainChatMessage,
	ChatMessageContentPart as DomainChatMessageContentPart,
	ChatMessageMeta as DomainChatMessageMeta,
	ChatMessageRecord as DomainChatMessageRecord,
	ChatSession as DomainChatSession,
	ChatTaskRecord as DomainChatTaskRecord,
	ChatToolCall as DomainChatToolCall,
	ChatUsage as DomainChatUsage,
} from '~/chat/domain'
import { z } from 'zod'

export const openAIChatProviderTypeSchema = z.literal('openai-chat')
export type OpenAIChatProviderType = z.infer<typeof openAIChatProviderTypeSchema>
export type AIProviderType = OpenAIChatProviderType

export const aiModelConfigSchema = z.object({
	id: z.string(),
	name: z.string(),
})
export const aiModelInputSchema = aiModelConfigSchema.partial()
export type AIModelConfig = z.infer<typeof aiModelConfigSchema>
export type AIModelInput = z.infer<typeof aiModelInputSchema>

export const openAIProviderConfigSchema = z.object({
	id: z.string(),
	name: z.string(),
	models: z.array(aiModelConfigSchema),
	type: openAIChatProviderTypeSchema,
	apiKey: z.string(),
	baseUrl: z.string().optional(),
	organization: z.string().optional(),
	project: z.string().optional(),
})
export const openAIProviderInputSchema = openAIProviderConfigSchema
	.partial()
	.extend({
		type: openAIChatProviderTypeSchema,
		models: z.array(aiModelInputSchema).optional(),
	})
export const aiProviderConfigSchema = z.discriminatedUnion('type', [
	openAIProviderConfigSchema,
])
export const aiProviderInputSchema = z.discriminatedUnion('type', [
	openAIProviderInputSchema,
])
export type OpenAIProviderConfig = z.infer<typeof openAIProviderConfigSchema>
export type OpenAIProviderInput = z.infer<typeof openAIProviderInputSchema>

export type AIProviderConfig = OpenAIProviderConfig
export type AIProviderInput = z.infer<typeof aiProviderInputSchema>

export type AIUsage = DomainChatUsage
export type AITextPart = Extract<DomainChatMessageContentPart, { type: 'text' }>
export type AIImageUrlPart = Extract<
	DomainChatMessageContentPart,
	{ type: 'image_url' }
>
export type AIMessageContentPart = DomainChatMessageContentPart
export type AIToolCall = DomainChatToolCall
export type AIMessage = DomainChatMessage
export type AITaskStatus = DomainChatTaskRecord['status']
export type AIMessageMeta = DomainChatMessageMeta
export type AIMessageRecord = DomainChatMessageRecord
export type AISession = DomainChatSession
export type AITaskRecord = DomainChatTaskRecord

export interface AIToolExecutionContext {
	session: AISession
	depth: number
	maxDepth: number
	parentTaskId?: string
}

export interface AIToolDefinition {
	name: string
	description: string
	inputSchema: z.ZodTypeAny
	execute: (
		params: any,
		context: AIToolExecutionContext,
	) => Promise<string | Record<string, unknown>>
}
