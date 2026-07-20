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
import { createVisionProxyFallbackNotice } from './tools/notices';
import { resolveImageMessages, type VisionDescriber } from './vision';
import {
	hasImageCapableTool,
	readImageCapableToolOverrides,
	stripImageCapableToolsFromOptions,
} from './vision/image-capable-tools';

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
	const imageCapableOverrides = readImageCapableToolOverrides();
	// Count image parts once; shared by the PR #18 strip filter below and the
	// mcp-mode fallback guard further down (bb53f52 made detection image-count aware).
	const imageCount = messages.reduce(
		(count, message) =>
			count +
			(message.content as readonly vscode.LanguageModelInputPart[]).filter(
				(p) => p instanceof vscode.LanguageModelDataPart && p.mimeType.startsWith('image/'),
			).length,
		0,
	);
	// Build initial tools from the raw options. The mcp-mode guard below needs
	// them to decide toolCallingOff; the PR #18 strip filter further down may
	// rebuild tools from filtered options once the EFFECTIVE vision mode settles.
	let tools = prepareRequestTools(modelDef?.capabilities.toolCalling, options);

	// [FORK] MCP vision mode guard (PR #15 Finding 2).
	//
	// MCP mode strips images to disk and leaves a file-path prompt, relying on
	// an image-capable MCP tool to read them back. The earlier guard only
	// checked "any tool exists", so a session with only ordinary tools (search,
	// terminal, edits) would pass, images would be stripped, and the model
	// would have no reader — a silent loss.
	//
	// Now we check for an ACTUAL image-capable tool from its input schema or an
	// exact user override. When the request carries images but no image-capable
	// tool is available, we must NOT silently strip. Resolution order:
	//   1. tool calling off entirely -> throw the original conflict error
	//      (images can never reach a tool in this session)
	//   2. tools exist but none is image-capable -> try to fall back to the
	//      vision proxy so images are still described; NEVER fall back to
	//      native — that would inject base64 into a text-only model context,
	//      which is exactly what mcp mode was chosen to avoid
	//   3. no proxy available either -> throw a clear error telling the user
	//      the three ways out (enable a vision MCP tool / configure a proxy /
	//      switch to native if the model supports it)
	let effectiveVisionMode = visionMode;
	let mcpFallbackNotice: string | undefined;
	if (visionMode === 'mcp' && imageCount > 0) {
		const toolCallingOff = !tools || tools.length === 0;
		const hasVisionTool =
			!toolCallingOff && hasImageCapableTool(options, imageCapableOverrides, imageCount);
		if (!hasVisionTool) {
			if (toolCallingOff) {
				// Case 1: no tools at all — nothing can read the image under any mode.
				throw new Error(t('vision.mcp.conflict.toolCallingDisabled'));
			}
			// Case 2: tools exist but none is image-capable. Try proxy fallback.
			const proxyDescriber = await getVisionDescriber();
			if (proxyDescriber) {
				effectiveVisionMode = 'proxy';
				mcpFallbackNotice = createVisionProxyFallbackNotice();
			} else {
				// Case 3: no vision MCP tool AND no proxy — refuse with guidance.
				throw new Error(t('vision.mcp.conflict.noImageTool'));
			}
		}
	}

	// [FORK] PR #18: strip image-capable MCP tools once the EFFECTIVE vision
	// mode is settled. native/proxy modes have their own image path (inline
	// bytes / text description); an image MCP tool is redundant there and
	// actively interferes — glm-5v-turbo gets lured into calling it instead of
	// using native vision, and hands it VS Code attachment placeholders the tool
	// cannot resolve. This also covers mcp -> proxy fallback (review issue 1):
	// proxy does not create local image files, so an image MCP tool left in the
	// list would have no readable path. Only strip when this request actually
	// carries images (rule A): a pure-text request has no image to lure the
	// model, so image-capable tools stay available for other uses.
	const shouldStripImageTools = effectiveVisionMode !== 'mcp' && imageCount > 0;
	const requestOptions = shouldStripImageTools
		? stripImageCapableToolsFromOptions(options, imageCapableOverrides)
		: options;
	if (shouldStripImageTools) {
		tools = prepareRequestTools(modelDef?.capabilities.toolCalling, requestOptions);
	}

	const visionResolution = await resolveImageMessages(
		messages,
		token,
		getVisionDescriber,
		effectiveVisionMode,
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
	// Use effectiveVisionMode so a request that fell back from mcp to proxy
	// does NOT get the mcp image-tool guidance injected (proxy already
	// described the images as text; the guidance would be noise + would
	// break prompt-cache prefix stability across mcp/fallback turns).
	if (effectiveVisionMode === 'mcp') {
		injectImageToolGuidance(glmMessages);
	}

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
		requestOptions: requestOptions,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
		visionMode: effectiveVisionMode,
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
		visionMode: effectiveVisionMode,
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
		// [FORK] Surface the mcp->proxy fallback notice alongside any notice
		// produced by vision resolution (e.g. proxy missing). Both are shown to
		// the user so they understand why the effective mode differed.
		initialResponseNotice: joinNotices(mcpFallbackNotice, visionResolution.initialResponseNotice),
		requestDump,
		// Report the EFFECTIVE mode so downstream (segment tracing, request
		// dumps, stats) reflects what actually ran, not what was configured.
		visionMode: effectiveVisionMode,
		nativeImageParts: visionResolution.stats.nativeImageParts,
		nativeImageBytes: visionResolution.stats.nativeImageBytes,
		connection,
	};
}

function joinNotices(...notices: readonly (string | undefined)[]): string | undefined {
	const joined = notices.filter((notice) => notice && notice.trim().length > 0).join('\n');
	return joined || undefined;
}

// ---- [FORK] Image-handling system instruction injection ----

/**
 * Default value for the image handling system instruction. Keep in sync with
 * `glm-copilot.imageHandlingPrompt.default` in package.json.
 */
export const DEFAULT_IMAGE_HANDLING_INSTRUCTION =
	'[Image Handling]\n' +
	'Attached images are stored as local files; their paths appear in the conversation as "[Image attached at local file: <path>]". ' +
	'You cannot see images inline — they must be processed through an image-capable MCP tool. ' +
	'The file name is a content hash, so the same path always refers to the same image.\n\n' +
	'Before processing an image, decide whether you can reuse an existing analysis or must process it again. ' +
	'The decision has TWO dimensions, checked in this order:\n\n' +
	'(1) Output-type match (PRIMARY). Every image task has an output type — what the user wants back. ' +
	"Common output types (non-exhaustive; infer from the user's goal, not from keywords): " +
	'understand/describe (what is in this image), convert/generate (turn this UI into code, prompt, or spec), ' +
	'compare (design vs implementation, find differences), extract (text/code/error from a screenshot), ' +
	'diagnose (error screenshot, stack trace), or general/uncertain. ' +
	"Reusing a prior analysis is valid only when the current task's output type MATCHES the output type that analysis was produced for. " +
	"If the user's requested output type differs from what the prior analysis/digest supports — " +
	'for example you previously described the image (understand) and now the user asks you to replicate it into code (convert/generate) — ' +
	'you MUST NOT reuse the description; choose the tool best matched to the new output type and process the image again, ' +
	'even if you already know the image contents well. ' +
	'The trigger is the output type changing, NOT the image changing and NOT missing detail.\n\n' +
	'(2) Information sufficiency within the same output type (SECONDARY). Only when the output type matches, then reuse unless one of:\n' +
	'(a) it has not been processed for this output type in this conversation;\n' +
	'(b) the current question needs detail the prior analysis did not cover; or\n' +
	'(c) the image may have changed since (for example, the user edited the UI and re-captured it).\n' +
	'When in doubt about output type, treat it as not-yet-processed and process with the most appropriate tool.\n\n' +
	"For the FIRST analysis of an image (no prior analysis exists), choose the tool best matched to the task's output type directly — " +
	'do not default to a general-purpose tool when a more specific tool fits the intent.\n\n' +
	'After you process an image, end with a one-line digest so later turns can reuse it without re-processing:\n' +
	'[Image digest | <label/path> | <image type: ui-mockup | error-screenshot | diagram | …> | <output type: understand | convert | compare | extract | diagnose | …> | <key facts: layout, colors, text, sizes, errors> | <open questions>]\n' +
	'Keep it to one line — it is an index, not a full description. ' +
	'The <output type> field records which output type this analysis was produced for, so later turns can apply the match rule above. ' +
	'Update it if you re-process for a different output type (emit a new digest for the new output type; ' +
	'do not overwrite the old one if both may be reused).\n\n' +
	'Never invent the contents of an image you have not actually processed — if analysis is needed and none exists yet, call the tool. ' +
	'If processing fails, returns nothing useful, or leaves you uncertain, say so explicitly rather than guessing; ' +
	'the user must be able to tell when your understanding of an image may be wrong.\n\n' +
	'When the images at hand are stale, missing, or do not show the current state of the problem — ' +
	'for example the user has changed the code and is now reporting a visual bug, or a screenshot is too low-resolution to read an error — ' +
	'ask the user for a fresh, specific screenshot to ground your diagnosis. ' +
	'Ask only when a new capture would actually change your next step; otherwise proceed from what you have and state your assumptions. ' +
	'Request something concrete (the current top nav, the full error dialog with its stack trace), not a vague "send a screenshot".\n\n' +
	'Call the most appropriate image tool directly — ' +
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
		systemMessage.content = `${instruction.trimEnd()}\n\n${systemMessage.content}`;
	} else {
		messages.unshift({
			role: 'system',
			content: instruction.trimEnd(),
		});
	}
}
