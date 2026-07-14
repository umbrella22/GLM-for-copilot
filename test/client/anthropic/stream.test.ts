import { describe, expect, it, vi } from 'vitest';
import { parseAnthropicStream } from '../../../src/client/anthropic/stream';
import type { GLMUsage, StreamCallbacks } from '../../../src/types';

function createReader(events: readonly object[]): ReadableStreamDefaultReader<Uint8Array> {
	const body = events
		.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}`)
		.join('\n\n');
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
	return stream.getReader();
}

function createCallbacks(onUsage: (usage: GLMUsage) => void): StreamCallbacks {
	return {
		onContent: vi.fn(),
		onThinking: vi.fn(),
		onToolCall: vi.fn(),
		onError: vi.fn(),
		onDone: vi.fn(),
		onUsage,
	};
}

describe('Anthropic stream usage', () => {
	it('merges input and cache counts reported in message_delta', async () => {
		const onUsage = vi.fn();
		await parseAnthropicStream(
			createReader([
				{
					type: 'message_start',
					message: { id: 'msg_1', model: 'glm-5.2', usage: { input_tokens: 0 } },
				},
				{
					type: 'message_delta',
					delta: { stop_reason: 'end_turn' },
					usage: {
						input_tokens: 120,
						output_tokens: 15,
						cache_creation_input_tokens: 30,
						cache_read_input_tokens: 50,
					},
				},
				{ type: 'message_stop' },
			]),
			createCallbacks(onUsage),
		);

		expect(onUsage).toHaveBeenCalledWith({
			prompt_tokens: 200,
			completion_tokens: 15,
			total_tokens: 215,
			prompt_cache_hit_tokens: 50,
			prompt_tokens_details: { cached_tokens: 50 },
		});
	});

	it('does not let later placeholder zeroes erase cumulative usage', async () => {
		const onUsage = vi.fn();
		await parseAnthropicStream(
			createReader([
				{
					type: 'message_start',
					message: {
						id: 'msg_1',
						model: 'glm-5.2',
						usage: { input_tokens: 100, cache_read_input_tokens: 40 },
					},
				},
				{
					type: 'message_delta',
					delta: { stop_reason: 'end_turn' },
					usage: { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: 0 },
				},
			]),
			createCallbacks(onUsage),
		);

		expect(onUsage).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt_tokens: 140,
				completion_tokens: 10,
				total_tokens: 150,
				prompt_cache_hit_tokens: 40,
			}),
		);
	});

	it('does not synthesize a provider usage callback when no usage event arrives', async () => {
		const onUsage = vi.fn();
		await parseAnthropicStream(
			createReader([
				{ type: 'content_block_start', index: 0, content_block: { type: 'text' } },
				{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
				{ type: 'message_stop' },
			]),
			createCallbacks(onUsage),
		);

		expect(onUsage).not.toHaveBeenCalled();
	});
});
