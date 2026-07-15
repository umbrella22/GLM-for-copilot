import vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../consts';
import { createGLMImageContentPart } from '../glm-content';
import { safeStringify } from '../json';
import type { GLMMessage, GLMMessageContent, GLMRequest, GLMTool, GLMToolCall } from '../types';
import { parseFirstReplayMarker } from './replay';

/**
 * Convert VS Code chat messages to GLM format.
 * Injects marker-replayed reasoning_content for assistant messages.
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	isThinkingModel: boolean,
): GLMMessage[] {
	const result: GLMMessage[] = [];

	for (const message of messages) {
		const role = mapRole(message.role);

		const contentParts: Exclude<GLMMessageContent, string> = [];
		let thinkingContent = '';
		const toolCalls: GLMToolCall[] = [];
		const toolResults: Array<{ callId: string; content: string }> = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				appendTextContentPart(contentParts, part.value);
			} else if (
				part instanceof vscode.LanguageModelDataPart &&
				part.mimeType.startsWith('image/')
			) {
				if (role !== 'user') {
					throw new Error('Native image input is only supported in user messages.');
				}
				contentParts.push(createGLMImageContentPart(part.mimeType, part.data));
			} else if (isLanguageModelThinkingPart(part)) {
				thinkingContent += normalizeThinkingPartText(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				let toolContent = '';
				for (const item of part.content) {
					if (item instanceof vscode.LanguageModelTextPart) {
						toolContent += item.value;
					}
				}
				toolResults.push({
					callId: part.callId,
					content: toolContent || safeStringify(part.content),
				});
			}
		}
		const content = getMessageContent(contentParts);

		if (role === 'assistant') {
			if (content || toolCalls.length > 0 || (isThinkingModel && thinkingContent)) {
				const replayMarker = isThinkingModel ? parseFirstReplayMarker(message) : undefined;
				const msg: GLMMessage = {
					role: 'assistant' as const,
					content: typeof content === 'string' ? content : '',
				};

				if (toolCalls.length > 0) {
					msg.tool_calls = toolCalls;
				}

				if (isThinkingModel) {
					msg.reasoning_content = getReasoningContent(replayMarker, thinkingContent);
				}

				result.push(msg);
			}
		} else {
			if (typeof content === 'string' ? content.length > 0 : content.length > 0) {
				result.push({
					role,
					content: content,
				});
			}
		}

		// Tool result messages follow their associated assistant message
		for (const tr of toolResults) {
			result.push({
				role: 'tool',
				content: tr.content,
				tool_call_id: tr.callId,
			});
		}
	}

	return result;
}

function getReasoningContent(
	replayMarker: ReturnType<typeof parseFirstReplayMarker>,
	thinkingContent: string,
): string {
	if (replayMarker?.valid && replayMarker.reasoningText) {
		return replayMarker.reasoningText;
	}
	return thinkingContent;
}

function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingPartText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			if (role === LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) {
				return 'system';
			}
			return 'user';
	}
}

/**
 * Convert VS Code tool definitions to GLM format.
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): GLMTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema as Record<string, unknown> | undefined,
		},
	}));
}

/**
 * Count total characters across all messages to calibrate chars-per-token ratio.
 */
export function countMessageChars(messages: GLMMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		total += getTextContentChars(msg.content);
		total += msg.reasoning_content?.length ?? 0;
		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				total += tc.function?.name?.length ?? 0;
				total += tc.function?.arguments?.length ?? 0;
			}
		}
	}
	return total;
}

function appendTextContentPart(
	contentParts: Exclude<GLMMessageContent, string>,
	text: string,
): void {
	const previous = contentParts.at(-1);
	if (previous?.type === 'text') {
		previous.text += text;
		return;
	}
	contentParts.push({ type: 'text', text });
}

function getMessageContent(contentParts: Exclude<GLMMessageContent, string>): GLMMessageContent {
	return contentParts.some((part) => part.type === 'image_url')
		? contentParts
		: contentParts
				.filter(
					(part): part is Extract<(typeof contentParts)[number], { type: 'text' }> =>
						part.type === 'text',
				)
				.map((part) => part.text)
				.join('');
}

function getTextContentChars(content: GLMMessageContent): number {
	return typeof content === 'string'
		? content.length
		: content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0);
}

/** Count model-visible request content for local context-usage estimation. */
export function countRequestPromptChars(request: Pick<GLMRequest, 'messages' | 'tools'>): number {
	let total = countMessageChars(request.messages);
	for (const tool of request.tools ?? []) {
		total += tool.function.name.length;
		total += tool.function.description?.length ?? 0;
		total += safeStringify(tool.function.parameters ?? {}).length;
	}
	for (const message of request.messages) {
		total += message.tool_call_id?.length ?? 0;
		for (const toolCall of message.tool_calls ?? []) {
			total += toolCall.id.length;
		}
	}
	return total;
}
