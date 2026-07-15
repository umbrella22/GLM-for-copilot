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
