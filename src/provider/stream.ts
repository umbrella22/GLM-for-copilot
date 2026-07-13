import vscode from 'vscode';
import { createUserFacingError } from '../client';
import { logger } from '../logger';
import type { GLMToolCall, GLMUsage } from '../types';
import {
	observeCancellationToken,
	type CacheDiagnosticsRun,
	type ReplayMarkerReportTrigger,
} from './debug';
import {
	estimateUsageCost,
	formatUsageCostEstimate,
	type UsageCostEstimate,
} from './pricing/usage';
import { resolveContextUsage } from './context-usage';
import {
	createReplayMarkerPart,
	hasReplayMarkerMetadata,
	type ReplayMarkerMetadata,
} from './replay';
import type { PreparedChatRequest } from './request';
import { formatRequestLogLine, type RequestKind } from './routing';

interface ResponseStreamState {
	accumulatedReasoning: string;
	emittedToolCallIds: string[];
	initialResponseNoticeReported: boolean;
	replayMarkerReported: boolean;
	/** Whether any model-generated text or tool call has been reported to VS Code. */
	hasModelOutput: boolean;
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

export function streamChatCompletion({
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
		hasModelOutput: false,
	};
	const cancelListener = observeCancellationToken(token, prepared.cacheDiagnostics);

	return prepared.client
		.streamChatCompletion(
			prepared.request,
			{
				onContent: (content: string) => {
					state.hasModelOutput = true;
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					progress.report(new vscode.LanguageModelTextPart(content));
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
					if (!state.hasModelOutput) {
						throw new Error(
							'Model returned an empty response with no text or tool calls. ' +
								'This may indicate an API issue or the model refused to answer.',
						);
					}
					reportReplayMarkerOnce(prepared, progress, state, 'done');
					finalizeReplayDiagnostics(
						prepared.trailingToolResultIds,
						state,
						prepared.cacheDiagnostics,
					);
				},

				onUsage: (usage) => {
					const currentCharsPerToken = getCharsPerToken();
					const contextUsage = resolveContextUsage(
						usage,
						prepared.totalRequestChars,
						currentCharsPerToken,
					);
					const charsPerToken = updateCharsPerToken(
						prepared.totalRequestChars,
						usage,
						currentCharsPerToken,
					);
					const costEstimate = estimateUsageCost(
						prepared.modelDefinition,
						prepared.pricingCurrency,
						contextUsage.usage,
					);
					setCharsPerToken(charsPerToken);
					prepared.cacheDiagnostics.onUsage(usage, charsPerToken);
					if (contextUsage.promptTokenSource === 'estimate') {
						logger.info(
							formatRequestLogLine(
								prepared.requestKind,
								`provider reported zero prompt tokens; estimated ${contextUsage.usage.prompt_tokens} for Copilot context usage`,
							),
						);
					}
					reportUsageCost(prepared.requestKind, costEstimate, onUsageCost);
					reportCopilotContextUsage(
						progress,
						contextUsage.usage,
						prepared.requestKind,
						costEstimate,
					);
				},
			},
			token,
		)
		.then(undefined, (error) => {
			reportSkippedReplayMarkerIfNeeded(
				prepared,
				state,
				token.isCancellationRequested ? 'cancelled' : 'stream-error',
				error,
			);
			throw error;
		})
		.then(() => {
			if (token.isCancellationRequested) {
				reportSkippedReplayMarkerIfNeeded(prepared, state, 'cancelled');
			}
		})
		.finally(() => {
			cancelListener.dispose();
		});
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
	progress.report(new vscode.LanguageModelTextPart(initialResponseNotice));
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
	prepared.cacheDiagnostics.onReplayMarkerReport({
		status: 'skipped',
		reason,
		visionTextChars: prepared.visionMarkerTextChars,
		reasoningTextChars: state.accumulatedReasoning.length || undefined,
		error,
	});
}

function reportReplayMarker(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	const metadata = getReplayMarkerMetadata(prepared, state);
	if (!hasReplayMarkerMetadata(metadata)) {
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'skipped',
			trigger,
			reason: 'no-replay-data',
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
		});
		return;
	}

	try {
		const markerPart = createReplayMarkerPart(metadata);
		progress.report(markerPart);
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'reported',
			trigger,
			markerBytes: markerPart.data.byteLength,
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
		});
	} catch (error) {
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'failed',
			trigger,
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
			error,
		});
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

	const thinkingPart = createThinkingPart(text);
	if (thinkingPart) {
		progress.report(thinkingPart);
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

	try {
		const parsed = JSON.parse(toolCall.function.arguments);
		// JSON.parse can return a non-object value (e.g. null, true, 42,
		// "hello") without throwing.  VS Code requires the third argument
		// to LanguageModelToolCallPart to be an object.
		const args =
			typeof parsed === 'object' && parsed !== null
				? (parsed as Record<string, unknown>)
				: { _raw: toolCall.function.arguments };
		progress.report(
			new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
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
		progress.report(
			new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {
				_raw: toolCall.function.arguments,
			}),
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

function updateCharsPerToken(
	totalRequestChars: number,
	usage: GLMUsage,
	charsPerToken: number,
): number {
	if (totalRequestChars > 0 && usage.prompt_tokens > 0) {
		const observedRatio = totalRequestChars / usage.prompt_tokens;
		return charsPerToken * 0.7 + observedRatio * 0.3;
	}
	return charsPerToken;
}

function reportCopilotContextUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	usage: GLMUsage,
	requestKind: RequestKind,
	costEstimate: UsageCostEstimate | undefined,
): void {
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
		progress.report(
			new vscode.LanguageModelDataPart(
				new TextEncoder().encode(JSON.stringify(data)),
				COPILOT_USAGE_DATA_PART_MIME,
			),
		);
	} catch (error) {
		logger.warn(formatRequestLogLine(requestKind, 'Failed to report usage data'), error);
	}
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
