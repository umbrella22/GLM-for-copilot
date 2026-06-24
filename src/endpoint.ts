import type { ApiMode, ApiRegion } from './types';

export const GLM_CN_API_HOST = 'open.bigmodel.cn';
export const GLM_CN_LEGACY_API_HOST = 'dev.bigmodel.cn';
export const GLM_INTERNATIONAL_API_HOST = 'api.z.ai';

export const GLM_CN_CODING_BASE_URL = `https://${GLM_CN_API_HOST}/api/coding/paas/v4`;
export const GLM_CN_GENERAL_BASE_URL = `https://${GLM_CN_API_HOST}/api/paas/v4`;
export const GLM_INTERNATIONAL_CODING_BASE_URL = `https://${GLM_INTERNATIONAL_API_HOST}/api/coding/paas/v4`;
export const GLM_INTERNATIONAL_GENERAL_BASE_URL = `https://${GLM_INTERNATIONAL_API_HOST}/api/paas/v4`;
export const DEFAULT_GLM_BASE_URL = GLM_CN_CODING_BASE_URL;

export const GLM_CN_CODING_API_KEY_URL = 'https://bigmodel.cn/coding-plan/personal/overview';
export const GLM_CN_GENERAL_API_KEY_URL = 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys';
export const GLM_INTERNATIONAL_CODING_API_KEY_URL = 'https://z.ai/manage-apikey/subscription';
export const GLM_INTERNATIONAL_GENERAL_API_KEY_URL = 'https://z.ai/manage-apikey/apikey-list';

export type OfficialGLMPlatform = 'zhipu' | 'zai';

export function resolvePresetBaseUrl(apiMode: ApiMode, region: ApiRegion): string {
	if (region === 'international') {
		return apiMode === 'standard'
			? GLM_INTERNATIONAL_GENERAL_BASE_URL
			: GLM_INTERNATIONAL_CODING_BASE_URL;
	}
	return apiMode === 'standard' ? GLM_CN_GENERAL_BASE_URL : GLM_CN_CODING_BASE_URL;
}

export function resolveApiKeyUrl(apiMode: ApiMode, region: ApiRegion): string {
	if (region === 'international') {
		return apiMode === 'standard'
			? GLM_INTERNATIONAL_GENERAL_API_KEY_URL
			: GLM_INTERNATIONAL_CODING_API_KEY_URL;
	}
	return apiMode === 'standard' ? GLM_CN_GENERAL_API_KEY_URL : GLM_CN_CODING_API_KEY_URL;
}

export function identifyOfficialGLMPlatform(baseUrl: string): OfficialGLMPlatform | undefined {
	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		if (host === GLM_INTERNATIONAL_API_HOST) {
			return 'zai';
		}
		if (host === GLM_CN_API_HOST || host === GLM_CN_LEGACY_API_HOST) {
			return 'zhipu';
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function isOfficialGLMBaseUrl(baseUrl: string): boolean {
	return identifyOfficialGLMPlatform(baseUrl) !== undefined;
}

export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/u, '');
}
