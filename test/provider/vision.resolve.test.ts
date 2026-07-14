import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createReplayMarkerPart } from '../../src/provider/replay';
import type { VisionDescriber } from '../../src/provider/vision';
import { resolveImageMessages } from '../../src/provider/vision';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_PROMPT,
	IMAGE_DESCRIPTION_SUFFIX,
	IMAGE_DESCRIPTION_UNAVAILABLE,
} from '../../src/provider/vision/consts';

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

function userMessage(content: readonly unknown[]): vscode.LanguageModelChatRequestMessage {
	return {
		role: vscode.LanguageModelChatMessageRole.User,
		content,
	} as vscode.LanguageModelChatRequestMessage;
}

function assistantMessage(content: readonly unknown[]): vscode.LanguageModelChatRequestMessage {
	return {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		content,
	} as vscode.LanguageModelChatRequestMessage;
}

function imagePart(data = [1, 2, 3]): vscode.LanguageModelDataPart {
	return new vscode.LanguageModelDataPart(new Uint8Array(data), 'image/png');
}

function textPartValue(part: unknown): string {
	expect(part).toBeInstanceOf(vscode.LanguageModelTextPart);
	return (part as vscode.LanguageModelTextPart).value;
}

describe('vision message resolution', () => {
	it('returns the original message list when no image parts are present', async () => {
		const messages = [userMessage([new vscode.LanguageModelTextPart('hello')])];

		const result = await resolveImageMessages(messages, token, async () => undefined);

		expect(result.messages).toBe(messages);
		expect(result.stats.inputImageParts).toBe(0);
		expect(result.replayMarkerMetadata).toEqual({});
	});

	it('describes only the current image message and stores replay metadata', async () => {
		const describe = vi.fn().mockResolvedValue('a diagram');
		const describer: VisionDescriber = {
			id: 'vision-model',
			source: 'vscode-lm',
			describe,
		};
		const sourceImage = imagePart();

		const result = await resolveImageMessages(
			[userMessage([new vscode.LanguageModelTextPart('Look'), sourceImage])],
			token,
			async () => describer,
		);

		expect(describe).toHaveBeenCalledWith({
			prompt: IMAGE_DESCRIPTION_PROMPT,
			images: [{ mimeType: 'image/png', data: sourceImage.data }],
			token,
		});
		expect(result.stats.generatedImageMessages).toBe(1);
		expect(result.stats.droppedImageParts).toBe(1);
		expect(result.visionModelId).toBe('vision-model');
		expect(result.visionProxySource).toBe('vscode-lm');

		const resolvedContent = result.messages[0]?.content ?? [];
		expect(resolvedContent).toHaveLength(2);
		expect(textPartValue(resolvedContent[0])).toBe('Look');
		const replayText = `\n\n${IMAGE_DESCRIPTION_PREFIX}a diagram${IMAGE_DESCRIPTION_SUFFIX}`;
		expect(textPartValue(resolvedContent[1])).toBe(replayText);
		expect(result.replayMarkerMetadata.visionText).toBe(replayText);
	});

	it('replays historical image text from assistant replay markers', async () => {
		const replayText = `${IMAGE_DESCRIPTION_PREFIX}old screenshot${IMAGE_DESCRIPTION_SUFFIX}`;
		const marker = createReplayMarkerPart({
			segmentId: '3917af00-099c-49a2-8373-38df581b018e',
			visionText: replayText,
		});

		const result = await resolveImageMessages(
			[
				userMessage([imagePart()]),
				assistantMessage([new vscode.LanguageModelTextPart('done'), marker]),
			],
			token,
			async () => {
				throw new Error('describer should not be requested for historical images');
			},
		);

		expect(result.stats.replayedImageMessages).toBe(1);
		expect(result.stats.droppedImageParts).toBe(1);
		expect(textPartValue(result.messages[0]?.content[0])).toBe(replayText);
	});

	it('inserts unavailable text and a notice when no vision describer exists', async () => {
		const result = await resolveImageMessages(
			[userMessage([imagePart()])],
			token,
			async () => undefined,
		);

		expect(result.stats.unavailableImageMessages).toBe(1);
		expect(result.stats.droppedImageParts).toBe(1);
		expect(textPartValue(result.messages[0]?.content[0])).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.replayMarkerMetadata.visionText).toBe(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.initialResponseNotice).toContain('Vision Proxy is unavailable');
	});
});
