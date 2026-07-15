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
});
