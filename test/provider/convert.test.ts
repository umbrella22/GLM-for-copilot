import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../src/consts';
import { convertMessages, convertTools, countMessageChars } from '../../src/provider/convert';
import { createReplayMarkerPart } from '../../src/provider/replay';

function message(
	role: vscode.LanguageModelChatMessageRole,
	content: readonly unknown[],
): vscode.LanguageModelChatRequestMessage {
	return { role, content } as vscode.LanguageModelChatRequestMessage;
}

describe('message and tool conversion', () => {
	it('converts user, assistant, and internal system-role text messages', () => {
		const messages = convertMessages(
			[
				message(LANGUAGE_MODEL_CHAT_SYSTEM_ROLE, [new vscode.LanguageModelTextPart('system')]),
				message(vscode.LanguageModelChatMessageRole.User, [
					new vscode.LanguageModelTextPart('hello'),
				]),
				message(vscode.LanguageModelChatMessageRole.Assistant, [
					new vscode.LanguageModelTextPart('world'),
				]),
			],
			false,
		);

		expect(messages).toEqual([
			{ role: 'system', content: 'system' },
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'world' },
		]);
	});

	it('converts assistant tool calls and following tool results', () => {
		const messages = convertMessages(
			[
				message(vscode.LanguageModelChatMessageRole.Assistant, [
					new vscode.LanguageModelTextPart('calling'),
					new vscode.LanguageModelToolCallPart('call-1', 'read_file', {
						path: 'README.md',
					}),
				]),
				message(vscode.LanguageModelChatMessageRole.User, [
					new vscode.LanguageModelToolResultPart('call-1', [
						new vscode.LanguageModelTextPart('file contents'),
					]),
				]),
			],
			false,
		);

		expect(messages).toEqual([
			{
				role: 'assistant',
				content: 'calling',
				tool_calls: [
					{
						id: 'call-1',
						type: 'function',
						function: {
							name: 'read_file',
							arguments: '{"path":"README.md"}',
						},
					},
				],
			},
			{
				role: 'tool',
				content: 'file contents',
				tool_call_id: 'call-1',
			},
		]);
	});

	it('preserves thinking content for thinking models', () => {
		const messages = convertMessages(
			[
				message(vscode.LanguageModelChatMessageRole.Assistant, [
					new vscode.LanguageModelThinkingPart(['step ', 'one']),
					new vscode.LanguageModelTextPart('answer'),
				]),
			],
			true,
		);

		expect(messages[0]).toMatchObject({
			role: 'assistant',
			content: 'answer',
			reasoning_content: 'step one',
		});
	});

	it('prefers replay marker reasoning over visible thinking parts', () => {
		const marker = createReplayMarkerPart({
			segmentId: '3917af00-099c-49a2-8373-38df581b018e',
			reasoningText: 'marker reasoning',
		});
		const messages = convertMessages(
			[
				message(vscode.LanguageModelChatMessageRole.Assistant, [
					new vscode.LanguageModelThinkingPart('visible reasoning'),
					new vscode.LanguageModelTextPart('answer'),
					marker,
				]),
			],
			true,
		);

		expect(messages[0]?.reasoning_content).toBe('marker reasoning');
	});

	it('converts tool definitions and counts request characters', () => {
		const tools = convertTools([
			{
				name: 'search',
				description: 'Search files',
				inputSchema: { type: 'object' },
			},
		] as vscode.LanguageModelChatTool[]);

		expect(tools).toEqual([
			{
				type: 'function',
				function: {
					name: 'search',
					description: 'Search files',
					parameters: { type: 'object' },
				},
			},
		]);
		expect(
			countMessageChars([
				{
					role: 'assistant',
					content: 'abc',
					reasoning_content: 'de',
					tool_calls: [
						{
							id: '1',
							type: 'function',
							function: { name: 'fn', arguments: '{"x":1}' },
						},
					],
				},
			]),
		).toBe(14);
	});
});
