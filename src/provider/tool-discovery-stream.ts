import vscode from 'vscode';
import { t } from '../i18n';
import { countRequestPromptChars } from './convert';
import { REPLAY_MARKER_MIME } from './replay';
import { streamChatCompletion, type StreamChatCompletionOptions } from './stream';
import type { UsageCostEstimate } from './pricing/usage';
import type { PreparedChatRequest } from './request';
import type { GLMMessage, GLMTool } from '../types';
import {
	activateToolNames,
	collectCatalog,
	collectRecentToolNames,
	createToolDiscoveryInstruction,
	formatToolSearchResult,
	MAX_TOOL_DISCOVERY_ROUNDS,
	parseToolSearchArguments,
	searchToolCatalog,
	selectDiscoveryTools,
	TOOL_SEARCH_NAME,
} from './tools/discovery';

const COPILOT_USAGE_MIME = 'usage';

export interface ToolDiscoveryStreamOptions extends StreamChatCompletionOptions {
	activated: Set<string>;
	maxTools: number;
}

export async function streamChatCompletionWithToolDiscovery(
	options: ToolDiscoveryStreamOptions,
): Promise<void> {
	const { prepared, progress, onUsageCost, activated, maxTools, ...rest } = options;
	const result = await runToolDiscoveryRounds({
		messages: prepared.request.messages,
		tools: prepared.request.tools ?? [],
		isThinkingModel: prepared.isThinkingModel,
		activated,
		maxTools,
		runRound: async (messages, tools) => {
			const buffer: vscode.LanguageModelResponsePart[] = [];
			let cost: UsageCostEstimate | undefined;
			const roundPrepared: PreparedChatRequest = {
				...prepared,
				request: {
					...prepared.request,
					messages: [...messages],
					tools,
				},
				promptChars: countRequestPromptChars({ messages: [...messages], tools }),
			};
			await streamChatCompletion({
				...rest,
				prepared: roundPrepared,
				progress: { report: (part) => buffer.push(part) },
				onUsageCost: (estimate) => {
					cost = estimate;
				},
			});
			return { parts: buffer, cost };
		},
	});

	for (const part of result.parts) {
		progress.report(part);
	}
	if (result.cost && onUsageCost) {
		onUsageCost(result.cost);
	}
}

export interface DiscoveryRoundResult {
	parts: vscode.LanguageModelResponsePart[];
	cost?: UsageCostEstimate;
}

export type DiscoveryRoundRunner = (
	messages: readonly GLMMessage[],
	tools: GLMTool[],
) => Promise<DiscoveryRoundResult>;

export interface RunToolDiscoveryOptions {
	messages: readonly GLMMessage[];
	tools: readonly GLMTool[];
	isThinkingModel: boolean;
	activated: Set<string>;
	maxTools: number;
	runRound: DiscoveryRoundRunner;
}

/**
 * Run discovery rounds until the model produces a response that does not only
 * contain synthetic tool-search calls. Search calls are consumed internally:
 * their results become tool messages for the next round, and the matched
 * schemas are added to the activated set (LRU-bounded).
 */
export async function runToolDiscoveryRounds(
	options: RunToolDiscoveryOptions,
): Promise<DiscoveryRoundResult> {
	const catalog = collectCatalog(options.tools);
	const recent = collectRecentToolNames(options.messages);
	let messages = withDiscoveryInstruction(options.messages, options.maxTools);
	let accumulatedCost: UsageCostEstimate | undefined;
	const usageParts: Array<Record<string, unknown>> = [];

	for (let round = 0; round <= MAX_TOOL_DISCOVERY_ROUNDS; round += 1) {
		const tools = selectDiscoveryTools(options.tools, recent, options.activated, options.maxTools);
		const result = await options.runRound(messages, tools);
		accumulatedCost = addCost(accumulatedCost, result.cost);
		collectUsageParts(result.parts, usageParts);

		const searchCalls = result.parts.filter(isToolSearchCall);
		if (searchCalls.length === 0) {
			return {
				parts: mergeUsageParts(result.parts, usageParts),
				cost: accumulatedCost,
			};
		}
		if (round >= MAX_TOOL_DISCOVERY_ROUNDS) {
			throw new Error(t('request.toolDiscoveryRoundLimitExceeded', MAX_TOOL_DISCOVERY_ROUNDS));
		}

		messages = [
			...messages,
			createSearchAssistantMessage(result.parts, searchCalls, options.isThinkingModel),
		];
		for (const call of searchCalls) {
			const searchResult = searchToolCatalog(catalog, parseToolSearchArguments(call.input));
			activateToolNames(
				options.activated,
				searchResult.tools.map((tool) => tool.name),
				Math.max(0, options.maxTools - 1),
			);
			messages = [
				...messages,
				{
					role: 'tool',
					tool_call_id: call.callId,
					content: formatToolSearchResult(searchResult),
				},
			];
		}
	}

	throw new Error(t('request.toolDiscoveryRoundLimitExceeded', MAX_TOOL_DISCOVERY_ROUNDS));
}

export function isToolSearchCall(
	part: vscode.LanguageModelResponsePart,
): part is vscode.LanguageModelToolCallPart {
	return part instanceof vscode.LanguageModelToolCallPart && part.name === TOOL_SEARCH_NAME;
}

function withDiscoveryInstruction(messages: readonly GLMMessage[], maxTools: number): GLMMessage[] {
	const instruction = createToolDiscoveryInstruction(maxTools);
	const copy = [...messages];
	const systemIndex = copy.findIndex((message) => message.role === 'system');
	if (systemIndex < 0) {
		return [{ role: 'system', content: instruction }, ...copy];
	}
	const system = copy[systemIndex];
	const text = typeof system.content === 'string' ? system.content : '';
	copy[systemIndex] = {
		...system,
		content: text.length > 0 ? `${instruction}\n\n${text}` : instruction,
	};
	return copy;
}

function createSearchAssistantMessage(
	parts: readonly vscode.LanguageModelResponsePart[],
	searchCalls: readonly vscode.LanguageModelToolCallPart[],
	isThinkingModel: boolean,
): GLMMessage {
	const text = parts
		.filter(
			(part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart,
		)
		.map((part) => part.value)
		.join('');
	const thinking = parts
		.map((part) =>
			isThinkingPart(part)
				? normalizeThinkingText((part as vscode.LanguageModelThinkingPart).value)
				: '',
		)
		.join('');

	return {
		role: 'assistant',
		content: text,
		tool_calls: searchCalls.map((call) => ({
			id: call.callId,
			type: 'function' as const,
			function: {
				name: call.name,
				arguments: JSON.stringify(call.input ?? {}),
			},
		})),
		...(isThinkingModel ? { reasoning_content: thinking } : {}),
	};
}

function isThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

function collectUsageParts(
	parts: readonly vscode.LanguageModelResponsePart[],
	usageParts: Array<Record<string, unknown>>,
): void {
	for (const part of parts) {
		if (!(part instanceof vscode.LanguageModelDataPart) || part.mimeType !== COPILOT_USAGE_MIME) {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(new TextDecoder().decode(part.data));
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				usageParts.push(parsed as Record<string, unknown>);
			}
		} catch {
			// A malformed usage part should not break the response.
		}
	}
}

/** Sum usage across internal discovery rounds so Copilot sees the real totals. */
function mergeUsageParts(
	parts: readonly vscode.LanguageModelResponsePart[],
	usageParts: readonly Record<string, unknown>[],
): vscode.LanguageModelResponsePart[] {
	if (usageParts.length <= 1) {
		return [...parts];
	}
	const merged = mergeUsageRecords(usageParts);
	const encoded = new TextEncoder().encode(JSON.stringify(merged));
	const usagePart = new vscode.LanguageModelDataPart(encoded, COPILOT_USAGE_MIME);
	const result = [...parts];
	const usageIndex = result.findIndex(
		(part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === COPILOT_USAGE_MIME,
	);
	if (usageIndex >= 0) {
		result[usageIndex] = usagePart;
		return result;
	}
	const markerIndex = result.findIndex(
		(part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === REPLAY_MARKER_MIME,
	);
	if (markerIndex >= 0) {
		result.splice(markerIndex, 0, usagePart);
	} else {
		result.push(usagePart);
	}
	return result;
}

function mergeUsageRecords(
	usageParts: readonly Record<string, unknown>[],
): Record<string, unknown> {
	const last = usageParts[usageParts.length - 1] ?? {};
	const merged: Record<string, unknown> = { ...last };
	for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
		merged[key] = sumNumeric(usageParts, (usage) => numberValue(usage[key]));
	}
	const cachedTokens = sumNumeric(usageParts, (usage) =>
		numberValue(
			(usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens,
		),
	);
	const details = last.prompt_tokens_details as Record<string, unknown> | undefined;
	merged.prompt_tokens_details = { ...details, cached_tokens: cachedTokens };
	const estimatedCost = last.estimated_cost as Record<string, unknown> | undefined;
	if (estimatedCost) {
		merged.estimated_cost = {
			...estimatedCost,
			total: sumNumeric(usageParts, (usage) =>
				numberValue((usage.estimated_cost as Record<string, unknown> | undefined)?.total),
			),
			input: sumNumeric(usageParts, (usage) =>
				numberValue((usage.estimated_cost as Record<string, unknown> | undefined)?.input),
			),
			output: sumNumeric(usageParts, (usage) =>
				numberValue((usage.estimated_cost as Record<string, unknown> | undefined)?.output),
			),
		};
	}
	return merged;
}

function addCost(
	left: UsageCostEstimate | undefined,
	right: UsageCostEstimate | undefined,
): UsageCostEstimate | undefined {
	if (!left) {
		return right;
	}
	if (!right) {
		return left;
	}
	return {
		...left,
		inputCost: left.inputCost + right.inputCost,
		outputCost: left.outputCost + right.outputCost,
		totalCost: left.totalCost + right.totalCost,
		cacheHitInputTokens: left.cacheHitInputTokens + right.cacheHitInputTokens,
		cacheMissInputTokens: left.cacheMissInputTokens + right.cacheMissInputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
	};
}

function sumNumeric(
	values: readonly Record<string, unknown>[],
	read: (value: Record<string, unknown>) => number | undefined,
): number {
	let total = 0;
	for (const value of values) {
		total += read(value) ?? 0;
	}
	return total;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
