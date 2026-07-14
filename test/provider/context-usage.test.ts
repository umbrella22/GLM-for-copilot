import { describe, expect, it } from 'vitest';
import { resolveContextUsage } from '../../src/provider/context-usage';

describe('Copilot context usage resolution', () => {
	it('uses provider prompt tokens and restores the total-token invariant', () => {
		const resolved = resolveContextUsage(
			{ prompt_tokens: 120, completion_tokens: 30, total_tokens: 30 },
			10_000,
			1_000,
			4,
		);

		expect(resolved).toEqual({
			source: 'provider',
			promptTokenSource: 'provider',
			completionTokenSource: 'provider',
			usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
		});
	});

	it('estimates missing provider token fields independently', () => {
		const resolved = resolveContextUsage(
			{ prompt_tokens: 0, completion_tokens: 25, total_tokens: 25 },
			1_001,
			100,
			4,
		);

		expect(resolved).toEqual({
			source: 'partial-estimate',
			promptTokenSource: 'estimate',
			completionTokenSource: 'provider',
			usage: { prompt_tokens: 251, completion_tokens: 25, total_tokens: 276 },
		});
	});

	it('estimates both token counts when the provider omits usage', () => {
		expect(resolveContextUsage(undefined, 1_001, 101, 4)).toEqual({
			source: 'estimate',
			promptTokenSource: 'estimate',
			completionTokenSource: 'estimate',
			usage: { prompt_tokens: 251, completion_tokens: 26, total_tokens: 277 },
		});
	});

	it('uses the default ratio and clamps explicit cached tokens', () => {
		expect(
			resolveContextUsage(
				{
					prompt_tokens: 10,
					completion_tokens: 2,
					total_tokens: 12,
					prompt_cache_hit_tokens: 50,
					prompt_cache_miss_tokens: 50,
				},
				10,
				10,
				Number.NaN,
			),
		).toEqual({
			source: 'provider',
			promptTokenSource: 'provider',
			completionTokenSource: 'provider',
			usage: {
				prompt_tokens: 10,
				completion_tokens: 2,
				total_tokens: 12,
				prompt_cache_hit_tokens: 10,
				prompt_tokens_details: { cached_tokens: 10 },
				prompt_cache_miss_tokens: 0,
			},
		});
	});
});
