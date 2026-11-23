import { randomUUID } from 'crypto';
import type vscode from 'vscode';

/**
 * Resolve configured request-header templates once per provider call.
 * `${conversationId}` expands to the host's conversation id when available,
 * otherwise to a stable-per-request correlation id.
 */
export function resolveRequestHeaders(
	headers: Readonly<Record<string, string>>,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): Record<string, string> {
	let conversationId: string | undefined;
	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [
			name,
			value.replaceAll('${conversationId}', () => {
				conversationId ??= resolveConversationId(options);
				return conversationId;
			}),
		]),
	);
}

function resolveConversationId(options: vscode.ProvideLanguageModelChatResponseOptions): string {
	const modelOptions = options.modelOptions as Record<string, unknown> | undefined;
	const conversation = modelOptions?._conversationId;
	if (typeof conversation === 'string' && conversation.trim().length > 0) {
		return conversation;
	}
	const correlation = modelOptions?._capturingTokenCorrelationId;
	if (typeof correlation === 'string' && correlation.trim().length > 0) {
		return `request-${correlation}`;
	}
	return randomUUID();
}
