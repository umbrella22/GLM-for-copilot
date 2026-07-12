import type { GLMUsage } from '../types';

export interface ResolvedContextUsage {
	usage: GLMUsage;
	promptTokenSource: 'provider' | 'estimate';
}

/** Build a complete usage record for Copilot, estimating input only when the provider reports zero. */
export function resolveContextUsage(
	providerUsage: GLMUsage,
	totalRequestChars: number,
	charsPerToken: number,
): ResolvedContextUsage {
	const hasProviderPromptTokens = providerUsage.prompt_tokens > 0;
	const promptTokens = hasProviderPromptTokens
		? providerUsage.prompt_tokens
		: estimatePromptTokens(totalRequestChars, charsPerToken);
	const completionTokens = Math.max(0, providerUsage.completion_tokens);

	return {
		promptTokenSource: hasProviderPromptTokens ? 'provider' : 'estimate',
		usage: {
			...providerUsage,
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
		},
	};
}

function estimatePromptTokens(totalRequestChars: number, charsPerToken: number): number {
	if (totalRequestChars <= 0 || charsPerToken <= 0 || !Number.isFinite(charsPerToken)) {
		return 0;
	}
	return Math.max(1, Math.ceil(totalRequestChars / charsPerToken));
}
