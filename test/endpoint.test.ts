import { describe, expect, it } from 'vitest';
import {
	GLM_CN_ANTHROPIC_BASE_URL,
	GLM_CN_API_HOST,
	GLM_CN_CODING_API_KEY_URL,
	GLM_CN_CODING_BASE_URL,
	GLM_CN_GENERAL_API_KEY_URL,
	GLM_CN_GENERAL_BASE_URL,
	GLM_CN_LEGACY_API_HOST,
	GLM_INTERNATIONAL_ANTHROPIC_BASE_URL,
	GLM_INTERNATIONAL_API_HOST,
	GLM_INTERNATIONAL_CODING_API_KEY_URL,
	GLM_INTERNATIONAL_CODING_BASE_URL,
	GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
	GLM_INTERNATIONAL_GENERAL_BASE_URL,
	deriveEndpointPreset,
	identifyOfficialGLMApiMode,
	identifyOfficialGLMPlatform,
	isOfficialGLMBaseUrl,
	normalizeBaseUrl,
	resolveAnthropicBaseUrl,
	resolveApiKeyUrl,
	resolveEndpointApiKeyUrl,
	resolveEndpointBaseUrl,
	resolveEndpointProtocol,
	resolvePresetBaseUrl,
} from '../src/endpoint';

describe('endpoint helpers', () => {
	it('resolves apiMode and region endpoint presets', () => {
		expect(resolvePresetBaseUrl('coding-plan', 'china')).toBe(GLM_CN_CODING_BASE_URL);
		expect(resolvePresetBaseUrl('standard', 'china')).toBe(GLM_CN_GENERAL_BASE_URL);
		expect(resolvePresetBaseUrl('coding-plan', 'international')).toBe(
			GLM_INTERNATIONAL_CODING_BASE_URL,
		);
		expect(resolvePresetBaseUrl('standard', 'international')).toBe(
			GLM_INTERNATIONAL_GENERAL_BASE_URL,
		);
	});

	it('resolves API key pages from apiMode and region', () => {
		expect(resolveApiKeyUrl('coding-plan', 'china')).toBe(GLM_CN_CODING_API_KEY_URL);
		expect(resolveApiKeyUrl('standard', 'china')).toBe(GLM_CN_GENERAL_API_KEY_URL);
		expect(resolveApiKeyUrl('coding-plan', 'international')).toBe(
			GLM_INTERNATIONAL_CODING_API_KEY_URL,
		);
		expect(resolveApiKeyUrl('standard', 'international')).toBe(
			GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
		);
	});

	it('normalizes trailing slashes and surrounding whitespace', () => {
		expect(normalizeBaseUrl(' https://open.bigmodel.cn/api/paas/v4/// ')).toBe(
			'https://open.bigmodel.cn/api/paas/v4',
		);
	});

	it('identifies official GLM platforms by host', () => {
		expect(identifyOfficialGLMPlatform(`https://${GLM_INTERNATIONAL_API_HOST}/api/paas/v4`)).toBe(
			'zai',
		);
		expect(identifyOfficialGLMPlatform(`https://${GLM_CN_API_HOST}/api/paas/v4`)).toBe('zhipu');
		expect(identifyOfficialGLMPlatform(`https://${GLM_CN_LEGACY_API_HOST}/api/paas/v4`)).toBe(
			'zhipu',
		);
	});

	it('identifies Coding Plan and balance billing from official endpoint paths', () => {
		expect(identifyOfficialGLMApiMode(GLM_CN_CODING_BASE_URL)).toBe('coding-plan');
		expect(identifyOfficialGLMApiMode(GLM_INTERNATIONAL_ANTHROPIC_BASE_URL)).toBe('coding-plan');
		expect(identifyOfficialGLMApiMode(GLM_CN_GENERAL_BASE_URL)).toBe('standard');
		expect(identifyOfficialGLMApiMode(GLM_INTERNATIONAL_GENERAL_BASE_URL)).toBe('standard');
		expect(identifyOfficialGLMApiMode('https://open.bigmodel.cn/custom/v1')).toBeUndefined();
	});

	it('does not classify custom or invalid URLs as official', () => {
		expect(identifyOfficialGLMPlatform('https://proxy.example.com/v1')).toBeUndefined();
		expect(identifyOfficialGLMPlatform('not a url')).toBeUndefined();
		expect(isOfficialGLMBaseUrl('https://proxy.example.com/v1')).toBe(false);
	});

	it('resolves the Anthropic endpoint for both regions (regression: international was hardcoded to CN)', () => {
		expect(resolveAnthropicBaseUrl('china')).toBe(GLM_CN_ANTHROPIC_BASE_URL);
		expect(resolveAnthropicBaseUrl('international')).toBe(GLM_INTERNATIONAL_ANTHROPIC_BASE_URL);
	});
});

describe('endpoint preset resolver', () => {
	it('resolves every preset to its official base URL', () => {
		expect(resolveEndpointBaseUrl('china-coding')).toBe(GLM_CN_CODING_BASE_URL);
		expect(resolveEndpointBaseUrl('china-standard')).toBe(GLM_CN_GENERAL_BASE_URL);
		expect(resolveEndpointBaseUrl('china-anthropic')).toBe(GLM_CN_ANTHROPIC_BASE_URL);
		expect(resolveEndpointBaseUrl('international-coding')).toBe(GLM_INTERNATIONAL_CODING_BASE_URL);
		expect(resolveEndpointBaseUrl('international-standard')).toBe(
			GLM_INTERNATIONAL_GENERAL_BASE_URL,
		);
		expect(resolveEndpointBaseUrl('international-anthropic')).toBe(
			GLM_INTERNATIONAL_ANTHROPIC_BASE_URL,
		);
	});

	it('resolves every preset to its API key management page', () => {
		expect(resolveEndpointApiKeyUrl('china-coding')).toBe(GLM_CN_CODING_API_KEY_URL);
		expect(resolveEndpointApiKeyUrl('china-standard')).toBe(GLM_CN_GENERAL_API_KEY_URL);
		expect(resolveEndpointApiKeyUrl('china-anthropic')).toBe(GLM_CN_CODING_API_KEY_URL);
		expect(resolveEndpointApiKeyUrl('international-coding')).toBe(
			GLM_INTERNATIONAL_CODING_API_KEY_URL,
		);
		expect(resolveEndpointApiKeyUrl('international-standard')).toBe(
			GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
		);
		expect(resolveEndpointApiKeyUrl('international-anthropic')).toBe(
			GLM_INTERNATIONAL_CODING_API_KEY_URL,
		);
	});

	it('maps each preset to its implied wire protocol', () => {
		expect(resolveEndpointProtocol('china-coding')).toBe('openai');
		expect(resolveEndpointProtocol('china-standard')).toBe('openai');
		expect(resolveEndpointProtocol('china-anthropic')).toBe('anthropic');
		expect(resolveEndpointProtocol('international-coding')).toBe('openai');
		expect(resolveEndpointProtocol('international-standard')).toBe('openai');
		expect(resolveEndpointProtocol('international-anthropic')).toBe('anthropic');
	});
});

describe('legacy endpoint derivation', () => {
	it('maps the default tuple to china-coding', () => {
		expect(deriveEndpointPreset('china', 'coding-plan', 'openai')).toBe('china-coding');
	});

	it('maps standard mode on both regions', () => {
		expect(deriveEndpointPreset('china', 'standard', 'openai')).toBe('china-standard');
		expect(deriveEndpointPreset('international', 'standard', 'openai')).toBe(
			'international-standard',
		);
	});

	it('maps international coding plan', () => {
		expect(deriveEndpointPreset('international', 'coding-plan', 'openai')).toBe(
			'international-coding',
		);
	});

	it('lets apiProtocol=anthropic override apiMode and picks the right region (regression)', () => {
		// Previously region was ignored under anthropic protocol; now it must
		// resolve to the matching regional Anthropic endpoint.
		expect(deriveEndpointPreset('china', 'coding-plan', 'anthropic')).toBe('china-anthropic');
		expect(deriveEndpointPreset('china', 'standard', 'anthropic')).toBe('china-anthropic');
		expect(deriveEndpointPreset('international', 'coding-plan', 'anthropic')).toBe(
			'international-anthropic',
		);
		expect(deriveEndpointPreset('international', 'standard', 'anthropic')).toBe(
			'international-anthropic',
		);
	});
});
