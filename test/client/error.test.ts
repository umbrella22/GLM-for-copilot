import { describe, expect, it } from 'vitest';
import { GLMRequestError, createHttpError, createUserFacingError } from '../../src/client/error';
import type { GLMRequest } from '../../src/types';

const GLM_ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
const PROXY_BASE_URL = 'https://proxy.example.com/v1';

function buildRequest(overrides: Partial<GLMRequest> = {}): GLMRequest {
	return {
		model: 'glm-5.2',
		stream: true,
		messages: [{ role: 'user', content: 'hi' }],
		...overrides,
	};
}

function buildResponse(status: number, body: unknown, statusText = ''): Response {
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		status,
		statusText,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('createHttpError', () => {
	it('extracts GLM business code and surfaces the server-side detail verbatim', async () => {
		// Real-world payload captured from logs: HTTP 429 with business code 1308
		// (5-hour usage cap with reset timestamp).
		const response = buildResponse(
			429,
			{
				type: 'error',
				error: {
					type: 'rate_limit_error',
					code: '1308',
					message:
						'[1308][已达到 5 小时的使用上限。您的限额将在 2026-07-05 14:21:10 重置。][20260705130953aa102215047e4900]',
				},
				request_id: '20260705130953aa102215047e4900',
			},
			'Too Many Requests',
		);

		const error = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});

		expect(error).toBeInstanceOf(GLMRequestError);
		expect(error.kind).toBe('http');
		expect(error.status).toBe(429);
		expect(error.businessCode).toBe('1308');
		// The middle bracket group (the actual human-readable detail with the
		// reset timestamp) must be surfaced intact, instead of the generic
		// "请求速率（TPM 或 RPM）达到上限" HTTP fallback.
		expect(error.userSummary).toContain('已达到 5 小时的使用上限');
		expect(error.userSummary).toContain('2026-07-05 14:21:10');
		// request_id noise must NOT leak into the user-facing summary.
		expect(error.userSummary).not.toContain('20260705130953aa102215047e4900');
		// The business code is appended for support quoting.
		expect(error.userSummary).toContain('code 1308');
		// Diagnostic message keeps the full server message + body for debugging.
		expect(error.diagnosticMessage).toContain('businessCode="1308"');
	});

	it('falls back to the HTTP status message when no business code is present', async () => {
		const response = buildResponse(503, {
			error: { message: 'Service Unavailable' },
		});

		const error = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});

		expect(error.businessCode).toBeUndefined();
		// Falls through to the GLM-specific HTTP message rather than the
		// generic "service returned an error" text.
		expect(error.userSummary).toContain('503');
	});

	it('surfaces the raw server message for unknown business codes on official endpoints', async () => {
		// A code we don't have a dictionary entry for yet — should still surface
		// the server-provided message instead of falling back to HTTP-only text.
		const response = buildResponse(429, {
			error: {
				code: '9999',
				message: '[9999][未来新增的限流类型。][request-id-xyz]',
			},
		});

		const error = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});

		expect(error.businessCode).toBe('9999');
		expect(error.userSummary).toContain('未来新增的限流类型');
		expect(error.userSummary).not.toContain('request-id-xyz');
	});

	it('uses server message fallback for non-GLM proxy endpoints', async () => {
		// A third-party proxy that returns a 429 with a helpful message but no
		// GLM business code — we should still surface the proxy's text.
		const response = buildResponse(429, {
			error: { message: 'upstream rate limited, retry in 30s' },
		});

		const error = await createHttpError(response, {
			baseUrl: PROXY_BASE_URL,
			request: buildRequest(),
		});

		expect(error.businessCode).toBeUndefined();
		expect(error.userSummary).toContain('upstream rate limited, retry in 30s');
	});

	it('handles 1309 (Coding Plan expired) and exposes the renewal action link', async () => {
		const response = buildResponse(429, {
			error: {
				code: '1309',
				message:
					'[1309][您的 GLM Coding Plan 套餐已到期，暂无法使用，前往官方续订后即可恢复][req-123]',
			},
		});

		const error = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});

		expect(error.businessCode).toBe('1309');
		expect(error.userSummary).toContain('您的 GLM Coding Plan 套餐已到期');
	});

	it('handles 1001 (missing auth header) by surfacing the server detail', async () => {
		// Standard OpenAI-style error shape: { error: { code, message } }
		const response = buildResponse(401, {
			error: {
				code: '1001',
				message: 'Header 中未收到 Authentication 参数，无法进行身份验证',
			},
		});

		const error = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});

		expect(error.businessCode).toBe('1001');
		// Non-wrapped messages (no `[code][...][req]` envelope) are surfaced
		// through the dictionary entry's template via the {0} substitution path.
		expect(error.userSummary).toContain('Authentication');
		expect(error.userSummary).toContain('code 1001');
	});

	it('handles non-JSON response bodies gracefully', async () => {
		const response = new Response('Gateway Timeout', {
			status: 504,
			statusText: 'Gateway Timeout',
		});

		const error = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});

		expect(error.businessCode).toBeUndefined();
		// 504 falls into the generic HTTP case.
		expect(error.userSummary).toContain('504');
	});
});

describe('createUserFacingError', () => {
	it('renders the GLM business message as bold markdown without leaking the request_id', async () => {
		const response = buildResponse(429, {
			error: {
				code: '1308',
				message:
					'[1308][已达到 5 小时的使用上限。您的限额将在 2026-07-05 14:21:10 重置。][20260705130953aa102215047e4900]',
			},
		});

		const httpError = await createHttpError(response, {
			baseUrl: GLM_ANTHROPIC_BASE_URL,
			request: buildRequest(),
		});
		const facing = createUserFacingError(httpError);

		expect(facing.message).toContain('**');
		expect(facing.message).toContain('已达到 5 小时的使用上限');
		expect(facing.message).not.toContain('20260705130953aa102215047e4900');
		// The stack must be stripped so users don't see the internal trace.
		expect(facing.stack).toBeUndefined();
	});
});
