import vscode from 'vscode';
import type { GLMMessage, GLMTool } from '../../types';
import { convertTools } from '../convert';

export function prepareRequestTools(
	toolCallingCapability: boolean | number | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): GLMTool[] | undefined {
	// No client-side tool-count cap: the host decides how many tools to send.
	// A numeric capability still just means "tool calling enabled".
	return toolCallingCapability ? convertTools(options.tools) : undefined;
}

export function collectTrailingToolResultIds(messages: readonly GLMMessage[]): string[] {
	const trailingToolResultIds: string[] = [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== 'tool' || !message.tool_call_id) {
			break;
		}
		trailingToolResultIds.push(message.tool_call_id);
	}
	return trailingToolResultIds.reverse();
}
