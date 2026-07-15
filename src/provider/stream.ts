import vscode from 'vscode';
import { createUserFacingError } from '../client';
import { logger } from '../logger';
import type { GLMToolCall, GLMUsage } from '../types';
import { DEFAULT_CHARS_PER_TOKEN, resolveContextUsage } from './context-usage';
import {
	observeCancellationToken,
	type CacheDiagnosticsRun,
	type ContextUsageReportInfo,
	type ReportedResponsePartKind,
	type ReplayMarkerReportInfo,
	type ReplayMarkerReportTrigger,
	type ResponseOutcomeInfo,
} from './debug';
import {
	estimateUsageCost,
	formatUsageCostEstimate,
	type UsageCostEstimate,
} from './pricing/usage';
import {
	createReplayMarkerPart,
	hasReplayMarkerMetadata,
	type ReplayMarkerMetadata,
	type ReplayMarkerPayload,
} from './replay';
import type { PreparedChatRequest } from './request';
import { formatRequestLogLine, type RequestKind } from './routing';

interface ResponseStreamState {
	accumulatedReasoning: string;
	emittedToolCallIds: string[];
	initialResponseNoticeReported: boolean;
	replayMarkerReported: boolean;
	doneObserved: boolean;
	/** Whether any model-generated text or tool call has been reported to VS Code. */
	hasModelOutput: boolean;
	textChars: number;
	reasoningChars: number;
	toolCalls: number;
	toolCallChars: number;
	latestProviderUsage?: GLMUsage;
	providerUsageCallbacks: number;
	contextUsageReport?: ContextUsageReportInfo;
	replayMarkerReport?: ReplayMarkerReportInfo;
	reportedPartCount: number;
	lastReportedPart?: ReportedResponsePartKind;
}

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

export interface StreamChatCompletionOptions {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	initialResponseNotice?: string;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
	onUsageCost?: (estimate: UsageCostEstimate) => void;
}

export async function streamChatCompletion({
	prepared,
	progress,
	token,
	initialResponseNotice,
	getCharsPerToken,
	setCharsPerToken,
	onUsageCost,
}: StreamChatCompletionOptions): Promise<void> {
	const state: ResponseStreamState = {
		accumulatedReasoning: '',
		emittedToolCallIds: [],
		initialResponseNoticeReported: false,
		replayMarkerReported: false,
		doneObserved: false,
		hasModelOutput: false,
		textChars: 0,
		reasoningChars: 0,
		toolCalls: 0,
		toolCallChars: 0,
		providerUsageCallbacks: 0,
		reportedPartCount: 0,
	};
	const cancelListener = observeCancellationToken(token, prepared.cacheDiagnostics);
	const startedAtMs = Date.now();
	const startedAt = new Date(startedAtMs).toISOString();
	let clientSettlement: ResponseOutcomeInfo['clientSettlement'] | undefined;
	let status: ResponseOutcomeInfo['status'] = 'stream-error';
	let cancellationAtSettlement = false;
	let terminalError: unknown;

	try {
		await prepared.client.streamChatCompletion(
			prepared.request,
			{
				onContent: (content: string) => {
					state.hasModelOutput = true;
					state.textChars += content.length;
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					reportResponsePart(progress, state, new vscode.LanguageModelTextPart(content), 'text');
				},

				onThinking: (text: string) => {
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					handleThinking(text, state, progress);
				},

				onToolCall: (toolCall: GLMToolCall) => {
					state.hasModelOutput = true;
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					handleToolCall(toolCall, state, progress);
				},

				onError: (error: Error) => {
					throw createUserFacingError(error);
				},

				onDone: () => {
					state.doneObserved = true;
				},

				onUsage: (usage) => {
					state.latestProviderUsage = usage;
					state.providerUsageCallbacks += 1;
				},
			},
			token,
		);
		clientSettlement = 'fulfilled';
		cancellationAtSettlement = token.isCancellationRequested;

		if (token.isCancellationRequested) {
			status = 'cancelled';
			reportSkippedContextUsageIfNeeded(prepared, state, 'cancelled');
			reportSkippedReplayMarkerIfNeeded(prepared, state, 'cancelled');
			return;
		}
		if (!state.doneObserved) {
			throw new Error('Model stream resolved without a completion signal.');
		}
		if (!state.hasModelOutput) {
			throw new Error(
				'Model returned an empty response with no text or tool calls. ' +
					'This may indicate an API issue or the model refused to answer.',
			);
		}

		finalizeContextUsage({
			prepared,
			progress,
			state,
			getCharsPerToken,
			setCharsPerToken,
			onUsageCost,
		});
		reportReplayMarkerOnce(prepared, progress, state, 'done');
		finalizeReplayDiagnostics(prepared.trailingToolResultIds, state, prepared.cacheDiagnostics);
		status = 'completed';
	} catch (error) {
		terminalError = error;
		if (!clientSettlement) {
			clientSettlement = 'rejected';
			cancellationAtSettlement = token.isCancellationRequested;
		}
		status = token.isCancellationRequested ? 'cancelled' : 'stream-error';
		reportSkippedContextUsageIfNeeded(
			prepared,
			state,
			status === 'cancelled' ? 'cancelled' : 'stream-error',
			error,
		);
		reportSkippedReplayMarkerIfNeeded(
			prepared,
			state,
			status === 'cancelled' ? 'cancelled' : 'stream-error',
			error,
		);
		throw error;
	} finally {
		cancelListener.dispose();
		const outcome = createResponseOutcome({
			prepared,
			state,
			startedAt,
			startedAtMs,
			status,
			clientSettlement: clientSettlement ?? 'rejected',
			cancellationAtSettlement,
			cancelledAtOutcome: token.isCancellationRequested,
			error: terminalError,
		});
		prepared.cacheDiagnostics.onResponseOutcome(outcome);
		prepared.requestDump?.finish(outcome);
	}
}

function reportInitialResponseNoticeOnce(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	initialResponseNotice: string | undefined,
): void {
	if (!initialResponseNotice || state.initialResponseNoticeReported) {
		return;
	}
	state.initialResponseNoticeReported = true;
	reportResponsePart(
		progress,
		state,
		new vscode.LanguageModelTextPart(initialResponseNotice),
		'notice',
	);
}

function reportReplayMarkerOnce(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	if (state.replayMarkerReported) {
		return;
	}
	state.replayMarkerReported = true;
	reportReplayMarker(prepared, progress, state, trigger);
}

function reportSkippedReplayMarkerIfNeeded(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
	reason: 'cancelled' | 'stream-error',
	error?: unknown,
): void {
	if (state.replayMarkerReported) {
		return;
	}
	state.replayMarkerReported = true;
	const report: ReplayMarkerReportInfo = {
		status: 'skipped',
		reason,
		visionTextChars: prepared.visionMarkerTextChars,
		reasoningTextChars: state.accumulatedReasoning.length || undefined,
		error,
	};
	state.replayMarkerReport = report;
	prepared.cacheDiagnostics.onReplayMarkerReport(report);
}

function reportReplayMarker(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	const metadata = getReplayMarkerMetadata(prepared, state);
	const payload: ReplayMarkerPayload = {
		segmentId: prepared.segment.segmentId,
		...metadata,
	};

	try {
		const markerPart = createReplayMarkerPart(payload);
		const reportOrdinal = reportResponsePart(progress, state, markerPart, 'marker');
		const report: ReplayMarkerReportInfo = {
			status: 'reported',
			trigger,
			reportOrdinal,
			markerBytes: markerPart.data.byteLength,
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
			segmentOnly: !hasReplayMarkerMetadata(metadata),
		};
		state.replayMarkerReport = report;
		prepared.cacheDiagnostics.onReplayMarkerReport(report);
	} catch (error) {
		const report: ReplayMarkerReportInfo = {
			status: 'failed',
			trigger,
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
			error,
		};
		state.replayMarkerReport = report;
		prepared.cacheDiagnostics.onReplayMarkerReport(report);
		logger.warn(
			formatRequestLogLine(prepared.requestKind, 'Failed to report replay marker'),
			error,
		);
	}
}

function getReplayMarkerMetadata(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
): ReplayMarkerMetadata {
	return {
		...prepared.replayMarkerMetadata,
		reasoningText: state.accumulatedReasoning || undefined,
	};
}

function handleThinking(
	text: string,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	state.accumulatedReasoning += text;
	state.reasoningChars += text.length;

	const thinkingPart = createThinkingPart(text);
	if (thinkingPart) {
		reportResponsePart(progress, state, thinkingPart, 'thinking');
	}
}

function createThinkingPart(text: string): vscode.LanguageModelResponsePart | undefined {
	const ThinkingPart = (
		vscode as unknown as {
			LanguageModelThinkingPart?: new (value: string) => vscode.LanguageModelResponsePart;
		}
	).LanguageModelThinkingPart;
	return typeof ThinkingPart === 'function' ? new ThinkingPart(text) : undefined;
}

function handleToolCall(
	toolCall: GLMToolCall,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	state.emittedToolCallIds.push(toolCall.id);
	state.toolCalls += 1;
	state.toolCallChars +=
		toolCall.id.length + toolCall.function.name.length + toolCall.function.arguments.length;

	try {
		const parsed = JSON.parse(toolCall.function.arguments);
		// JSON.parse can return a non-object value (e.g. null, true, 42,
		// "hello") without throwing.  VS Code requires the third argument
		// to LanguageModelToolCallPart to be an object.
		const args =
			typeof parsed === 'object' && parsed !== null
				? (parsed as Record<string, unknown>)
				: { _raw: toolCall.function.arguments };
		reportResponsePart(
			progress,
			state,
			new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
			'tool-call',
		);
	} catch {
		// The model returned malformed tool-call arguments.  Report the raw
		// string so the tool can attempt recovery; silently passing `{}` would
		// mask the underlying issue and produce confusing tool failures.
		const rawArgs =
			typeof toolCall.function.arguments === 'string'
				? toolCall.function.arguments.slice(0, 200)
				: String(toolCall.function.arguments ?? '').slice(0, 200);
		logger.warn(`Failed to parse tool-call arguments for "${toolCall.function.name}":`, rawArgs);
		reportResponsePart(
			progress,
			state,
			new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {
				_raw: toolCall.function.arguments,
			}),
			'tool-call',
		);
	}
}

function finalizeReplayDiagnostics(
	trailingToolResultIds: readonly string[],
	state: ResponseStreamState,
	cacheDiagnostics: CacheDiagnosticsRun,
): void {
	cacheDiagnostics.onDone({
		reasoningTextChars: state.accumulatedReasoning.length,
		emittedToolCalls: state.emittedToolCallIds.length,
		trailingToolResults: trailingToolResultIds.length,
	});
}

function finalizeContextUsage(options: {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	state: ResponseStreamState;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
	onUsageCost: ((estimate: UsageCostEstimate) => void) | undefined;
}): void {
	const { prepared, progress, state, getCharsPerToken, setCharsPerToken, onUsageCost } = options;
	const currentCharsPerToken = getCharsPerToken();
	const contextUsage = resolveContextUsage(
		state.latestProviderUsage,
		prepared.promptChars,
		state.textChars + state.reasoningChars + getToolCallChars(state),
		currentCharsPerToken,
	);
	let charsPerToken = currentCharsPerToken;
	if (state.latestProviderUsage) {
		charsPerToken = updateCharsPerToken(
			prepared.promptChars,
			state.latestProviderUsage,
			currentCharsPerToken,
		);
		setCharsPerToken(charsPerToken);
		prepared.cacheDiagnostics.onUsage(state.latestProviderUsage, charsPerToken);
	}

	if (contextUsage.source !== 'provider') {
		logger.info(
			formatRequestLogLine(
				prepared.requestKind,
				`estimated Copilot context usage source=${contextUsage.source}` +
					` prompt=${contextUsage.usage.prompt_tokens}` +
					` completion=${contextUsage.usage.completion_tokens}`,
			),
		);
	}

	const costEstimate = state.latestProviderUsage
		? estimateUsageCost(prepared.modelDefinition, prepared.pricingCurrency, contextUsage.usage)
		: undefined;
	reportUsageCost(prepared.requestKind, costEstimate, onUsageCost);
	const reportResult = reportCopilotContextUsage(
		progress,
		state,
		contextUsage.usage,
		prepared.requestKind,
		costEstimate,
	);
	const report: ContextUsageReportInfo = {
		...reportResult,
		providerUsageObserved: state.latestProviderUsage !== undefined,
		providerCallbackCount: state.providerUsageCallbacks,
		nativeImageParts: prepared.nativeImageParts,
		nativeImageBytes: prepared.nativeImageBytes,
		imageTokenSource: getImageTokenSource(prepared, state),
		source: contextUsage.source,
		promptTokenSource: contextUsage.promptTokenSource,
		completionTokenSource: contextUsage.completionTokenSource,
		usage: contextUsage.usage,
	};
	state.contextUsageReport = report;
	prepared.cacheDiagnostics.onContextUsageReport(report);
}

function reportSkippedContextUsageIfNeeded(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
	reason: 'cancelled' | 'stream-error',
	error?: unknown,
): void {
	if (state.contextUsageReport) {
		return;
	}
	const report: ContextUsageReportInfo = {
		status: 'skipped',
		reason,
		providerUsageObserved: state.latestProviderUsage !== undefined,
		providerCallbackCount: state.providerUsageCallbacks,
		nativeImageParts: prepared.nativeImageParts,
		nativeImageBytes: prepared.nativeImageBytes,
		imageTokenSource: getImageTokenSource(prepared, state),
		error,
	};
	state.contextUsageReport = report;
	prepared.cacheDiagnostics.onContextUsageReport(report);
}

function getImageTokenSource(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
): 'none' | 'provider' | 'unknown' {
	if (prepared.nativeImageParts === 0) {
		return 'none';
	}
	return state.latestProviderUsage ? 'provider' : 'unknown';
}

function updateCharsPerToken(promptChars: number, usage: GLMUsage, charsPerToken: number): number {
	if (promptChars > 0 && Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens > 0) {
		const observedRatio = promptChars / usage.prompt_tokens;
		const currentRatio =
			Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
		return currentRatio * 0.7 + observedRatio * 0.3;
	}
	return charsPerToken;
}

function reportCopilotContextUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	usage: GLMUsage,
	requestKind: RequestKind,
	costEstimate: UsageCostEstimate | undefined,
): Pick<ContextUsageReportInfo, 'status' | 'error' | 'reportOrdinal'> {
	const rawCached =
		usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
	const cachedTokens = Math.max(0, Math.min(rawCached, Math.max(usage.prompt_tokens, 0)));
	const data = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		prompt_tokens_details: {
			cached_tokens: cachedTokens,
		},
		...(costEstimate
			? {
					estimated_cost: {
						currency: costEstimate.currency,
						total: costEstimate.totalCost,
						input: costEstimate.inputCost,
						output: costEstimate.outputCost,
						unit: 'per_1m_tokens',
						pricing: costEstimate.pricing,
					},
				}
			: {}),
	};

	try {
		const reportOrdinal = reportResponsePart(
			progress,
			state,
			new vscode.LanguageModelDataPart(
				new TextEncoder().encode(JSON.stringify(data)),
				COPILOT_USAGE_DATA_PART_MIME,
			),
			'usage',
		);
		return { status: 'reported', reportOrdinal };
	} catch (error) {
		logger.warn(formatRequestLogLine(requestKind, 'Failed to report usage data'), error);
		return { status: 'failed', error };
	}
}

function reportResponsePart(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	part: vscode.LanguageModelResponsePart,
	kind: ReportedResponsePartKind,
): number {
	progress.report(part);
	state.reportedPartCount += 1;
	state.lastReportedPart = kind;
	return state.reportedPartCount;
}

function getToolCallChars(state: ResponseStreamState): number {
	return state.toolCallChars;
}

function createResponseOutcome(options: {
	prepared: PreparedChatRequest;
	state: ResponseStreamState;
	startedAt: string;
	startedAtMs: number;
	status: ResponseOutcomeInfo['status'];
	clientSettlement: ResponseOutcomeInfo['clientSettlement'];
	cancellationAtSettlement: boolean;
	cancelledAtOutcome: boolean;
	error: unknown;
}): ResponseOutcomeInfo {
	const completedAtMs = Date.now();
	const skippedReason = options.status === 'cancelled' ? 'cancelled' : 'stream-error';
	return {
		startedAt: options.startedAt,
		completedAt: new Date(completedAtMs).toISOString(),
		durationMs: completedAtMs - options.startedAtMs,
		status: options.status,
		clientSettlement: options.clientSettlement,
		doneObserved: options.state.doneObserved,
		cancellation: {
			requestedAtSettlement: options.cancellationAtSettlement,
			requestedAtOutcome: options.cancelledAtOutcome,
		},
		output: {
			textChars: options.state.textChars,
			reasoningChars: options.state.reasoningChars,
			toolCalls: options.state.toolCalls,
			reportedPartCount: options.state.reportedPartCount,
			lastReportedPart: options.state.lastReportedPart,
		},
		contextUsage: options.state.contextUsageReport ?? {
			status: 'skipped',
			reason: skippedReason,
			providerUsageObserved: options.state.latestProviderUsage !== undefined,
			providerCallbackCount: options.state.providerUsageCallbacks,
			nativeImageParts: options.prepared.nativeImageParts,
			nativeImageBytes: options.prepared.nativeImageBytes,
			imageTokenSource: getImageTokenSource(options.prepared, options.state),
		},
		replayMarker: options.state.replayMarkerReport ?? {
			status: 'skipped',
			reason: skippedReason,
		},
		...(options.error ? { error: options.error } : {}),
	};
}

function reportUsageCost(
	requestKind: RequestKind,
	estimate: UsageCostEstimate | undefined,
	onUsageCost: ((estimate: UsageCostEstimate) => void) | undefined,
): void {
	if (!estimate) {
		return;
	}

	logger.info(
		formatRequestLogLine(
			requestKind,
			`estimated cost: ${estimate.modelId} ${formatUsageCostEstimate(estimate)}`,
		),
	);

	try {
		onUsageCost?.(estimate);
	} catch (error) {
		logger.warn(formatRequestLogLine(requestKind, 'Failed to update usage status'), error);
	}
}
