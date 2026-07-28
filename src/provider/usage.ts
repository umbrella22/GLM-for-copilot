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

export interface GLMCountQuotaMetric {
	used: number;
	limit: number;
	nextResetTime?: number;
}

export interface GLMTokenQuotaUsage {
	fiveHours: GLMTokenQuotaMetric;
	sevenDays?: GLMTokenQuotaMetric;
	mcpMonthlyQuota?: GLMCountQuotaMetric;
	planName?: string;
	renewsAt?: string;
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
		const [quotaResult, subscriptionResult] = await Promise.allSettled([
			queryUsageEndpoint(`${baseDomain}/api/monitor/usage/quota/limit`, authToken, signal),
			queryUsageEndpoint(`${baseDomain}/api/biz/subscription/list`, authToken, signal),
		]);
		if (quotaResult.status === 'rejected') {
			throw quotaResult.reason;
		}
		return parseGLMTokenQuotaUsage(
			quotaResult.value,
			subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : undefined,
		);
	} finally {
		controller.abort();
	}
}

/** Parse the ordered token-quota windows returned by the GLM Coding Plan endpoint. */
export function parseGLMTokenQuotaUsage(
	quotaLimit: unknown,
	subscription?: unknown,
): GLMTokenQuotaUsage | undefined {
	if (!isRecord(quotaLimit) || !Array.isArray(quotaLimit.limits)) {
		return undefined;
	}

	const tokenLimits = quotaLimit.limits.flatMap(
		(item): { metric: GLMTokenQuotaMetric; unit?: number }[] => {
			if (!isRecord(item) || (item.type !== 'TOKENS_LIMIT' && item.name !== 'TOKENS_LIMIT')) {
				return [];
			}
			const percentage = item.percentage;
			if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
				return [];
			}
			const nextResetTime = item.nextResetTime;
			const unit = item.unit;
			return [
				{
					metric: {
						percentage,
						...(typeof nextResetTime === 'number' && Number.isFinite(nextResetTime)
							? { nextResetTime }
							: {}),
					},
					...(typeof unit === 'number' && Number.isFinite(unit) ? { unit } : {}),
				},
			];
		},
	);

	const hasIdentifiedWindow = tokenLimits.some((item) => item.unit !== undefined);
	const fiveHours =
		tokenLimits.find((item) => item.unit === 3)?.metric ??
		(hasIdentifiedWindow ? undefined : tokenLimits[0]?.metric);
	if (!fiveHours) {
		return undefined;
	}
	const sevenDays =
		tokenLimits.find((item) => item.unit === 6)?.metric ??
		(hasIdentifiedWindow
			? undefined
			: tokenLimits.find((item) => item.metric !== fiveHours)?.metric);
	const monthlyMcpLimit = quotaLimit.limits.find((item): boolean => {
		return isRecord(item) && (item.type === 'TIME_LIMIT' || item.name === 'TIME_LIMIT');
	});
	const mcpMonthlyQuota = parseCountQuotaMetric(monthlyMcpLimit);
	const plan = parseSubscription(subscription);

	// Current responses identify the 5-hour and weekly windows with unit 3 and 6.
	// Older responses omitted unit, so preserve their shortest-to-longest ordering as a fallback.
	return {
		fiveHours,
		...(sevenDays ? { sevenDays } : {}),
		...(mcpMonthlyQuota ? { mcpMonthlyQuota } : {}),
		...plan,
	};
}

function parseCountQuotaMetric(value: unknown): GLMCountQuotaMetric | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const used = value.currentValue;
	const limit = value.usage;
	if (
		typeof used !== 'number' ||
		!Number.isFinite(used) ||
		typeof limit !== 'number' ||
		!Number.isFinite(limit)
	) {
		return undefined;
	}
	const nextResetTime = value.nextResetTime;
	return {
		used,
		limit,
		...(typeof nextResetTime === 'number' && Number.isFinite(nextResetTime)
			? { nextResetTime }
			: {}),
	};
}

function parseSubscription(value: unknown): Pick<GLMTokenQuotaUsage, 'planName' | 'renewsAt'> {
	const first = Array.isArray(value) ? value[0] : undefined;
	if (!isRecord(first)) {
		return {};
	}
	return {
		...(typeof first.productName === 'string' && first.productName.trim()
			? { planName: first.productName }
			: {}),
		...(typeof first.nextRenewTime === 'string' && first.nextRenewTime.trim()
			? { renewsAt: first.nextRenewTime }
			: {}),
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
			Authorization: formatUsageAuthorization(url, authToken),
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

function formatUsageAuthorization(url: string, authToken: string): string {
	const platform = identifyOfficialGLMPlatform(url);
	return platform === 'zai' && !/^Bearer\s/iu.test(authToken) ? `Bearer ${authToken}` : authToken;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function truncate(value: string): string {
	const singleLine = value.replace(/\s+/g, ' ').trim();
	return singleLine.length > 500 ? `${singleLine.slice(0, 500)}...` : singleLine;
}
