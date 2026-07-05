import { EXTERNAL_URLS } from '../consts';
import type {
	ApiProviderId,
	HttpErrorLinkDefinition,
	HttpErrorLinkStatusKey,
	NetworkErrorCategory,
} from './types';

export const MAX_DIAGNOSTIC_FIELD_LENGTH = 300;

export const API_PROVIDER_HTTP_ERROR_LINKS: Readonly<
	Record<HttpErrorLinkStatusKey, Readonly<Partial<Record<ApiProviderId, HttpErrorLinkDefinition>>>>
> = {
	401: {
		glm: {
			labelKey: 'error.action.createApiKey',
			url: EXTERNAL_URLS.glm.apiKeys,
		},
	},
	402: {
		glm: {
			labelKey: 'error.action.viewUsage',
			url: EXTERNAL_URLS.glm.usage,
		},
	},
	'5xx': {
		glm: {
			labelKey: 'error.action.checkGLMStatus',
			url: EXTERNAL_URLS.glm.status,
		},
	},
};

/**
 * GLM business error codes returned inside the response body.
 *
 * Source: https://docs.bigmodel.cn/cn/faq/api-code
 *
 * Each entry maps a numeric business code to:
 *  - `messageKey`: i18n key of the precise user-facing description
 *  - `action`: optional action link shown to the user
 *
 * When the server returns one of these codes, the dedicated message wins over
 * the generic HTTP status text, so the user sees something actionable like
 * "已达到 5 小时使用上限，将于 14:21:10 重置" instead of a vague "请求过快".
 */
export interface GlmBusinessErrorDefinition {
	messageKey: string;
	action?: { labelKey: string; url: string };
}

export const GLM_BUSINESS_ERROR_CODES: Readonly<Record<string, GlmBusinessErrorDefinition>> = {
	// ---- 鉴权 / 身份验证 (401) ----
	'1000': {
		messageKey: 'error.glm.1000',
		action: { labelKey: 'error.action.setApiKey', url: '' },
	},
	'1001': {
		messageKey: 'error.glm.1001',
		action: {
			labelKey: 'error.action.createApiKey',
			url: EXTERNAL_URLS.glm.apiKeys,
		},
	},
	'1003': {
		messageKey: 'error.glm.1003',
		action: {
			labelKey: 'error.action.createApiKey',
			url: EXTERNAL_URLS.glm.apiKeys,
		},
	},
	'1005': { messageKey: 'error.glm.1005' },

	// ---- 速率 / 配额限制 (429) ----
	'1113': {
		messageKey: 'error.glm.1113',
		action: { labelKey: 'error.action.topUp', url: EXTERNAL_URLS.glm.topUp },
	},
	'1302': { messageKey: 'error.glm.1302' },
	'1305': { messageKey: 'error.glm.1305' },
	'1308': { messageKey: 'error.glm.1308' },
	'1309': {
		messageKey: 'error.glm.1309',
		action: {
			labelKey: 'error.action.renewCodingPlan',
			url: EXTERNAL_URLS.glm.codingPlan,
		},
	},
	'1310': { messageKey: 'error.glm.1310' },
	'1311': {
		messageKey: 'error.glm.1311',
		action: {
			labelKey: 'error.action.renewCodingPlan',
			url: EXTERNAL_URLS.glm.codingPlan,
		},
	},
	'1313': {
		messageKey: 'error.glm.1313',
		action: {
			labelKey: 'error.action.fairUsePolicy',
			url: EXTERNAL_URLS.glm.fairUsePolicy,
		},
	},
	'1314': { messageKey: 'error.glm.1314' },
	'1315': {
		messageKey: 'error.glm.1315',
		action: {
			labelKey: 'error.action.createApiKey',
			url: EXTERNAL_URLS.glm.apiKeys,
		},
	},
	'1316': {
		messageKey: 'error.glm.1316',
		action: { labelKey: 'error.action.topUp', url: EXTERNAL_URLS.glm.topUp },
	},
	'1317': {
		messageKey: 'error.glm.1317',
		action: { labelKey: 'error.action.topUp', url: EXTERNAL_URLS.glm.topUp },
	},
	'1318': { messageKey: 'error.glm.1318' },
	'1319': { messageKey: 'error.glm.1319' },
	'1320': { messageKey: 'error.glm.1320' },
	'1321': { messageKey: 'error.glm.1321' },

	// ---- 参数 / 模型 (400) ----
	'1210': { messageKey: 'error.glm.1210' },
	'1211': { messageKey: 'error.glm.1211' },
	'1212': { messageKey: 'error.glm.1212' },
	'1213': { messageKey: 'error.glm.1213' },
	'1214': { messageKey: 'error.glm.1214' },
	'1221': { messageKey: 'error.glm.1221' },
	'1222': { messageKey: 'error.glm.1222' },
	'1261': { messageKey: 'error.glm.1261' },
	'1301': { messageKey: 'error.glm.1301' },

	// ---- 服务端错误 (500) ----
	'1200': {
		messageKey: 'error.glm.1200',
		action: {
			labelKey: 'error.action.checkGLMStatus',
			url: EXTERNAL_URLS.glm.status,
		},
	},
	'1230': {
		messageKey: 'error.glm.1230',
		action: {
			labelKey: 'error.action.checkGLMStatus',
			url: EXTERNAL_URLS.glm.status,
		},
	},
	'1234': {
		messageKey: 'error.glm.1234',
		action: {
			labelKey: 'error.action.checkGLMStatus',
			url: EXTERNAL_URLS.glm.status,
		},
	},
};

/**
 * Curated network error codes observed from Node.js fetch failures.
 *
 * Sources: Node errno / c-ares DNS codes (`NodeJS.ErrnoException.code`),
 * Node TLS/OpenSSL error codes, and undici error `code` / `name` literals
 * from the `undici-types` package bundled through `@types/node`.
 *
 * This is intentionally not exhaustive: unknown codes fall back to `generic`
 * while still being shown to the user in the error message.
 */
export const NETWORK_ERROR_CATEGORY_BY_CODE = {
	ENOTFOUND: 'dns',
	EAI_AGAIN: 'dns',
	ENODATA: 'dns',
	ESERVFAIL: 'dns',
	EFORMERR: 'dns',
	ENONAME: 'dns',
	EBADNAME: 'dns',
	EBADQUERY: 'dns',
	EBADFAMILY: 'dns',
	EBADRESP: 'dns',
	ENOTIMP: 'dns',
	EREFUSED: 'dns',
	ENOTINITIALIZED: 'dns',
	ELOADIPHLPAPI: 'dns',
	EADDRGETNETWORKPARAMS: 'dns',
	ECONNREFUSED: 'unreachable',
	ENETUNREACH: 'unreachable',
	EHOSTUNREACH: 'unreachable',
	EADDRNOTAVAIL: 'unreachable',
	ENETDOWN: 'unreachable',
	EHOSTDOWN: 'unreachable',
	ECONNRESET: 'interrupted',
	ECONNABORTED: 'interrupted',
	ENETRESET: 'interrupted',
	ENOTCONN: 'interrupted',
	EPIPE: 'interrupted',
	EOF: 'interrupted',
	UND_ERR_SOCKET: 'interrupted',
	SocketError: 'interrupted',
	ETIMEDOUT: 'timeout',
	ETIMEOUT: 'timeout',
	ESOCKETTIMEDOUT: 'timeout',
	UND_ERR_CONNECT_TIMEOUT: 'timeout',
	UND_ERR_HEADERS_TIMEOUT: 'timeout',
	UND_ERR_BODY_TIMEOUT: 'timeout',
	ERR_TLS_HANDSHAKE_TIMEOUT: 'timeout',
	TimeoutError: 'timeout',
	ConnectTimeoutError: 'timeout',
	HeadersTimeoutError: 'timeout',
	BodyTimeoutError: 'timeout',
	CERT_HAS_EXPIRED: 'tls',
	CERT_NOT_YET_VALID: 'tls',
	CERT_UNTRUSTED: 'tls',
	CERT_REJECTED: 'tls',
	CERT_SIGNATURE_FAILURE: 'tls',
	SELF_SIGNED_CERT_IN_CHAIN: 'tls',
	DEPTH_ZERO_SELF_SIGNED_CERT: 'tls',
	UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls',
	UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls',
	UNABLE_TO_GET_ISSUER_CERT: 'tls',
	UNABLE_TO_GET_CRL: 'tls',
	UNABLE_TO_DECRYPT_CERT_SIGNATURE: 'tls',
	UNABLE_TO_DECRYPT_CRL_SIGNATURE: 'tls',
	UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY: 'tls',
	CRL_SIGNATURE_FAILURE: 'tls',
	ERR_TLS_CERT_ALTNAME_INVALID: 'tls',
	UND_ERR_PRX_TLS: 'tls',
	SecureProxyConnectionError: 'tls',
	ABORT_ERR: 'aborted',
	AbortError: 'aborted',
	UND_ERR_ABORTED: 'aborted',
	ECANCELLED: 'aborted',
	UND_ERR_HEADERS_OVERFLOW: 'protocol',
	UND_ERR_RESPONSE: 'protocol',
	UND_ERR_REQ_CONTENT_LENGTH_MISMATCH: 'protocol',
	UND_ERR_RES_CONTENT_LENGTH_MISMATCH: 'protocol',
	UND_ERR_RES_EXCEEDED_MAX_SIZE: 'protocol',
	HTTPParserError: 'protocol',
	HeadersOverflowError: 'protocol',
	ResponseError: 'protocol',
	ResponseContentLengthMismatchError: 'protocol',
	ResponseExceededMaxSizeError: 'protocol',
	ERR_INVALID_URL: 'configuration',
	ERR_INVALID_ARG_TYPE: 'configuration',
	ERR_INVALID_ARG_VALUE: 'configuration',
	UND_ERR_INVALID_ARG: 'configuration',
	InvalidArgumentError: 'configuration',
} as const satisfies Record<string, NetworkErrorCategory>;
