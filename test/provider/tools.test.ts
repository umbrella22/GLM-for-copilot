import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import {
	collectTrailingToolResultIds,
	prepareRequestTools,
} from '../../src/provider/tools/request';
import type { GLMMessage } from '../../src/types';

function tool(name: string): vscode.LanguageModelChatTool {
	return {
		name,
		description: `${name} description`,
		inputSchema: { type: 'object' },
	} as vscode.LanguageModelChatTool;
}

describe('tool request helpers', () => {
	it('does not send tools when the model has no tool-calling capability', () => {
		expect(
			prepareRequestTools(false, {
				tools: [tool('search')],
			} as vscode.ProvideLanguageModelChatResponseOptions),
		).toBeUndefined();
	});

	it('converts tools when tool calling is enabled', () => {
		expect(
			prepareRequestTools(true, {
				tools: [tool('search')],
			} as vscode.ProvideLanguageModelChatResponseOptions),
		).toEqual([
			{
				type: 'function',
				function: {
					name: 'search',
					description: 'search description',
					parameters: { type: 'object' },
				},
			},
		]);
	});

	it('enforces numeric tool limits', () => {
		expect(() =>
			prepareRequestTools(1, {
				tools: [tool('one'), tool('two')],
			} as vscode.ProvideLanguageModelChatResponseOptions),
		).toThrow('GLM supports at most 1 functions');
	});

	it('collects only trailing tool result ids', () => {
		const messages: GLMMessage[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'tool', content: 'old', tool_call_id: 'old-call' },
			{ role: 'assistant', content: 'answer' },
			{ role: 'tool', content: 'first', tool_call_id: 'call-1' },
			{ role: 'tool', content: 'second', tool_call_id: 'call-2' },
		];

		expect(collectTrailingToolResultIds(messages)).toEqual(['call-1', 'call-2']);
		expect(collectTrailingToolResultIds([{ role: 'user', content: 'done' }])).toEqual([]);
	});
});
