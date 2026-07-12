import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGLMTokenQuotaUsage, queryGLMTokenQuotaUsage } from '../../src/provider/usage';

afterEach(() => vi.unstubAllGlobals());

describe('GLM Coding Plan quota parsing', () => {
	it('parses a five-hour quota without inventing a weekly quota', () => {
		expect(
			parseGLMTokenQuotaUsage({
				limits: [
					{ type: 'TOKENS_LIMIT', percentage: 12.4 },
					{
						type: 'TIME_LIMIT',
						percentage: 30,
						currentValue: 3,
						usage: 10,
						nextResetTime: 1_784_356_247_996,
					},
				],
			}),
		).toEqual({
			fiveHours: { percentage: 12.4 },
			nextResetTime: 1_784_356_247_996,
		});
	});

	it('maps the optional second token window to weekly usage', () => {
		expect(
			parseGLMTokenQuotaUsage({
				limits: [
					{ type: 'TOKENS_LIMIT', percentage: 42 },
					{ type: 'TOKENS_LIMIT', percentage: 18.5 },
				],
			}),
		).toEqual({
			fiveHours: { percentage: 42 },
			sevenDays: { percentage: 18.5 },
		});
	});

	it('rejects responses without a numeric token quota', () => {
		expect(parseGLMTokenQuotaUsage({ limits: [{ type: 'TOKENS_LIMIT' }] })).toBeUndefined();
		expect(parseGLMTokenQuotaUsage({ limits: [] })).toBeUndefined();
		expect(parseGLMTokenQuotaUsage(null)).toBeUndefined();
	});

	it('queries only the quota endpoint for status refreshes', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 9 }] } }),
					{ status: 200 },
				),
			);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			queryGLMTokenQuotaUsage('https://open.bigmodel.cn/api/anthropic', 'test-token'),
		).resolves.toEqual({ fiveHours: { percentage: 9 } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
		);
	});
});
