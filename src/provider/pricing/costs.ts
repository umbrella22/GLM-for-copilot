import type { ModelDefinition, PriceCategory, PricingCurrency } from '../../types';

/**
 * VS Code renders these private metadata fields as numeric credits per 1M tokens.
 * Keep currency formatting at our own UI boundary; passing labels such as "$1.40"
 * makes the model-picker hover reject the value and render it as Unknown.
 *
 * Mapping:
 * - inputCost  <- cacheMissInput, the representative non-cached input price.
 * - cacheCost  <- cacheHitInput, shown separately as the cached-input tier.
 * - outputCost <- output.
 *
 * priceCategory is emitted only together with concrete official pricing; incomplete
 * pricing intentionally suppresses all cost metadata.
 */
export interface ModelCostInformation {
	readonly inputCost?: number;
	readonly outputCost?: number;
	readonly cacheCost?: number;
	readonly priceCategory?: PriceCategory;
}

export function toModelCostInfo(
	model: ModelDefinition,
	currency?: PricingCurrency,
): ModelCostInformation {
	if (!currency) {
		return {};
	}

	const pricing = model.pricing?.[currency];
	if (!pricing) {
		return {};
	}

	return {
		...(model.priceCategory ? { priceCategory: model.priceCategory } : {}),
		inputCost: pricing.cacheMissInput,
		outputCost: pricing.output,
		cacheCost: pricing.cacheHitInput,
	};
}
