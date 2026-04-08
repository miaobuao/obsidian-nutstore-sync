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
import type { z } from 'zod'

export type AIProviderType = 'openai'

export interface AIModelConfig {
	id: string
	name: string
}

export interface AIProviderConfigBase {
	id: string
	name: string
	models: AIModelConfig[]
}

export interface OpenAIProviderConfig extends AIProviderConfigBase {
	type: 'openai'
	apiKey: string
	baseUrl?: string
	organization?: string
	project?: string
}

export type AIProviderConfig = OpenAIProviderConfig

export type AIUsage = DomainChatUsage
export type AITextPart = Extract<DomainChatMessageContentPart, { type: 'text' }>
export type AIImageUrlPart = Extract<DomainChatMessageContentPart, { type: 'image_url' }>
export type AIMessageContentPart = DomainChatMessageContentPart
export type AIToolCall = DomainChatToolCall
export type AIMessage = DomainChatMessage
export type AITaskStatus = DomainChatTaskRecord['status']
export type ChatMessageMeta = DomainChatMessageMeta
export type ChatMessageRecord = DomainChatMessageRecord
export type ChatSession = DomainChatSession
export type ChatTaskRecord = DomainChatTaskRecord

export interface AIToolExecutionContext {
	session: ChatSession
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
