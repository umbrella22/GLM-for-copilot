import { describe, expect, it } from 'vitest';
import {
	GLM_CN_API_HOST,
	GLM_CN_CODING_API_KEY_URL,
	GLM_CN_CODING_BASE_URL,
	GLM_CN_GENERAL_API_KEY_URL,
	GLM_CN_GENERAL_BASE_URL,
	GLM_CN_LEGACY_API_HOST,
	GLM_INTERNATIONAL_CODING_API_KEY_URL,
	GLM_INTERNATIONAL_CODING_BASE_URL,
	GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
	GLM_INTERNATIONAL_GENERAL_BASE_URL,
	GLM_INTERNATIONAL_API_HOST,
	identifyOfficialGLMPlatform,
	isOfficialGLMBaseUrl,
	normalizeBaseUrl,
	resolveApiKeyUrl,
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

	it('does not classify custom or invalid URLs as official', () => {
		expect(identifyOfficialGLMPlatform('https://proxy.example.com/v1')).toBeUndefined();
		expect(identifyOfficialGLMPlatform('not a url')).toBeUndefined();
		expect(isOfficialGLMBaseUrl('https://proxy.example.com/v1')).toBe(false);
	});
});
