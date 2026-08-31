import { describe, expect, it } from 'vitest'
import {
	resolveOutputTokenBudget,
	resolveSummaryOutputTokenBudget,
} from './inference'

function modelWithOutputLimit(output: number) {
	return { limit: { context: 1_000_000, output } }
}

describe('output token budgets', () => {
	it('uses a bounded default instead of reserving the model capability limit', () => {
		expect(resolveOutputTokenBudget(modelWithOutputLimit(384_000))).toBe(32_768)
	})

	it('preserves an explicit session override', () => {
		expect(resolveOutputTokenBudget(modelWithOutputLimit(384_000), 8_192)).toBe(
			8_192,
		)
	})

	it('caps the session override at the model output limit', () => {
		expect(resolveOutputTokenBudget(modelWithOutputLimit(8_192), 30_000)).toBe(
			8_192,
		)
	})

	it('uses a valid session override when the model limit is unknown', () => {
		expect(resolveOutputTokenBudget(modelWithOutputLimit(0), 8_192)).toBe(8_192)
	})

	it.each([0, -1, 1.5])(
		'falls back to the model limit for an invalid session override of %s',
		(sessionOverride) => {
			expect(
				resolveOutputTokenBudget(modelWithOutputLimit(8_192), sessionOverride),
			).toBe(8_192)
		},
	)

	it('uses the fallback default when model output metadata is unavailable', () => {
		expect(resolveOutputTokenBudget(modelWithOutputLimit(0))).toBe(32_768)
	})

	it('keeps a summary budget independent from a large session answer budget', () => {
		expect(resolveSummaryOutputTokenBudget(modelWithOutputLimit(384_000))).toBe(
			16_384,
		)
	})

	it('keeps the summary request below a small model context window', () => {
		expect(
			resolveSummaryOutputTokenBudget({
				limit: { context: 8_000, output: 16_000 },
			}),
		).toBe(800)
	})
})
