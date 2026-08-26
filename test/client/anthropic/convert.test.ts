import { describe, expect, it } from 'vitest';
import { convertToAnthropicRequest } from '../../../src/client/anthropic';

describe('Anthropic request conversion', () => {
	it('converts native image data URLs to base64 image blocks without changing order', () => {
		const request = convertToAnthropicRequest({
			model: 'glm-4.6v-flash',
			stream: true,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'before' },
						{
							type: 'image_url',
							image_url: { url: 'data:image/png;base64,AQID' },
						},
						{ type: 'text', text: 'after' },
					],
				},
			],
		});

		expect(request.messages).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'before' },
					{
						type: 'image',
						source: { type: 'base64', media_type: 'image/png', data: 'AQID' },
					},
					{ type: 'text', text: 'after' },
				],
			},
		]);
	});

	it('falls back to the model maximum output budget when max_tokens is unset', () => {
		const request = convertToAnthropicRequest({
			model: 'glm-5.3',
			stream: true,
			thinking: { type: 'enabled', clear_thinking: false },
			messages: [{ role: 'user', content: 'Hello' }],
		});

		// Anthropic requires max_tokens. The fallback matches the GLM-5.x
		// maximum output (131072), and thinking must leave room for the answer.
		expect(request.max_tokens).toBe(131_072);
		expect(request.thinking).toEqual({ type: 'enabled', budget_tokens: 32_768 });
	});

	it('derives the thinking budget from an explicit small max_tokens', () => {
		const request = convertToAnthropicRequest({
			model: 'glm-5.3',
			stream: true,
			max_tokens: 8192,
			thinking: { type: 'enabled', clear_thinking: false },
			messages: [{ role: 'user', content: 'Hello' }],
		});

		expect(request.max_tokens).toBe(8192);
		expect(request.thinking).toEqual({ type: 'enabled', budget_tokens: 8191 });
	});

	it('keeps the answer budget when thinking is disabled', () => {
		const request = convertToAnthropicRequest({
			model: 'glm-5.3',
			stream: true,
			thinking: { type: 'disabled' },
			messages: [{ role: 'user', content: 'Hello' }],
		});

		expect(request.max_tokens).toBe(131_072);
		expect(request.thinking).toBeUndefined();
	});
});
