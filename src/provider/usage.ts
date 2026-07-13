import {
	identifyOfficialGLMApiMode,
	identifyOfficialGLMPlatform,
	normalizeBaseUrl,
} from '../endpoint';

const USAGE_TIMEOUT_MS = 15_000;

export interface GLMPlanUsageResult {
	platform: 'ZAI' | 'ZHIPU';
	baseDomain: string;
	startTime: string;
	endTime: string;
	modelUsage: unknown;
	toolUsage: unknown;
	quotaLimit: unknown;
}

export interface GLMTokenQuotaMetric {
	percentage: number;
	nextResetTime?: number;
}

export interface GLMTokenQuotaUsage {
	fiveHours: GLMTokenQuotaMetric;
	sevenDays?: GLMTokenQuotaMetric;
}

export function supportsGLMPlanUsage(baseUrl: string): boolean {
	return identifyOfficialGLMApiMode(baseUrl) === 'coding-plan';
}

export function supportsGLMBalanceUsage(baseUrl: string): boolean {
	return identifyOfficialGLMApiMode(baseUrl) === 'standard';
}

export async function queryGLMPlanUsage(
	baseUrl: string,
	authToken: string,
): Promise<GLMPlanUsageResult> {
	const platform = identifyOfficialGLMPlatform(baseUrl);
	if (!platform || !supportsGLMPlanUsage(baseUrl)) {
		throw new Error('Unsupported GLM baseUrl');
	}

	const baseDomain = getBaseDomain(baseUrl);
	const { startTime, endTime } = createUsageWindow();
	const queryParams = new URLSearchParams({ startTime, endTime });
	// Combine a manual controller with the timeout so that if any one request
	// fails, the remaining in-flight requests are cancelled instead of being
	// orphaned (they would otherwise keep consuming connections/quota).
	const controller = new AbortController();
	const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(USAGE_TIMEOUT_MS)]);

	try {
		const [modelUsage, toolUsage, quotaLimit] = await Promise.all([
			queryUsageEndpoint(
				`${baseDomain}/api/monitor/usage/model-usage?${queryParams}`,
				authToken,
				signal,
			),
			queryUsageEndpoint(
				`${baseDomain}/api/monitor/usage/tool-usage?${queryParams}`,
				authToken,
				signal,
			),
			queryUsageEndpoint(`${baseDomain}/api/monitor/usage/quota/limit`, authToken, signal),
		]);

		return {
			platform: platform === 'zai' ? 'ZAI' : 'ZHIPU',
			baseDomain,
			startTime,
			endTime,
			modelUsage,
			toolUsage,
			quotaLimit,
		};
	} finally {
		// Always abort the controller so the AbortSignal is torn down
		// and doesn't hold references — previously only aborted on error.
		controller.abort();
	}
}

export async function queryGLMTokenQuotaUsage(
	baseUrl: string,
	authToken: string,
): Promise<GLMTokenQuotaUsage | undefined> {
	if (!supportsGLMPlanUsage(baseUrl)) {
		throw new Error('Unsupported GLM baseUrl');
	}

	const baseDomain = getBaseDomain(baseUrl);
	const controller = new AbortController();
	const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(USAGE_TIMEOUT_MS)]);
	try {
		const quotaLimit = await queryUsageEndpoint(
			`${baseDomain}/api/monitor/usage/quota/limit`,
			authToken,
			signal,
		);
		return parseGLMTokenQuotaUsage(quotaLimit);
	} finally {
		controller.abort();
	}
}

/** Parse the ordered token-quota windows returned by the GLM Coding Plan endpoint. */
export function parseGLMTokenQuotaUsage(quotaLimit: unknown): GLMTokenQuotaUsage | undefined {
	if (!isRecord(quotaLimit) || !Array.isArray(quotaLimit.limits)) {
		return undefined;
	}

	const tokenLimits = quotaLimit.limits.flatMap((item): GLMTokenQuotaMetric[] => {
		if (!isRecord(item) || item.type !== 'TOKENS_LIMIT') {
			return [];
		}
		const percentage = item.percentage;
		if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
			return [];
		}
		const nextResetTime = item.nextResetTime;
		return [
			{
				percentage,
				...(typeof nextResetTime === 'number' && Number.isFinite(nextResetTime)
					? { nextResetTime }
					: {}),
			},
		];
	});

	const fiveHours = tokenLimits[0];
	if (!fiveHours) {
		return undefined;
	}

	// The endpoint orders token windows from shortest to longest. Some plans
	// expose only the first (5-hour) window; the second (7-day) window is optional.
	return {
		fiveHours,
		...(tokenLimits[1] ? { sevenDays: tokenLimits[1] } : {}),
	};
}

export function formatGLMPlanUsageForLog(result: GLMPlanUsageResult): string {
	return [
		`GLM Coding Plan usage`,
		`platform=${result.platform}`,
		`baseDomain=${result.baseDomain}`,
		`window=${result.startTime} -> ${result.endTime}`,
		`modelUsage=${JSON.stringify(result.modelUsage, null, 2)}`,
		`toolUsage=${JSON.stringify(result.toolUsage, null, 2)}`,
		`quotaLimit=${JSON.stringify(result.quotaLimit, null, 2)}`,
	].join('\n');
}

function getBaseDomain(baseUrl: string): string {
	const parsed = new URL(normalizeBaseUrl(baseUrl));
	return `${parsed.protocol}//${parsed.host}`;
}

function createUsageWindow(now = new Date()): {
	startTime: string;
	endTime: string;
} {
	const start = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 1,
		now.getHours(),
		0,
		0,
		0,
	);
	const end = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		now.getHours(),
		59,
		59,
		999,
	);
	return {
		startTime: formatDateTime(start),
		endTime: formatDateTime(end),
	};
}

function formatDateTime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function queryUsageEndpoint(
	url: string,
	authToken: string,
	signal: AbortSignal,
): Promise<unknown> {
	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Authorization: authToken,
			'Accept-Language': 'en-US,en',
			'Content-Type': 'application/json',
		},
		signal,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${truncate(text)}`);
	}

	if (!text.trim()) {
		return {};
	}

	try {
		const parsed = JSON.parse(text) as { data?: unknown };
		return parsed.data ?? parsed;
	} catch {
		return text;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function truncate(value: string): string {
	const singleLine = value.replace(/\s+/g, ' ').trim();
	return singleLine.length > 500 ? `${singleLine.slice(0, 500)}...` : singleLine;
}
