import vscode from 'vscode';
import { AuthManager } from '../auth';
import { GLMClient } from '../client';
import {
	findModelDefinition,
	getApiModelId,
	getMaxTokens,
	getModelVisionMode,
	resolveModelConnection,
} from '../config';
import { isOfficialGLMBaseUrl } from '../endpoint';
import { t } from '../i18n';
import type {
	ApiMode,
	GLMMessage,
	GLMRequest,
	ModelDefinition,
	ModelVisionMode,
	PricingCurrency,
	ResolvedModelConnection,
} from '../types';
import { convertMessages, countRequestPromptChars } from './convert';
import {
	dumpGLMRequest,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
	type RequestDumpRun,
} from './debug';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import { getPricingCurrencyForBaseUrl } from './pricing/currency';
import type { ReplayMarkerMetadata } from './replay';
import { classifyGLMRequest, shouldForceThinkingNone, type RequestKind } from './routing';
import type { ConversationSegment } from './segment';
import { collectTrailingToolResultIds, prepareRequestTools } from './tools/request';
import { resolveImageMessages, type VisionDescriber } from './vision';

export interface PreparedChatRequest {
	client: GLMClient;
	request: GLMRequest;
	isThinkingModel: boolean;
	promptChars: number;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	requestKind: RequestKind;
	apiMode?: ApiMode;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	modelDefinition?: ModelDefinition;
	pricingCurrency?: PricingCurrency;
	visionMarkerTextChars?: number;
	initialResponseNotice?: string;
	requestDump?: RequestDumpRun;
	visionMode: ModelVisionMode;
	nativeImageParts: number;
	nativeImageBytes: number;
	connection: ResolvedModelConnection;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
	configurationResource?: vscode.Uri;
	modelInfo: vscode.LanguageModelChatInformation;
	segment: ConversationSegment;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
	cacheDiagnostics: CacheDiagnosticsRecorder;
	getVisionDescriber: () => Promise<VisionDescriber | undefined>;
}

export async function prepareChatRequest({
	authManager,
	globalStorageUri,
	configurationResource,
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionDescriber,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const connection = resolveModelConnection(modelInfo.id, configurationResource);
	const apiKey = await authManager.getApiKey(connection.credentialChannel, configurationResource);
	if (!apiKey) {
		throw new Error(t('auth.notConfiguredForChannel', connection.credentialChannel));
	}

	const { baseUrl, protocol: apiProtocol } = connection;
	const client = new GLMClient(baseUrl, apiKey, apiProtocol);
	const modelDef = findModelDefinition(modelInfo.id, configurationResource);
	const isThinkingModel = modelDef?.capabilities.thinking ?? false;
	const maxTokens = getMaxTokens();
	const apiModelId = getApiModelId(modelInfo.id, configurationResource);
	const visionMode = getModelVisionMode(modelInfo.id, configurationResource);

	const visionResolution = await resolveImageMessages(
		messages,
		token,
		getVisionDescriber,
		visionMode,
	);
	const resolvedMessages = visionResolution.messages;
	const glmMessages = convertMessages(resolvedMessages, isThinkingModel);
	// [FORK] Inject the image-handling system instruction in mcp vision mode
	// UNCONDITIONALLY — every turn, whether or not this request carries images.
	// Reason: prompt caching matches a byte-exact message PREFIX, and the system
	// message sits at the very front of that prefix. If injection flipped on/off
	// between image-bearing and text-only turns, the prefix would change and
	// every flip would invalidate the cache for the WHOLE conversation. Keeping
	// the instruction always-present makes it a permanent part of the cacheable
	// prefix, so multi-turn conversations keep hitting cache regardless of which
	// turns carry images. (The ~1KB instruction is itself cached, so its cost on
	// pure-text turns is negligible.) proxy/native modes never inject: images
	// are already converted to text/base64 there, and injecting would add noise
	// and break upstream's request-shape assertions.
	if (visionMode === 'mcp') {
		injectImageToolGuidance(glmMessages);
	}
	const tools = prepareRequestTools(modelDef?.capabilities.toolCalling, options);

	const baseRequest: GLMRequest = {
		model: apiModelId,
		messages: glmMessages,
		stream: true,
		stream_options: { include_usage: true },
		tools,
		tool_choice: tools && tools.length > 0 ? ('auto' as const) : undefined,
		tool_stream: tools && tools.length > 0 ? true : undefined,
		max_tokens: maxTokens,
	};
	const requestKind = classifyGLMRequest({
		request: baseRequest,
		inputMessages: messages,
	});
	const configuredThinkingEffort = getConfiguredThinkingEffort(
		options as ModelConfigurationOptions,
	);
	// Only force helper requests into disabled thinking on the official API.
	// Custom endpoints keep their configured effort to preserve pre-#137 request shape.
	const forceNoneThinking = shouldForceThinkingNone(requestKind) && isOfficialGLMBaseUrl(baseUrl);
	const thinkingEffort = forceNoneThinking ? 'none' : configuredThinkingEffort;
	const supportsReasoningEffort = modelDef?.supportsReasoningEffort ?? false;
	const request: GLMRequest = {
		...baseRequest,
		...(isThinkingModel
			? {
					thinking: {
						type: thinkingEffort === 'none' ? ('disabled' as const) : ('enabled' as const),
						...(thinkingEffort === 'none' ? {} : { clear_thinking: false }),
					},
					...(thinkingEffort !== 'none' && supportsReasoningEffort
						? { reasoning_effort: thinkingEffort }
						: {}),
				}
			: {}),
	};
	const promptChars = countRequestPromptChars(request);
	const requestDump = dumpGLMRequest(request, {
		globalStorageUri,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
		visionMode,
		connection,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
		visionMode,
		connection,
	});

	return {
		client,
		request,
		isThinkingModel,
		promptChars,
		trailingToolResultIds: collectTrailingToolResultIds(glmMessages),
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		apiMode: connection.apiMode,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		modelDefinition: modelDef,
		pricingCurrency: connection.pricingCurrency ?? getPricingCurrencyForBaseUrl(baseUrl),
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
		initialResponseNotice: visionResolution.initialResponseNotice,
		requestDump,
		visionMode,
		nativeImageParts: visionResolution.stats.nativeImageParts,
		nativeImageBytes: visionResolution.stats.nativeImageBytes,
		connection,
	};
}

// ---- [FORK] Image-handling system instruction injection ----

/**
 * Default value for the image handling system instruction. Keep in sync with
 * `glm-copilot.imageHandlingPrompt.default` in package.json.
 */
const DEFAULT_IMAGE_HANDLING_INSTRUCTION =
	'[Image Handling]\n' +
	'Attached images are stored as local files; their paths appear in the conversation as "[Image attached at local file: <path>]". ' +
	'You cannot see images inline — they must be read through an image-capable MCP tool. ' +
	'The file name is a content hash, so the same path always refers to the same image.\n\n' +
	'Before reading an image, check whether this conversation already contains an analysis of it ' +
	'(a prior image-tool result, or the one-line digest you emit after analyzing). ' +
	'Reuse that analysis whenever it already answers the user\'s current question — do not re-read out of habit. ' +
	'Read the image again only when:\n' +
	'(a) it has not been analyzed yet in this conversation;\n' +
	'(b) the current question needs detail the prior analysis did not cover; or\n' +
	'(c) the image may have changed since (for example, the user edited the UI and re-captured it).\n\n' +
	'After you read an image, end with a one-line digest so later turns can reuse it without re-reading:\n' +
	'[Image digest | <label/path> | <type: ui-mockup | error-screenshot | diagram | …> | <key facts: layout, colors, text, sizes, errors> | <open questions>]\n' +
	'Keep it to one line — it is an index, not a full description; update it if you re-read and learn more.\n\n' +
	'Never invent the contents of an image you have not actually read — if analysis is needed and none exists yet, call the tool. ' +
	'If a read fails, returns nothing useful, or leaves you uncertain, say so explicitly rather than guessing; ' +
	'the user must be able to tell when your understanding of an image may be wrong.\n\n' +
	'When the images at hand are stale, missing, or do not show the current state of the problem — ' +
	'for example the user has changed the code and is now reporting a visual bug, or a screenshot is too low-resolution to read an error — ' +
	'ask the user for a fresh, specific screenshot to ground your diagnosis. ' +
	'Ask only when a new capture would actually change your next step; otherwise proceed from what you have and state your assumptions. ' +
	'Request something concrete (the current top nav, the full error dialog with its stack trace), not a vague "send a screenshot".\n\n' +
	'Choose the most appropriate image tool for the image type and the user\'s intent, and call it directly — ' +
	'do not mention tool names in your reply unless you are invoking that tool.\n\n';

/**
 * Read the user-configurable image handling instruction from settings.
 * Falls back to the built-in default when unset or empty.
 */
function getImageHandlingInstruction(): string {
	const config = vscode.workspace.getConfiguration('glm-copilot');
	return (
		config.get<string>('imageHandlingPrompt', DEFAULT_IMAGE_HANDLING_INSTRUCTION) ||
		DEFAULT_IMAGE_HANDLING_INSTRUCTION
	);
}

/**
 * Prepend the image-handling instruction to the system message (or insert a
 * new system message at the front if none exists). Done before building the
 * request body so the instruction becomes part of the stable cacheable prefix.
 */
function injectImageToolGuidance(messages: GLMMessage[]): void {
	const instruction = getImageHandlingInstruction();
	const systemMessage = messages.find((m) => m.role === 'system');
	if (systemMessage && typeof systemMessage.content === 'string') {
		systemMessage.content = instruction + systemMessage.content;
	} else {
		messages.unshift({
			role: 'system',
			content: instruction.trimEnd(),
		});
	}
}
