import vscode from 'vscode';
import { AuthManager } from '../auth';
import { GLMClient } from '../client';
import {
	findModelDefinition,
	getApiModelId,
	getApiProtocol,
	getBaseUrl,
	getMaxTokens,
} from '../config';
import { identifyOfficialGLMApiMode, isOfficialGLMBaseUrl } from '../endpoint';
import { t } from '../i18n';
import type { ApiMode, GLMRequest, ModelDefinition, PricingCurrency } from '../types';
import { convertMessages, countMessageChars } from './convert';
import { dumpGLMRequest, type CacheDiagnosticsRecorder, type CacheDiagnosticsRun } from './debug';
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
	totalRequestChars: number;
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
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
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
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionDescriber,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const baseUrl = getBaseUrl();
	const apiProtocol = getApiProtocol();
	const client = new GLMClient(baseUrl, apiKey, apiProtocol);
	const modelDef = findModelDefinition(modelInfo.id);
	const isThinkingModel = modelDef?.capabilities.thinking ?? false;
	const maxTokens = getMaxTokens();
	const apiModelId = getApiModelId(modelInfo.id);

	const visionResolution = await resolveImageMessages(messages, token, getVisionDescriber);
	const resolvedMessages = visionResolution.messages;
	const glmMessages = convertMessages(resolvedMessages, isThinkingModel);
	const tools = prepareRequestTools(modelDef?.capabilities.toolCalling, options);

	const totalRequestChars = countMessageChars(glmMessages);
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
	dumpGLMRequest(request, {
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
	});

	return {
		client,
		request,
		isThinkingModel,
		totalRequestChars,
		trailingToolResultIds: collectTrailingToolResultIds(glmMessages),
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		apiMode: identifyOfficialGLMApiMode(baseUrl),
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		modelDefinition: modelDef,
		pricingCurrency: getPricingCurrencyForBaseUrl(baseUrl),
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
		initialResponseNotice: visionResolution.initialResponseNotice,
	};
}
