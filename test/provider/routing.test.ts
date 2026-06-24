import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import {
	classifyGLMRequest,
	classifyProviderRequest,
	shouldForceThinkingNone,
} from '../../src/provider/routing';

function userText(value: string): vscode.LanguageModelChatRequestMessage {
	return {
		role: vscode.LanguageModelChatMessageRole.User,
		content: [new vscode.LanguageModelTextPart(value)],
	} as vscode.LanguageModelChatRequestMessage;
}

describe('request routing classifier', () => {
	it('classifies terminal steering from the latest user message', () => {
		expect(
			classifyProviderRequest({
				messages: [userText('regular'), userText('[Terminal bash notification: command done]')],
			}),
		).toBe('terminal-steering');
	});

	it('classifies helper requests by sole tool name', () => {
		expect(
			classifyProviderRequest({
				messages: [],
				tools: [{ name: 'manage_todo_list' }] as vscode.LanguageModelChatTool[],
			}),
		).toBe('todo-tracker');
		expect(
			classifyProviderRequest({
				messages: [],
				tools: [{ name: 'categorize_prompt' }] as vscode.LanguageModelChatTool[],
			}),
		).toBe('prompt-categorizer');
	});

	it('classifies main-agent and background requests from prompt text', () => {
		expect(
			classifyProviderRequest({
				messages: [userText('You are an expert AI programming assistant. Help the user.')],
			}),
		).toBe('main-agent');
		expect(
			classifyProviderRequest({
				messages: [userText('Summarize this small thing.')],
			}),
		).toBe('background');
	});

	it('classifies GLM requests from GLM payloads', () => {
		expect(
			classifyGLMRequest({
				request: {
					model: 'glm-test',
					stream: true,
					messages: [
						{
							role: 'user',
							content: 'You are an expert in crafting pithy titles',
						},
					],
				},
			}),
		).toBe('chat-title');
	});

	it('forces no thinking only for known helper request kinds', () => {
		expect(shouldForceThinkingNone('chat-title')).toBe(true);
		expect(shouldForceThinkingNone('todo-tracker')).toBe(true);
		expect(shouldForceThinkingNone('main-agent')).toBe(false);
		expect(shouldForceThinkingNone('terminal-steering')).toBe(false);
	});
});
