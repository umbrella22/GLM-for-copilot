import { identifyOfficialGLMPlatform, normalizeBaseUrl } from '../../endpoint';
import type { PricingCurrency } from '../../types';

/**
 * The GLM domestic and international endpoints expose different currencies.
 * There is no stable balance endpoint in the OpenAI-compatible API path, so
 * model-picker pricing uses the endpoint host instead of probing account state.
 */
export function getPricingCurrencyForBaseUrl(baseUrl: string): PricingCurrency | undefined {
	const platform = identifyOfficialGLMPlatform(normalizeBaseUrl(baseUrl));
	if (platform === 'zhipu') {
		return 'CNY';
	}
	if (platform === 'zai') {
		return 'USD';
	}
	return undefined;
}
