/**
 * Shared types for the GLM Copilot extension.
 */

// ---- API request/response types ----

/** OpenAI-compatible multimodal text segment. */
export interface GLMTextContentPart {
	type: 'text';
	text: string;
}

/** OpenAI-compatible image segment backed by a generated data URL. */
export interface GLMImageContentPart {
	type: 'image_url';
	image_url: {
		url: string;
	};
}

export type GLMMessageContent = string | Array<GLMTextContentPart | GLMImageContentPart>;

export interface GLMMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: GLMMessageContent;
	tool_call_id?: string;
	tool_calls?: GLMToolCall[];
	reasoning_content?: string;
}

export interface GLMToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface GLMTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface GLMUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
	prompt_tokens_details?: {
		cached_tokens?: number;
	};
}

export interface GLMRequest {
	model: string;
	messages: GLMMessage[];
	stream: boolean;
	stream_options?: { include_usage?: boolean };
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	tools?: GLMTool[];
	tool_choice?: 'none' | 'auto' | 'required';
	thinking?: { type: 'enabled' | 'disabled'; clear_thinking?: boolean };
	reasoning_effort?: 'high' | 'max';
	tool_stream?: boolean;
}

export interface GLMStreamChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning_content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: GLMUsage;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: GLMToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: GLMUsage) => void;
}

// ---- Configuration types ----

export type ApiMode = 'coding-plan' | 'standard';

export type ApiRegion = 'china' | 'international';

export type ApiProtocol = 'openai' | 'anthropic';

/**
 * Single-value endpoint selector that folds the legacy
 * (region, apiMode, apiProtocol) tuple into one enum.
 *
 * Each value uniquely resolves to a base URL + wire protocol, so users pick
 * exactly what they want from one dropdown instead of three interacting ones.
 */
export type EndpointPreset =
	| 'china-coding'
	| 'china-standard'
	| 'china-anthropic'
	| 'international-coding'
	| 'international-standard'
	| 'international-anthropic';

/** Credential identity is owned by billing region/mode, not wire protocol. */
export type CredentialChannel =
	| 'china-coding'
	| 'china-standard'
	| 'international-coding'
	| 'international-standard';

/** How a VS Code model selects an upstream GLM endpoint. */
export type ModelEndpointRoute = 'default' | 'same-region-standard' | EndpointPreset;

export interface ResolvedModelConnection {
	route: ModelEndpointRoute;
	endpoint: EndpointPreset;
	baseUrl: string;
	protocol: ApiProtocol;
	apiMode?: ApiMode;
	credentialChannel: CredentialChannel;
	pricingCurrency?: PricingCurrency;
	usesGlobalBaseUrlOverride: boolean;
}

/**
 * How image attachments reach the model selected in Copilot.
 *
 * - `proxy`: built-in GLM-4.6V-Flash transparent proxy converts images to text.
 * - `native`: images are resized and sent as base64 directly to the API model.
 * - `mcp` [FORK]: images are stripped from the request and persisted to disk;
 *   a short text prompt with the file path is left in their place so an
 *   image-capable MCP tool can read them by path. Designed for text-only
 *   models (e.g. a Claude-compatible text model behind the Anthropic endpoint)
 *   where injecting base64 would waste context without any benefit.
 */
export type ModelVisionMode = 'proxy' | 'native' | 'mcp'; // [FORK] +mcp

export type CustomModelConfigEntry = string | CustomModelConfig;

export interface CustomModelConfig {
	id?: string;
	name?: string;
	/** Shared prompt + completion window. Takes precedence over maxInputTokens when valid. */
	contextWindowTokens?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	toolCalling?: boolean;
	thinking?: boolean;
}

export interface ModelManagementModelConfiguration {
	apiModelId?: string;
	endpointRoute?: ModelEndpointRoute;
	visionMode?: ModelVisionMode;
}

/** Versioned configuration owned by the model management UI. */
export interface ModelManagementConfigurationV1 {
	version: 1;
	defaultConnection?: {
		endpoint?: EndpointPreset;
		/** An empty string explicitly disables an inherited custom base URL. */
		baseUrl?: string;
	};
	models?: Record<string, ModelManagementModelConfiguration>;
	/** A null entry removes an inherited custom model with the same ID. */
	customModels?: Record<string, CustomModelConfig | null>;
}

// ---- Model definitions ----

export type PricingCurrency = 'USD' | 'CNY';

export type PriceCategory = 'low' | 'medium' | 'high' | 'very_high';

export interface ModelPricing {
	cacheHitInput: number;
	cacheMissInput: number;
	output: number;
	tiers?: readonly ModelPricingTier[];
}

export interface ModelPricingTier {
	label: string;
	minPromptTokens?: number;
	maxPromptTokens?: number;
	cacheHitInput: number;
	cacheMissInput: number;
	output: number;
}

export interface ModelDefinition {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: {
		toolCalling: boolean | number;
		imageInput: boolean;
		thinking: boolean;
	};
	requiresThinkingParam: boolean;
	defaultEndpointRoute?: ModelEndpointRoute;
	supportedApiModes?: readonly ApiMode[];
	defaultVisionMode?: ModelVisionMode;
	supportsReasoningEffort?: boolean;
	pricing?: Readonly<Record<PricingCurrency, ModelPricing>>;
	priceCategory?: PriceCategory;
}
