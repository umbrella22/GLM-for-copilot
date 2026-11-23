import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLMClient } from '../../src/client';
import type { StreamCallbacks } from '../../src/types';

function sseResponse(chunks: readonly unknown[]): Response {
	const body =
		chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
	return new Response(body, { status: 200 });
}

function callbacks(): StreamCallbacks {
	return {
		onContent: vi.fn(),
		onThinking: vi.fn(),
		onToolCall: vi.fn(),
		onError: vi.fn(),
		onDone: vi.fn(),
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible stream parsing', () => {
	it('reads reasoning from both reasoning_content and delta.reasoning', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					sseResponse([
						{ choices: [{ index: 0, delta: { reasoning_content: 'official ' } }] },
						{ choices: [{ index: 0, delta: { reasoning: 'vllm' } }] },
						{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
					]),
				),
			),
		);
		const cb = callbacks();

		await new GLMClient('https://example.test', 'test-key', 'openai').streamChatCompletion(
			{ model: 'glm-test', messages: [], stream: true },
			cb,
		);

		expect(cb.onThinking).toHaveBeenNthCalledWith(1, 'official ');
		expect(cb.onThinking).toHaveBeenNthCalledWith(2, 'vllm');
		expect(cb.onDone).toHaveBeenCalledTimes(1);
	});

	it('accumulates tool-call fragments that omit index', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					sseResponse([
						{
							choices: [
								{
									index: 0,
									delta: {
										tool_calls: [
											{
												id: 'call-1',
												function: { name: 'read_file', arguments: '{"pa' },
											},
										],
									},
								},
							],
						},
						{
							choices: [
								{
									index: 0,
									delta: {
										tool_calls: [{ function: { arguments: 'th":"a.md"}' } }],
									},
								},
							],
						},
						{ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
					]),
				),
			),
		);
		const cb = callbacks();

		await new GLMClient('https://example.test', 'test-key', 'openai').streamChatCompletion(
			{ model: 'glm-test', messages: [], stream: true },
			cb,
		);

		expect(cb.onToolCall).toHaveBeenCalledTimes(1);
		expect(cb.onToolCall).toHaveBeenCalledWith({
			id: 'call-1',
			type: 'function',
			function: { name: 'read_file', arguments: '{"path":"a.md"}' },
		});
	});
});
