import { describe, expect, it } from 'vitest';
import type { ModelDefinition } from '../../../src/types';
import {
	estimateUsageCost,
	formatMoney,
	formatUsageCostEstimate,
} from '../../../src/provider/pricing/usage';

function createModel(): ModelDefinition {
	return {
		id: 'glm-test',
		name: 'GLM Test',
		family: 'glm',
		version: 'test',
		detail: 'test model',
		maxInputTokens: 100_000,
		maxOutputTokens: 10_000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		priceCategory: 'medium',
		pricing: {
			CNY: {
				cacheHitInput: 2,
				cacheMissInput: 8,
				output: 28,
				tiers: [
					{
						label: 'short',
						maxPromptTokens: 32_000,
						cacheHitInput: 2,
						cacheMissInput: 8,
						output: 28,
					},
					{
						label: 'long',
						minPromptTokens: 32_000,
						cacheHitInput: 3,
						cacheMissInput: 10,
						output: 30,
					},
				],
			},
			USD: {
				cacheHitInput: 0.2,
				cacheMissInput: 1,
				output: 4,
			},
		},
	};
}

describe('usage cost estimation', () => {
	it('returns undefined when model or currency pricing is unavailable', () => {
		const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

		expect(estimateUsageCost(undefined, 'CNY', usage)).toBeUndefined();
		expect(estimateUsageCost(createModel(), undefined, usage)).toBeUndefined();
	});

	it('uses cached token details when explicit cache fields are absent', () => {
		const estimate = estimateUsageCost(createModel(), 'USD', {
			prompt_tokens: 1_000_000,
			completion_tokens: 500_000,
			total_tokens: 1_500_000,
			prompt_tokens_details: { cached_tokens: 250_000 },
		});

		expect(estimate).toMatchObject({
			cacheHitInputTokens: 250_000,
			cacheMissInputTokens: 750_000,
			outputTokens: 500_000,
		});
		expect(estimate?.inputCost).toBeCloseTo(0.8);
		expect(estimate?.outputCost).toBeCloseTo(2);
		expect(estimate?.totalCost).toBeCloseTo(2.8);
	});

	it('prefers explicit cache hit and miss usage fields', () => {
		const estimate = estimateUsageCost(createModel(), 'CNY', {
			prompt_tokens: 100_000,
			completion_tokens: 10_000,
			total_tokens: 110_000,
			prompt_cache_hit_tokens: 60_000,
			prompt_cache_miss_tokens: 20_000,
		});

		expect(estimate?.cacheHitInputTokens).toBe(60_000);
		expect(estimate?.cacheMissInputTokens).toBe(20_000);
	});

	it('selects the matching prompt-token pricing tier', () => {
		const estimate = estimateUsageCost(createModel(), 'CNY', {
			prompt_tokens: 32_000,
			completion_tokens: 1_000,
			total_tokens: 33_000,
		});

		expect(estimate?.pricing.tierLabel).toBe('long');
		expect(estimate?.pricing.cacheMissInput).toBe(10);
		expect(estimate?.pricing.output).toBe(30);
	});

	it('formats money and cost summaries', () => {
		expect(formatMoney(0, 'CNY')).toBe('¥0');
		expect(formatMoney(0.000_01, 'USD')).toBe('<$0.0001');
		expect(formatMoney(0.005, 'USD')).toBe('$0.0050');
		expect(formatMoney(0.5, 'USD')).toBe('$0.500');
		expect(formatMoney(1.234, 'USD')).toBe('$1.23');

		const estimate = estimateUsageCost(createModel(), 'USD', {
			prompt_tokens: 1_000,
			completion_tokens: 1_000,
			total_tokens: 2_000,
		});

		expect(estimate ? formatUsageCostEstimate(estimate) : '').toContain('input +');
	});
});
