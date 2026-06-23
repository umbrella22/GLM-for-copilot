import vscode from 'vscode';
import { t } from '../../i18n';
import type { GLMMessage, GLMTool } from '../../types';
import { convertTools } from '../convert';
import { GLM_TOOLS_LIMIT } from './consts';

export function prepareRequestTools(
	toolCallingCapability: boolean | number | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): GLMTool[] | undefined {
	const tools = toolCallingCapability ? convertTools(options.tools) : undefined;
	const toolLimit = getToolCallingLimit(toolCallingCapability);
	const toolsCount = tools?.length ?? 0;
	if (toolsCount > toolLimit) {
		throw new Error(t('request.toolsLimitExceeded', toolLimit, toolsCount));
	}
	return tools;
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

function getToolCallingLimit(toolCallingCapability: boolean | number | undefined): number {
	return typeof toolCallingCapability === 'number' ? toolCallingCapability : GLM_TOOLS_LIMIT;
}
