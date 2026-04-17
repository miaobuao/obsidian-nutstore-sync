import { generateText, stepCountIs, tool as aiTool } from 'ai'
import type { ModelMessage } from 'ai'
import { getProviderResolver } from './providers/registry'
import {
	AIMessage,
	AIMessageContentPart,
	AIMessageMeta,
	AIProviderConfig,
	AIToolDefinition,
} from './types'

export interface GenerateAssistantTurnRequest {
	provider: AIProviderConfig
	model: string
	messages: AIMessage[]
	tools: AIToolDefinition[]
	temperature?: number
	maxTokens?: number
}

export interface GenerateAssistantTurnResult {
	message: AIMessage
	meta: AIMessageMeta
}

function toTextParts(text?: string | null): AIMessageContentPart[] | null {
	if (!text) {
		return null
	}
	return [{ type: 'text', text }]
}

function toModelMessages(messages: AIMessage[]): ModelMessage[] {
	return messages.map((message) => {
		switch (message.role) {
			case 'system':
				return {
					role: 'system',
					content: message.content
						.filter(
							(part): part is Extract<AIMessageContentPart, { type: 'text' }> =>
								part.type === 'text',
						)
						.map((part) => part.text)
						.join('\n'),
				}
			case 'user': {
				const content = message.content.map((part) => {
					if (part.type === 'image_url') {
						return {
							type: 'image' as const,
							image: new URL(part.image_url.url),
						}
					}
					return {
						type: 'text' as const,
						text: part.type === 'text' ? part.text : JSON.stringify(part.value),
					}
				})
				return {
					role: 'user',
					content,
				}
			}
			case 'assistant': {
				const content = [
					...(message.content || []).map((part) => ({
						type: 'text' as const,
						text: part.type === 'text' ? part.text : JSON.stringify(part),
					})),
					...(message.tool_calls || []).map((toolCall) => ({
						type: 'tool-call' as const,
						toolCallId: toolCall.id,
						toolName: toolCall.function.name,
						input: JSON.parse(toolCall.function.arguments || '{}'),
					})),
				]
				return {
					role: 'assistant',
					content,
				}
			}
			case 'tool':
				return {
					role: 'tool',
					content: [
						{
							type: 'tool-result' as const,
							toolCallId: message.tool_call_id,
							toolName: message.name,
							output: {
								type: 'text' as const,
								value: message.content
									.filter(
										(
											part,
										): part is Extract<
											AIMessageContentPart,
											{ type: 'text' }
										> => part.type === 'text',
									)
									.map((part) => part.text)
									.join('\n'),
							},
						},
					],
				}
		}
	})
}

function toAISDKTools(tools: AIToolDefinition[]) {
	return Object.fromEntries(
		tools.map((toolDefinition) => [
			toolDefinition.name,
			aiTool({
				description: toolDefinition.description,
				inputSchema: toolDefinition.inputSchema,
			}),
		]),
	)
}

function toAssistantMessage(result: any) {
	const toolCalls = result.toolCalls.map((toolCall: any) => ({
		id: toolCall.toolCallId,
		type: 'function' as const,
		function: {
			name: toolCall.toolName,
			arguments: JSON.stringify(toolCall.input ?? {}),
		},
	}))

	if (toolCalls.length > 0) {
		return {
			role: 'assistant' as const,
			content: toTextParts(result.text),
			tool_calls: toolCalls,
		}
	}

	return {
		role: 'assistant' as const,
		content: toTextParts(result.text) || [],
	}
}

export function assertProviderUsable(provider: AIProviderConfig) {
	getProviderResolver(provider).assertUsable(provider as never)
}

export async function generateAssistantTurn(
	request: GenerateAssistantTurnRequest,
): Promise<GenerateAssistantTurnResult> {
	const resolver = getProviderResolver(request.provider)
	const { model, providerName } = resolver.createLanguageModel(
		request.provider as never,
		request.model,
	)
	const result = await generateText({
		model,
		messages: toModelMessages(request.messages),
		tools: toAISDKTools(request.tools),
		stopWhen: stepCountIs(1),
		temperature: request.temperature,
		maxOutputTokens: request.maxTokens,
	})

	return {
		message: toAssistantMessage(result),
		meta: {
			providerId: request.provider.id,
			providerName: request.provider.name || providerName,
			modelName: request.model,
			usage: {
				inputTokens: result.usage.inputTokens,
				outputTokens: result.usage.outputTokens,
				totalTokens: result.usage.totalTokens,
			},
		},
	}
}
