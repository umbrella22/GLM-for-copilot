import type {
	GLMUsage,
	ModelDefinition,
	ModelPricing,
	ModelPricingTier,
	PricingCurrency,
} from '../../types';

const TOKENS_PER_MILLION = 1_000_000;

export interface UsageCostEstimate {
	readonly modelId: string;
	readonly modelName: string;
	readonly currency: PricingCurrency;
	readonly inputCost: number;
	readonly outputCost: number;
	readonly totalCost: number;
	readonly cacheHitInputTokens: number;
	readonly cacheMissInputTokens: number;
	readonly outputTokens: number;
	readonly pricing: {
		readonly cacheHitInput: number;
		readonly cacheMissInput: number;
		readonly output: number;
		readonly tierLabel?: string;
	};
}

export function estimateUsageCost(
	model: ModelDefinition | undefined,
	currency: PricingCurrency | undefined,
	usage: GLMUsage,
): UsageCostEstimate | undefined {
	if (!model || !currency) {
		return undefined;
	}

	const pricing = model.pricing?.[currency];
	if (!pricing) {
		return undefined;
	}

	const effectivePricing = selectPricingTier(pricing, usage.prompt_tokens);
	const cacheHitInputTokens = getCacheHitTokens(usage);
	const cacheMissInputTokens = getCacheMissTokens(usage, cacheHitInputTokens);
	const inputCost =
		(cacheHitInputTokens / TOKENS_PER_MILLION) * effectivePricing.cacheHitInput +
		(cacheMissInputTokens / TOKENS_PER_MILLION) * effectivePricing.cacheMissInput;
	const outputTokens = usage.completion_tokens;
	const outputCost = (outputTokens / TOKENS_PER_MILLION) * effectivePricing.output;

	return {
		modelId: model.id,
		modelName: model.name,
		currency,
		inputCost,
		outputCost,
		totalCost: inputCost + outputCost,
		cacheHitInputTokens,
		cacheMissInputTokens,
		outputTokens,
		pricing: {
			cacheHitInput: effectivePricing.cacheHitInput,
			cacheMissInput: effectivePricing.cacheMissInput,
			output: effectivePricing.output,
			...('label' in effectivePricing ? { tierLabel: effectivePricing.label } : {}),
		},
	};
}

export function formatUsageCostEstimate(estimate: UsageCostEstimate): string {
	return `${formatMoney(estimate.totalCost, estimate.currency)} (${formatMoney(
		estimate.inputCost,
		estimate.currency,
	)} input + ${formatMoney(estimate.outputCost, estimate.currency)} output)`;
}

export function formatMoney(value: number, currency: PricingCurrency): string {
	const symbol = currency === 'CNY' ? '¥' : '$';
	if (value === 0) {
		return `${symbol}0`;
	}
	if (value < 0.0001) {
		return `<${symbol}0.0001`;
	}
	if (value < 0.01) {
		return `${symbol}${value.toFixed(4)}`;
	}
	if (value < 1) {
		return `${symbol}${value.toFixed(3)}`;
	}
	return `${symbol}${value.toFixed(2)}`;
}

function selectPricingTier(
	pricing: ModelPricing,
	promptTokens: number,
): ModelPricing | ModelPricingTier {
	return (
		pricing.tiers?.find((tier) => {
			const aboveMin = tier.minPromptTokens === undefined || promptTokens >= tier.minPromptTokens;
			const belowMax = tier.maxPromptTokens === undefined || promptTokens < tier.maxPromptTokens;
			return aboveMin && belowMax;
		}) ?? pricing
	);
}

function getCacheHitTokens(usage: GLMUsage): number {
	const raw = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
	// Clamp to [0, prompt_tokens]: a misbehaving endpoint can report more cached
	// tokens than the prompt itself, which would otherwise inflate the billed
	// input total above prompt_tokens and skew the cost estimate.
	return Math.min(Math.max(raw, 0), Math.max(usage.prompt_tokens, 0));
}

function getCacheMissTokens(usage: GLMUsage, cacheHitTokens: number): number {
	// Keep the miss count consistent with the clamped hit count so that a
	// misbehaving endpoint cannot report hit + miss > prompt_tokens and inflate
	// the billed input total. Prefer the endpoint value when present, but cap it
	// at the remaining (prompt_tokens - clamped hit) budget.
	const remaining = Math.max(usage.prompt_tokens - cacheHitTokens, 0);
	const explicit = usage.prompt_cache_miss_tokens;
	const value = explicit === undefined ? remaining : explicit;
	return Math.min(Math.max(value, 0), remaining);
}
