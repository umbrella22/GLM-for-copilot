import { DEFAULT_GLM_BASE_URL } from './endpoint';
import { GLM_TOOLS_LIMIT } from './provider/tools/consts';
import { DEFAULT_GLM_VISION_MODEL_ID } from './provider/vision/consts';
import type { CredentialChannel, ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'glm-copilot';

export const EXTERNAL_URLS = {
	glm: {
		apiKeys: 'https://www.bigmodel.cn/usercenter/proj-mgmt/apikeys',
		usage: 'https://www.bigmodel.cn/usercenter/resourcepack',
		status: 'https://docs.bigmodel.cn/cn/api/status-code/status-code-v4',
		// 1113 账户欠费、402 余额不足 等场景的充值入口。
		topUp: 'https://www.bigmodel.cn/usercenter/proj-mgmt/resourcepack',
		// 1309 GLM Coding Plan 套餐到期、1311 套餐未包含模型 等场景的续订入口。
		codingPlan: 'https://bigmodel.cn/claude-code',
		// 1313 公平使用策略被限制时的解除入口（个人中心-编程套餐总览）。
		fairUsePolicy: 'https://www.bigmodel.cn/usercenter/valuepack',
	},
} as const;

export { DEFAULT_GLM_BASE_URL };

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

/** URI path handled by this extension to open vision model configuration. */
export const SET_VISION_MODEL_URI_PATH = '/setVisionModel';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Secret keys ----

/** SecretStorage key for the GLM API key. */
export const API_KEY_SECRET = 'glm-copilot.apiKey';

export const API_KEY_SECRETS: Readonly<Record<CredentialChannel, string>> = {
	'china-coding': 'glm-copilot.apiKey.china-coding',
	'china-standard': 'glm-copilot.apiKey.china-standard',
	'international-coding': 'glm-copilot.apiKey.international-coding',
	'international-standard': 'glm-copilot.apiKey.international-standard',
};

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'glm-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'umbrella22.glm-for-copilot#glmGettingStarted';

// ---- Model registry ----

/** Available GLM models exposed through the language model provider. */
export const MODELS: ModelDefinition[] = [
	{
		id: 'glm-5.2',
		name: 'GLM-5.2',
		family: 'glm',
		version: '5.2',
		detail: 'Flagship coding and reasoning model',
		// Copilot treats input + output as one shared context window.
		maxInputTokens: 868_928,
		maxOutputTokens: 131_072,
		capabilities: {
			toolCalling: GLM_TOOLS_LIMIT,
			// The extension accepts images for this model through the transparent
			// GLM-4.6V-Flash vision proxy before sending text to GLM-5.2.
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		supportsReasoningEffort: true,
		// [FORK] default to mcp vision mode: images are stripped to disk and read
		// by MCP tools, not via the built-in proxy. Upstream's effective-config
		// resolution does not read package.json `default`, so this must be set
		// on the model definition itself for the fallback path to return 'mcp'.
		defaultVisionMode: 'mcp',
		pricing: {
			CNY: { cacheHitInput: 2, cacheMissInput: 8, output: 28 },
			USD: { cacheHitInput: 0.26, cacheMissInput: 1.4, output: 4.4 },
		},
		priceCategory: 'high',
	},
	{
		id: DEFAULT_GLM_VISION_MODEL_ID,
		name: 'GLM-4.6V-Flash',
		family: 'glm',
		version: '4.6v',
		detail: 'Multimodal GLM model for image understanding',
		maxInputTokens: 98_304,
		maxOutputTokens: 32_768,
		capabilities: {
			toolCalling: GLM_TOOLS_LIMIT,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		defaultVisionMode: 'native',
		pricing: {
			CNY: { cacheHitInput: 0, cacheMissInput: 0, output: 0 },
			USD: { cacheHitInput: 0, cacheMissInput: 0, output: 0 },
		},
		priceCategory: 'low',
	},
	{
		id: 'glm-5v-turbo',
		name: 'GLM-5V-Turbo',
		family: 'glm',
		version: '5v',
		detail: 'Multimodal coding model for visual agent workflows',
		// Official 200K shared context with up to 128K output.
		maxInputTokens: 68_928,
		maxOutputTokens: 131_072,
		capabilities: {
			toolCalling: GLM_TOOLS_LIMIT,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		defaultEndpointRoute: 'same-region-standard',
		// [FORK] removed `supportedApiModes: ['standard']` so glm-5v-turbo can use
		// all routes including Coding Plan. The author's Coding Plan works with
		// this model in practice; official restriction expected to lift.
		defaultVisionMode: 'native',
		pricing: {
			CNY: {
				cacheHitInput: 1.2,
				cacheMissInput: 5,
				output: 22,
				tiers: [
					{
						label: 'prompt < 32K',
						maxPromptTokens: 32_000,
						cacheHitInput: 1.2,
						cacheMissInput: 5,
						output: 22,
					},
					{
						label: 'prompt >= 32K',
						minPromptTokens: 32_000,
						cacheHitInput: 1.8,
						cacheMissInput: 7,
						output: 26,
					},
				],
			},
			USD: { cacheHitInput: 0.24, cacheMissInput: 1.2, output: 4 },
		},
		priceCategory: 'medium',
	},
	{
		id: 'glm-5-turbo',
		name: 'GLM-5-Turbo',
		family: 'glm',
		version: '5',
		detail: 'Fast coding model for daily agent work',
		maxInputTokens: 68_928,
		maxOutputTokens: 131_072,
		capabilities: {
			toolCalling: GLM_TOOLS_LIMIT,
			// Image input is handled by the transparent GLM-4.6V-Flash vision proxy.
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		// [FORK] default to mcp vision mode (same rationale as glm-5.2 above).
		defaultVisionMode: 'mcp',
		pricing: {
			CNY: {
				cacheHitInput: 1.2,
				cacheMissInput: 5,
				output: 22,
				tiers: [
					{
						label: 'prompt < 32K',
						maxPromptTokens: 32_000,
						cacheHitInput: 1.2,
						cacheMissInput: 5,
						output: 22,
					},
					{
						label: 'prompt >= 32K',
						minPromptTokens: 32_000,
						cacheHitInput: 1.8,
						cacheMissInput: 7,
						output: 26,
					},
				],
			},
			USD: { cacheHitInput: 0.24, cacheMissInput: 1.2, output: 4 },
		},
		priceCategory: 'medium',
	},
];
