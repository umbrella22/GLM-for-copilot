import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	parseGLMTokenQuotaUsage,
	queryGLMTokenQuotaUsage,
	supportsGLMBalanceUsage,
	supportsGLMPlanUsage,
} from '../../src/provider/usage';

afterEach(() => vi.unstubAllGlobals());

describe('GLM Coding Plan quota parsing', () => {
	it('parses five-hour and monthly MCP quotas without inventing a weekly quota', () => {
		expect(
			parseGLMTokenQuotaUsage({
				limits: [
					{
						type: 'TOKENS_LIMIT',
						percentage: 12.4,
						nextResetTime: 1_784_356_247_996,
					},
					{
						type: 'TIME_LIMIT',
						percentage: 30,
						currentValue: 3,
						usage: 10,
						nextResetTime: 1_799_999_999_999,
					},
				],
			}),
		).toEqual({
			fiveHours: { percentage: 12.4, nextResetTime: 1_784_356_247_996 },
			mcpMonthlyQuota: { used: 3, limit: 10, nextResetTime: 1_799_999_999_999 },
		});
	});

	it('merges optional subscription metadata without rewriting its values', () => {
		expect(
			parseGLMTokenQuotaUsage({ limits: [{ type: 'TOKENS_LIMIT', percentage: 7 }] }, [
				{ productName: 'Pro & Team', nextRenewTime: '2026-08-01T00:00:00Z' },
			]),
		).toEqual({
			fiveHours: { percentage: 7 },
			planName: 'Pro & Team',
			renewsAt: '2026-08-01T00:00:00Z',
		});
	});

	it('maps the optional second token window to weekly usage', () => {
		expect(
			parseGLMTokenQuotaUsage({
				limits: [
					{ type: 'TOKENS_LIMIT', percentage: 42, nextResetTime: 1_784_000_000_000 },
					{ type: 'TOKENS_LIMIT', percentage: 18.5, nextResetTime: 1_784_600_000_000 },
				],
			}),
		).toEqual({
			fiveHours: { percentage: 42, nextResetTime: 1_784_000_000_000 },
			sevenDays: { percentage: 18.5, nextResetTime: 1_784_600_000_000 },
		});
	});

	it('uses quota unit identifiers when token windows arrive out of order', () => {
		expect(
			parseGLMTokenQuotaUsage({
				limits: [
					{ name: 'TOKENS_LIMIT', unit: 6, percentage: 51 },
					{ name: 'TOKENS_LIMIT', unit: 3, percentage: 13 },
					{ name: 'TIME_LIMIT', currentValue: 25, usage: 500 },
				],
			}),
		).toEqual({
			fiveHours: { percentage: 13 },
			sevenDays: { percentage: 51 },
			mcpMonthlyQuota: { used: 25, limit: 500 },
		});
	});

	it('classifies plan and balance endpoints without probing the quota API', () => {
		expect(supportsGLMPlanUsage('https://open.bigmodel.cn/api/coding/paas/v4')).toBe(true);
		expect(supportsGLMPlanUsage('https://api.z.ai/api/anthropic')).toBe(true);
		expect(supportsGLMPlanUsage('https://open.bigmodel.cn/api/paas/v4')).toBe(false);
		expect(supportsGLMBalanceUsage('https://open.bigmodel.cn/api/paas/v4')).toBe(true);
		expect(supportsGLMBalanceUsage('https://proxy.example.com/v1')).toBe(false);
	});

	it('rejects responses without a numeric token quota', () => {
		expect(parseGLMTokenQuotaUsage({ limits: [{ type: 'TOKENS_LIMIT' }] })).toBeUndefined();
		expect(
			parseGLMTokenQuotaUsage({ limits: [{ type: 'TOKENS_LIMIT', unit: 6, percentage: 20 }] }),
		).toBeUndefined();
		expect(parseGLMTokenQuotaUsage({ limits: [] })).toBeUndefined();
		expect(parseGLMTokenQuotaUsage(null)).toBeUndefined();
	});

	it('queries quota and best-effort subscription metadata for status refreshes', async () => {
		const fetchMock = vi.fn((url: string | URL) => {
			const value = String(url);
			return Promise.resolve(
				new Response(
					value.endsWith('/api/biz/subscription/list')
						? JSON.stringify({ data: [{ productName: 'Pro', nextRenewTime: '2026-08-01' }] })
						: JSON.stringify({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 9 }] } }),
					{ status: 200 },
				),
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			queryGLMTokenQuotaUsage('https://open.bigmodel.cn/api/anthropic', 'test-token'),
		).resolves.toEqual({
			fiveHours: { percentage: 9 },
			planName: 'Pro',
			renewsAt: '2026-08-01',
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
			expect.arrayContaining([
				'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
				'https://open.bigmodel.cn/api/biz/subscription/list',
			]),
		);
	});

	it('keeps usable quota data when subscription metadata fails', async () => {
		const fetchMock = vi.fn((url: string | URL) =>
			Promise.resolve(
				String(url).endsWith('/api/biz/subscription/list')
					? new Response('unavailable', { status: 503 })
					: new Response(
							JSON.stringify({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 11 }] } }),
							{ status: 200 },
						),
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			queryGLMTokenQuotaUsage('https://api.z.ai/api/anthropic', 'test-token'),
		).resolves.toEqual({ fiveHours: { percentage: 11 } });
	});

	it('uses the host-specific authorization representation', async () => {
		const headers = new Map<string, string>();
		const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
			headers.set(new URL(String(url)).host, new Headers(init?.headers).get('Authorization') ?? '');
			return Promise.resolve(
				new Response(
					String(url).endsWith('/api/biz/subscription/list')
						? JSON.stringify({ data: [] })
						: JSON.stringify({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 1 }] } }),
					{ status: 200 },
				),
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await queryGLMTokenQuotaUsage('https://api.z.ai/api/anthropic', 'international-key');
		await queryGLMTokenQuotaUsage('https://open.bigmodel.cn/api/anthropic', 'china-key');

		expect(headers.get('api.z.ai')).toBe('Bearer international-key');
		expect(headers.get('open.bigmodel.cn')).toBe('china-key');
	});
});
