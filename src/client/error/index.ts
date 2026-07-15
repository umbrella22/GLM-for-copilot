import { isOfficialGLMBaseUrl } from '../../endpoint';
import { getGLMContentText, redactGLMImageDataUrls } from '../../glm-content';
import { t } from '../../i18n';
import { safeStringify } from '../../json';
import {
	API_PROVIDER_HTTP_ERROR_LINKS,
	GLM_BUSINESS_ERROR_CODES,
	MAX_DIAGNOSTIC_FIELD_LENGTH,
} from '../consts';
import type {
	ApiProviderId,
	ErrorActionLink,
	ErrorActionUrls,
	GLMRequestErrorKind,
	HttpErrorLinkDefinition,
	HttpErrorLinkStatusKey,
	RequestErrorContext,
} from '../types';
import { getNetworkErrorCauseInfo, getNetworkErrorCode, getNetworkErrorMessage } from './network';
export type { ErrorActionUrls, GLMRequestErrorKind } from '../types';

const errorActionUrlStore = (() => {
	let current: ErrorActionUrls = {};

	return {
		get: () => current,
		set: (key: keyof ErrorActionUrls, url: string) => {
			current = { ...current, [key]: url };
		},
	};
})();

export function setErrorActionUrl(key: keyof ErrorActionUrls, url: string): void {
	errorActionUrlStore.set(key, url);
}

export class GLMRequestError extends Error {
	readonly kind: GLMRequestErrorKind;
	readonly userSummary: string;
	readonly diagnosticMessage: string;
	readonly baseUrl?: string;
	readonly status?: number;
	readonly code?: string;
	readonly businessCode?: string;
	readonly serverMessage?: string;

	constructor(options: {
		message: string;
		userSummary?: string;
		kind: GLMRequestErrorKind;
		diagnosticMessage?: string;
		baseUrl?: string;
		status?: number;
		code?: string;
		businessCode?: string;
		serverMessage?: string;
		cause?: unknown;
	}) {
		super(options.message, { cause: options.cause });
		this.name = 'GLMRequestError';
		this.kind = options.kind;
		this.userSummary = options.userSummary ?? options.message;
		this.diagnosticMessage = options.diagnosticMessage ?? options.message;
		this.baseUrl = options.baseUrl;
		this.status = options.status;
		this.code = options.code;
		this.businessCode = options.businessCode;
		this.serverMessage = options.serverMessage;
	}
}

export async function createHttpError(
	response: Response,
	context: RequestErrorContext,
): Promise<GLMRequestError> {
	const { baseUrl } = context;
	const responseText = await response.text();
	const parsed = parseServerErrorResponse(responseText);
	const businessCode = extractBusinessCode(parsed);
	const serverMessage = extractServerMessage(parsed, responseText);
	const userSummary = getHttpErrorMessage({
		status: response.status,
		baseUrl,
		businessCode,
		serverMessage,
	});

	return new GLMRequestError({
		message: `GLM API request failed with HTTP ${response.status}`,
		userSummary,
		kind: 'http',
		baseUrl,
		status: response.status,
		code: `HTTP_${response.status}`,
		businessCode,
		serverMessage,
		diagnosticMessage: joinDiagnosticParts(
			`kind=http`,
			`status=${response.status}`,
			businessCode ? `businessCode=${safeStringify(businessCode)}` : undefined,
			getRequestDiagnosticMessage(context),
			`statusText=${safeStringify(response.statusText || 'unknown')}`,
			serverMessage ? `serverMessage=${safeStringify(serverMessage)}` : undefined,
			responseText && responseText !== serverMessage
				? `body=${safeStringify(truncateSingleLine(responseText))}`
				: undefined,
		),
	});
}

export function normalizeRequestError(error: unknown, context: RequestErrorContext): Error {
	if (error instanceof GLMRequestError) {
		return error;
	}

	if (!(error instanceof Error)) {
		const value = truncateSingleLine(String(error));
		return new GLMRequestError({
			message: `GLM request failed with a non-Error value: ${value}`,
			userSummary: t('error.unknown', value),
			kind: 'unknown',
			baseUrl: context.baseUrl,
			diagnosticMessage: joinDiagnosticParts(
				`kind=unknown`,
				getRequestDiagnosticMessage(context),
				`error=${safeStringify(value)}`,
			),
		});
	}

	const causeInfo = getNetworkErrorCauseInfo(error);
	if (!causeInfo) {
		return error;
	}

	const code = getNetworkErrorCode(causeInfo);
	const userSummary = getNetworkErrorMessage(code);
	const enhanced = new GLMRequestError({
		message: code
			? `GLM request failed due to network error ${code}`
			: 'GLM request failed due to a network error',
		userSummary,
		kind: 'network',
		baseUrl: context.baseUrl,
		code,
		cause: error,
		diagnosticMessage: joinDiagnosticParts(
			`kind=network`,
			code ? `code=${code}` : undefined,
			getRequestDiagnosticMessage(context),
			`message=${safeStringify(truncateSingleLine(error.message))}`,
			`cause=${causeInfo.value}`,
		),
	});
	enhanced.stack = error.stack;
	return enhanced;
}

export function formatRequestError(error: Error): string {
	const diagnosticMessage = joinDiagnosticParts(
		error instanceof GLMRequestError
			? error.diagnosticMessage
			: `message=${safeStringify(error.message)}`,
	);
	return redactGLMImageDataUrls(
		error.stack ? `${diagnosticMessage}\n${error.stack}` : diagnosticMessage,
	);
}

export function createUserFacingError(error: Error): Error {
	const message =
		error instanceof GLMRequestError
			? formatMarkdownMessage(error.userSummary, getErrorActions(error, errorActionUrlStore.get()))
			: error.message;
	const displayError = new Error(message);
	displayError.stack = undefined;
	return displayError;
}

function getHttpErrorMessage(params: {
	status: number;
	baseUrl: string;
	businessCode?: string;
	serverMessage?: string;
}): string {
	const { status, baseUrl, businessCode, serverMessage } = params;
	const isOfficialGlm = isOfficialGLMBaseUrl(baseUrl);

	// 1) 已知业务错误码 → 使用官方错误表对应的精确文案。GLM 的服务端消息通常
	//    是 `[code][detail][request_id]` 包裹格式，detail 里包含动态参数
	//    （如重置时间），比模板更准确，所以优先透出 detail。
	if (businessCode && isOfficialGlm) {
		const definition = GLM_BUSINESS_ERROR_CODES[businessCode];
		if (definition) {
			return formatGlmBusinessMessage(definition.messageKey, businessCode, serverMessage);
		}
	}

	// 2) 官方端点 + 未知业务码 → 仍然剥离 GLM 包裹格式中的 request_id 噪音，
	//    只透出 [code][detail] 部分给用户。
	if (isOfficialGlm && serverMessage) {
		const detail = extractGlmMessageDetail(serverMessage);
		if (detail) {
			return businessCode ? `${detail} (code ${businessCode})` : `${detail} (HTTP ${status})`;
		}
		return t('error.http.withServerMessage', status, serverMessage);
	}

	// 3) 非官方端点（代理/兼容服务）→ 直接透出服务端原文。
	if (serverMessage) {
		return t('error.http.withServerMessage', status, serverMessage);
	}

	// 4) 兜底：仅有 HTTP 状态码时，使用原有的状态码泛化文案。
	return getHttpStatusMessage(status, baseUrl);
}

/**
 * Render a GLM business-code message.
 *
 * Strategy (most → least specific):
 *  1. If the server returned a wrapped `[code][detail][request_id]` payload,
 *     surface `detail` directly — it already contains the dynamic parameters
 *     (e.g. the reset timestamp) and is more accurate than any templated text.
 *  2. Otherwise fall back to the dictionary entry. Templates that contain a
 *     `{0}` placeholder are rendered with the truncated raw server message;
 *     templates without placeholders are rendered verbatim.
 *
 * The numeric business code is always appended at the end so the user can
 * quote it when contacting support.
 */
function formatGlmBusinessMessage(
	messageKey: string,
	businessCode: string,
	serverMessage?: string,
): string {
	const detail = extractGlmMessageDetail(serverMessage);
	const dictionaryMessage = t(messageKey);

	// Prefer the concrete server-side detail when available.
	if (detail) {
		return `${detail} (code ${businessCode})`;
	}

	// Otherwise render the dictionary entry. If the template declares a `{0}`
	// placeholder, substitute the raw server message (truncated) into it.
	const template = dictionaryMessage.replace(/\{0\}/g, () =>
		serverMessage ? truncateSingleLine(serverMessage) : '',
	);
	return `${template} (code ${businessCode})`;
}

/**
 * Pull the human-readable portion out of GLM's wrapped message format.
 *
 * GLM typically returns messages as `[code][human readable detail][request_id]`.
 * The trailing `[request_id]` is internal noise; the leading `[code]` duplicates
 * `businessCode`. This returns the middle part when the pattern matches, and
 * otherwise returns the original message (truncated to one line).
 */
function extractGlmMessageDetail(serverMessage: string | undefined): string | undefined {
	if (!serverMessage) {
		return undefined;
	}

	// Match `[NNNN][...anything without new brackets...][request_id-like token]`.
	// The middle group is what we want to surface to the user.
	const match = serverMessage.match(/^\s*\[(\d+)\]\s*\[([^\]]+)\]\s*\[[^\]]+\]\s*$/);
	if (match) {
		return match[2].trim();
	}

	const trimmed = serverMessage.trim();
	return trimmed.length > 0 ? truncateSingleLine(trimmed) : undefined;
}

function getHttpStatusMessage(status: number, baseUrl: string): string {
	const createApiKeyUrl = getCreateApiKeyUrl(status, baseUrl);
	switch (status) {
		case 400:
			return t('error.http.400', status);
		case 401:
			return createApiKeyUrl
				? t('error.http.401.withCreateApiKeyLink', status, createApiKeyUrl)
				: t('error.http.401', status);
		case 402:
			return t('error.http.402', status);
		case 422:
			return t('error.http.422', status);
		case 429:
			return t('error.http.429', status);
		case 500:
			return t('error.http.500', status);
		case 503:
			return t('error.http.503', status);
		default:
			return t('error.http.generic', status);
	}
}

function parseServerErrorResponse(responseText: string): unknown {
	const trimmed = responseText.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function extractBusinessCode(parsed: unknown): string | undefined {
	if (!parsed || typeof parsed !== 'object') {
		return undefined;
	}

	const error = getObjectProperty(parsed, 'error');
	const code =
		getStringProperty(error, 'code') ??
		getStringProperty(parsed, 'code') ??
		getStringProperty(error, 'type');

	// Anthropic-compatible responses sometimes put the GLM numeric code inside
	// `error.code` as a string, and a non-numeric type in `error.type`
	// (e.g. "rate_limit_error"). Only return the numeric GLM business code.
	if (code && /^\d+$/.test(code)) {
		return code;
	}
	return undefined;
}

function extractServerMessage(parsed: unknown, responseText: string): string | undefined {
	if (!parsed) {
		const trimmed = responseText.trim();
		return trimmed ? truncateSingleLine(trimmed) : undefined;
	}

	const error = getObjectProperty(parsed, 'error');
	const message =
		getStringProperty(error, 'message') ??
		getStringProperty(parsed, 'message') ??
		(typeof error === 'string' ? error : undefined);
	return message ? truncateSingleLine(message) : undefined;
}

function getObjectProperty(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
	const property = getObjectProperty(value, key);
	return typeof property === 'string' && property.length > 0 ? property : undefined;
}

function formatMarkdownMessage(
	summary: string,
	actions: readonly ErrorActionLink[] | undefined = undefined,
): string {
	const formattedSummary = `**${escapeBoldText(summary)}**`;
	const actionLinks = actions?.map(formatActionLink).join(' · ');
	return actionLinks
		? [formattedSummary + '\\', '\\', `**${actionLinks}**`].join('\n')
		: formattedSummary;
}

function formatActionLink(action: ErrorActionLink): string {
	return `[${t(action.labelKey)}](${action.url})`;
}

function getErrorActions(
	error: GLMRequestError,
	actionUrls: ErrorActionUrls,
): readonly ErrorActionLink[] {
	if (error.kind === 'http' && error.status !== undefined && error.baseUrl) {
		return getHttpErrorActions(error, actionUrls);
	}

	return getDiagnosticErrorActions(actionUrls);
}

function getHttpErrorActions(
	error: GLMRequestError,
	actionUrls: ErrorActionUrls,
): readonly ErrorActionLink[] {
	const status = error.status;
	const baseUrl = error.baseUrl;
	if (status === undefined || baseUrl === undefined) {
		return getDiagnosticErrorActions(actionUrls);
	}

	// 1) GLM 业务错误码 → 字典可能定义了精确的动作（充值 / 续订 / 解除限制 等）。
	const businessAction = getGlmBusinessCodeAction(error.businessCode, baseUrl, actionUrls);
	if (businessAction) {
		return [...businessAction, ...getDiagnosticErrorActions(actionUrls)];
	}

	// 2) 兜底：基于 HTTP 状态码的通用动作（401 → 设置/创建 API Key、5xx → 状态页）。
	return [
		...getUniversalHttpErrorActions(status, actionUrls),
		...getProviderHttpErrorActions(status, baseUrl),
		...getDiagnosticErrorActions(actionUrls),
	];
}

function getGlmBusinessCodeAction(
	businessCode: string | undefined,
	baseUrl: string,
	actionUrls: ErrorActionUrls,
): readonly ErrorActionLink[] | undefined {
	if (!businessCode || !isOfficialGLMBaseUrl(baseUrl)) {
		return undefined;
	}
	const definition = GLM_BUSINESS_ERROR_CODES[businessCode];
	if (!definition?.action) {
		return undefined;
	}

	// 1000 / 1001 → 本地设置 API Key 命令优先于外部跳转。
	const url = resolveBusinessActionUrl(
		definition.action.labelKey,
		definition.action.url,
		actionUrls,
	);
	return url ? [{ labelKey: definition.action.labelKey, url }] : [];
}

function resolveBusinessActionUrl(
	labelKey: string,
	url: string,
	actionUrls: ErrorActionUrls,
): string | undefined {
	switch (labelKey) {
		case 'error.action.setApiKey':
			return actionUrls.configureApiKey;
		case 'error.action.viewDetails':
			return actionUrls.showLogs;
		default:
			return url || undefined;
	}
}

function getUniversalHttpErrorActions(
	status: number,
	actionUrls: ErrorActionUrls,
): readonly ErrorActionLink[] {
	const url = actionUrls.configureApiKey;
	return status === 401 && url ? [{ labelKey: 'error.action.setApiKey', url }] : [];
}

function getProviderHttpErrorActions(status: number, baseUrl: string): readonly ErrorActionLink[] {
	if (status === 401) {
		return [];
	}

	const link = getProviderHttpErrorLink(status, baseUrl);
	return link ? [{ labelKey: link.labelKey, url: link.url }] : [];
}

function getProviderHttpErrorLink(
	status: number,
	baseUrl: string,
): HttpErrorLinkDefinition | undefined {
	const providerId = identifyApiProvider(baseUrl);
	const statusKey = getHttpErrorLinkStatusKey(status);
	return providerId && statusKey ? API_PROVIDER_HTTP_ERROR_LINKS[statusKey][providerId] : undefined;
}

function getCreateApiKeyUrl(status: number, baseUrl: string): string | undefined {
	return status === 401 ? getProviderHttpErrorLink(status, baseUrl)?.url : undefined;
}

function getDiagnosticErrorActions(actionUrls: ErrorActionUrls): readonly ErrorActionLink[] {
	const url = actionUrls.showLogs;
	return url ? [{ labelKey: 'error.action.viewDetails', url }] : [];
}

function getRequestDiagnosticMessage(context: RequestErrorContext): string {
	const { request } = context;
	// Strip query parameters from the baseUrl before logging to prevent
	// accidental leakage of tokens/secrets embedded in proxy URLs.
	const safeBaseUrl = stripQueryParams(context.baseUrl);
	return joinDiagnosticParts(
		`baseUrl=${safeStringify(safeBaseUrl)}`,
		`model=${safeStringify(request.model)}`,
		`stream=${request.stream}`,
		request.temperature !== undefined ? `temperature=${request.temperature}` : undefined,
		request.top_p !== undefined ? `topP=${request.top_p}` : undefined,
		request.max_tokens !== undefined ? `maxTokens=${request.max_tokens}` : undefined,
		request.thinking?.type ? `thinking=${safeStringify(request.thinking.type)}` : undefined,
		request.reasoning_effort
			? `reasoningEffort=${safeStringify(request.reasoning_effort)}`
			: undefined,
		request.tool_choice ? `toolChoice=${safeStringify(request.tool_choice)}` : undefined,
		`toolCount=${request.tools?.length ?? 0}`,
		`messageCount=${request.messages.length}`,
		`messageChars=${request.messages.reduce(
			(total, message) => total + getGLMContentText(message.content).length,
			0,
		)}`,
	);
}

function joinDiagnosticParts(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(' ');
}

function truncateSingleLine(value: string): string {
	const singleLine = value.replace(/\s+/g, ' ').trim();
	return singleLine.length > MAX_DIAGNOSTIC_FIELD_LENGTH
		? `${singleLine.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH)}...`
		: singleLine;
}

function escapeBoldText(value: string): string {
	return value.replace(/\*/g, '\\*');
}

function identifyApiProvider(baseUrl: string): ApiProviderId | undefined {
	return isOfficialGLMBaseUrl(baseUrl) ? 'glm' : undefined;
}

function getHttpErrorLinkStatusKey(status: number): HttpErrorLinkStatusKey | undefined {
	if (status === 401 || status === 402) {
		return status;
	}

	return status >= 500 && status <= 599 ? '5xx' : undefined;
}

/**
 * Strip query parameters from a URL to prevent accidental leakage of
 * tokens/secrets that may be embedded in proxy URLs.
 */
function stripQueryParams(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.search = '';
		parsed.hash = '';
		return parsed.toString();
	} catch {
		return url;
	}
}
