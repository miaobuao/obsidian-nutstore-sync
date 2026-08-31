import type { AIModelConfig } from './types'

const MIN_DEFAULT_OUTPUT_TOKENS = 4096
const MAX_DEFAULT_OUTPUT_TOKENS = 32_768
const FALLBACK_DEFAULT_OUTPUT_TOKENS = 16_384
const DEFAULT_OUTPUT_CONTEXT_RATIO = 0.1
const MAX_DEFAULT_OUTPUT_CONTEXT_RATIO = 0.25
const MIN_SUMMARY_OUTPUT_TOKENS = 4096
const MAX_SUMMARY_OUTPUT_TOKENS = 16_384
const SUMMARY_OUTPUT_CONTEXT_RATIO = 0.02
const MAX_SUMMARY_OUTPUT_CONTEXT_RATIO = 0.1

/**
 * Resolves the per-call output budget. A catalog output limit is a capability
 * ceiling, not the default request size: using it directly would reserve an
 * entire context window for models with large advertised outputs.
 */
export function resolveOutputTokenBudget(
	model: Pick<AIModelConfig, 'limit'> | undefined,
	sessionMaxOutputTokens?: number,
): number | undefined {
	const modelOutputLimit = toPositiveInteger(model?.limit?.output)
	const configuredOutputLimit = toPositiveInteger(sessionMaxOutputTokens)
	const defaultOutputBudget = resolveDefaultOutputBudget(model)
	const requestedOutputBudget = configuredOutputLimit ?? defaultOutputBudget
	if (requestedOutputBudget === undefined) return modelOutputLimit

	return modelOutputLimit === undefined
		? requestedOutputBudget
		: Math.min(requestedOutputBudget, modelOutputLimit)
}

/** Compression has its own bounded output budget and never inherits a user’s
 * potentially very large answer budget. */
export function resolveSummaryOutputTokenBudget(
	model: Pick<AIModelConfig, 'limit'> | undefined,
): number | undefined {
	const modelOutputLimit = toPositiveInteger(model?.limit?.output)
	const contextWindow = toPositiveInteger(model?.limit?.context)
	const summaryBudget = contextWindow
		? Math.min(
				clamp(
					Math.floor(contextWindow * SUMMARY_OUTPUT_CONTEXT_RATIO),
					MIN_SUMMARY_OUTPUT_TOKENS,
					MAX_SUMMARY_OUTPUT_TOKENS,
				),
				Math.max(
					1,
					Math.floor(contextWindow * MAX_SUMMARY_OUTPUT_CONTEXT_RATIO),
				),
			)
		: MIN_SUMMARY_OUTPUT_TOKENS

	return modelOutputLimit === undefined
		? summaryBudget
		: Math.min(summaryBudget, modelOutputLimit)
}

/** @deprecated Prefer {@link resolveOutputTokenBudget}. */
export const resolveMaxOutputTokens = resolveOutputTokenBudget

function resolveDefaultOutputBudget(
	model: Pick<AIModelConfig, 'limit'> | undefined,
) {
	const contextWindow = toPositiveInteger(model?.limit?.context)
	if (contextWindow === undefined) return FALLBACK_DEFAULT_OUTPUT_TOKENS

	return Math.min(
		clamp(
			Math.floor(contextWindow * DEFAULT_OUTPUT_CONTEXT_RATIO),
			MIN_DEFAULT_OUTPUT_TOKENS,
			MAX_DEFAULT_OUTPUT_TOKENS,
		),
		Math.floor(contextWindow * MAX_DEFAULT_OUTPUT_CONTEXT_RATIO),
	)
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(Math.max(value, minimum), maximum)
}

function toPositiveInteger(value: number | undefined) {
	return value !== undefined && Number.isInteger(value) && value > 0
		? value
		: undefined
}
