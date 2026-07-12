import { describe, expect, it } from 'vitest';
import { resolveContextUsage } from '../../src/provider/context-usage';

describe('Copilot context usage resolution', () => {
	it('uses provider prompt tokens and restores the total-token invariant', () => {
		const resolved = resolveContextUsage(
			{ prompt_tokens: 120, completion_tokens: 30, total_tokens: 30 },
			10_000,
			4,
		);

		expect(resolved).toEqual({
			promptTokenSource: 'provider',
			usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
		});
	});

	it('estimates prompt tokens only when the provider reports zero', () => {
		const resolved = resolveContextUsage(
			{ prompt_tokens: 0, completion_tokens: 25, total_tokens: 25 },
			1_001,
			4,
		);

		expect(resolved).toEqual({
			promptTokenSource: 'estimate',
			usage: { prompt_tokens: 251, completion_tokens: 25, total_tokens: 276 },
		});
	});
});
