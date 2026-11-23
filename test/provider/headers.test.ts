import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { resolveRequestHeaders } from '../../src/provider/headers';

function options(
	modelOptions?: Record<string, unknown>,
): vscode.ProvideLanguageModelChatResponseOptions {
	return { modelOptions } as vscode.ProvideLanguageModelChatResponseOptions;
}

describe('request header resolution', () => {
	it('expands the conversationId placeholder from host model options', () => {
		const headers = resolveRequestHeaders(
			{ 'X-Conversation': 'conversation:${conversationId}' },
			options({ _conversationId: 'conv-1' }),
		);

		expect(headers).toEqual({ 'X-Conversation': 'conversation:conv-1' });
	});

	it('falls back to a correlation id when the host has no conversation id', () => {
		const headers = resolveRequestHeaders(
			{ 'X-Conversation': '${conversationId}' },
			options({ _capturingTokenCorrelationId: 'abc' }),
		);

		expect(headers['X-Conversation']).toBe('request-abc');
	});

	it('keeps values without placeholders unchanged', () => {
		expect(resolveRequestHeaders({ 'X-Team': 'platform' }, options())).toEqual({
			'X-Team': 'platform',
		});
	});
});
