import type { GLMUsage } from '../types';

export const DEFAULT_CHARS_PER_TOKEN = 4;

export type TokenCountSource = 'provider' | 'estimate';

export type ContextUsageSource = 'provider' | 'partial-estimate' | 'estimate';

export interface ResolvedContextUsage {
	usage: GLMUsage;
	source: ContextUsageSource;
	promptTokenSource: TokenCountSource;
	completionTokenSource: TokenCountSource;
}

/** Build the complete, host-facing usage record without treating estimates as provider facts. */
export function resolveContextUsage(
	providerUsage: GLMUsage | undefined,
	promptChars: number,
	completionChars: number,
	charsPerToken: number,
): ResolvedContextUsage {
	const promptFromProvider = normalizeProviderTokenCount(providerUsage?.prompt_tokens);
	const completionFromProvider = normalizeProviderTokenCount(providerUsage?.completion_tokens);
	const promptTokenSource: TokenCountSource =
		promptFromProvider === undefined ? 'estimate' : 'provider';
	const completionTokenSource: TokenCountSource =
		completionFromProvider === undefined ? 'estimate' : 'provider';
	const promptTokens = promptFromProvider ?? estimateTokens(promptChars, charsPerToken);
	const completionTokens = completionFromProvider ?? estimateTokens(completionChars, charsPerToken);
	const cachedTokens = resolveCachedTokens(providerUsage, promptTokens);
	const cacheMissTokens = resolveCacheMissTokens(providerUsage, promptTokens, cachedTokens);
	const source: ContextUsageSource = !providerUsage
		? 'estimate'
		: promptTokenSource === 'provider' && completionTokenSource === 'provider'
			? 'provider'
			: 'partial-estimate';

	return {
		source,
		promptTokenSource,
		completionTokenSource,
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
			...(cachedTokens > 0
				? {
						prompt_cache_hit_tokens: cachedTokens,
						prompt_tokens_details: { cached_tokens: cachedTokens },
					}
				: {}),
			...(cacheMissTokens === undefined ? {} : { prompt_cache_miss_tokens: cacheMissTokens }),
		},
	};
}

function normalizeProviderTokenCount(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

function estimateTokens(chars: number, charsPerToken: number): number {
	if (!Number.isFinite(chars) || chars <= 0) {
		return 0;
	}
	const effectiveCharsPerToken =
		Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
	return Math.max(1, Math.ceil(chars / effectiveCharsPerToken));
}

function resolveCachedTokens(usage: GLMUsage | undefined, promptTokens: number): number {
	const raw = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens;
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
		return 0;
	}
	return Math.min(Math.floor(raw), promptTokens);
}

function resolveCacheMissTokens(
	usage: GLMUsage | undefined,
	promptTokens: number,
	cachedTokens: number,
): number | undefined {
	const raw = usage?.prompt_cache_miss_tokens;
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
		return undefined;
	}
	return Math.min(Math.floor(raw), Math.max(promptTokens - cachedTokens, 0));
}
