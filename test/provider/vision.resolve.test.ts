import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
	NATIVE_IMAGE_BUDGET_OMITTED_TEXT,
	NATIVE_IMAGE_CONTEXT_BUDGET_BYTES,
} from '../../src/provider/vision/native';
import { __resetCommandState } from '../support/vscode.mock';

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

function repeatedImagePart(length: number, value: number): vscode.LanguageModelDataPart {
	return new vscode.LanguageModelDataPart(new Uint8Array(length).fill(value), 'image/png');
}

function textPartValue(part: unknown): string {
	expect(part).toBeInstanceOf(vscode.LanguageModelTextPart);
	return (part as vscode.LanguageModelTextPart).value;
}

function imagePartValue(part: unknown): vscode.LanguageModelDataPart {
	expect(part).toBeInstanceOf(vscode.LanguageModelDataPart);
	return part as vscode.LanguageModelDataPart;
}

function registerResizeCommand(
	implementation: (...args: unknown[]) => unknown = (data) => data,
): ReturnType<typeof vi.fn> {
	const callback = vi.fn(implementation);
	vscode.commands.registerCommand('_chat.resizeImage', callback);
	return callback;
}

class MutableCancellationToken {
	isCancellationRequested = false;
	readonly onCancellationRequested = () => ({ dispose() {} });

	cancel(): void {
		this.isCancellationRequested = true;
	}
}

describe('vision message resolution', () => {
	beforeEach(() => {
		__resetCommandState();
	});

	it('returns the original message list when no image parts are present', async () => {
		const messages = [userMessage([new vscode.LanguageModelTextPart('hello')])];

		const result = await resolveImageMessages(messages, token, async () => undefined);

		expect(result.messages).toBe(messages);
		expect(result.stats.inputImageParts).toBe(0);
		expect(result.replayMarkerMetadata).toEqual({});
	});

	it('resizes native images and preserves message and part order', async () => {
		const describe = vi.fn();
		const resize = registerResizeCommand();
		const messages = [
			userMessage([new vscode.LanguageModelTextPart('current'), imagePart([1, 2, 3])]),
			assistantMessage([new vscode.LanguageModelTextPart('previous answer')]),
			userMessage([imagePart([4, 5])]),
		];

		const result = await resolveImageMessages(
			messages,
			token,
			async () => ({ id: 'unused', source: 'auto', describe }),
			'native',
		);

		expect(describe).not.toHaveBeenCalled();
		expect(resize).toHaveBeenCalledTimes(2);
		expect(result.messages).not.toBe(messages);
		expect(result.messages[1]).toBe(messages[1]);
		expect(result.messages[0]?.content[0]).toBe(messages[0]?.content[0]);
		expect(Array.from(imagePartValue(result.messages[0]?.content[1]).data)).toEqual([1, 2, 3]);
		expect(Array.from(imagePartValue(result.messages[2]?.content[0]).data)).toEqual([4, 5]);
		expect(result.stats).toMatchObject({
			inputImageParts: 2,
			inputImageMessages: 2,
			inputImageBytes: 5,
			nativeImageParts: 2,
			nativeImageMessages: 2,
			nativeImageBytesAfterResize: 5,
			nativeImageBytes: 5,
			nativeBudgetOmittedParts: 0,
			nativeResizeFailures: 0,
			droppedImageParts: 0,
		});
		expect(result.replayMarkerMetadata).toEqual({});
	});

	it('uses resized bytes and corrects MIME from the resized image signature', async () => {
		const resizedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
		const resize = registerResizeCommand(() => resizedPng);
		const source = new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3, 4]), 'image/jpeg');

		const result = await resolveImageMessages(
			[userMessage([source])],
			token,
			async () => undefined,
			'native',
		);

		expect(resize).toHaveBeenCalledWith(source.data, 'image/jpeg');
		const output = imagePartValue(result.messages[0]?.content[0]);
		expect(output.data).toBe(resizedPng);
		expect(output.mimeType).toBe('image/png');
		expect(result.stats).toMatchObject({
			inputImageBytes: 4,
			nativeImageBytesAfterResize: 9,
			nativeImageBytes: 9,
			nativeResizeFailures: 0,
		});
	});

	it.each([
		[
			'throws',
			() => {
				throw new Error('resize failed');
			},
		],
		['returns undefined', () => undefined],
		['returns an empty array', () => new Uint8Array()],
		['returns a non-Uint8Array', () => 'invalid'],
	])('falls back to the original native image when resize %s', async (_name, resizeResult) => {
		registerResizeCommand(resizeResult);
		const source = new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), 'image/gif');

		const result = await resolveImageMessages(
			[userMessage([source])],
			token,
			async () => undefined,
			'native',
		);

		const output = imagePartValue(result.messages[0]?.content[0]);
		expect(output.data).toBe(source.data);
		expect(output.mimeType).toBe('image/gif');
		expect(result.stats).toMatchObject({
			nativeImageBytesAfterResize: 3,
			nativeImageBytes: 3,
			nativeResizeFailures: 1,
		});
	});

	it('sends multiple resized images when their total remains within the native budget', async () => {
		registerResizeCommand();
		const messages = [
			userMessage([
				new vscode.LanguageModelTextPart('before'),
				imagePart([1, 2]),
				new vscode.LanguageModelTextPart('between'),
				imagePart([3, 4, 5]),
			]),
		];

		const result = await resolveImageMessages(messages, token, async () => undefined, 'native');

		expect(result.messages[0]?.content.map((part) => part.constructor.name)).toEqual([
			'LanguageModelTextPart',
			'LanguageModelDataPart',
			'LanguageModelTextPart',
			'LanguageModelDataPart',
		]);
		expect(result.stats).toMatchObject({
			nativeImageParts: 2,
			nativeImageMessages: 1,
			nativeImageBytesAfterResize: 5,
			nativeImageBytes: 5,
			nativeBudgetOmittedParts: 0,
		});
	});

	it('prioritizes the newest message when resized images exceed the native budget', async () => {
		const imageBytes = Math.floor(NATIVE_IMAGE_CONTEXT_BUDGET_BYTES * 0.6);
		const resize = registerResizeCommand();
		const messages = [
			userMessage([repeatedImagePart(imageBytes, 1)]),
			assistantMessage([new vscode.LanguageModelTextPart('previous answer')]),
			userMessage([repeatedImagePart(imageBytes, 2)]),
		];

		const result = await resolveImageMessages(messages, token, async () => undefined, 'native');

		expect(resize).toHaveBeenCalledTimes(2);
		expect(textPartValue(result.messages[0]?.content[0])).toBe(NATIVE_IMAGE_BUDGET_OMITTED_TEXT);
		expect(imagePartValue(result.messages[2]?.content[0]).data.byteLength).toBe(imageBytes);
		expect(result.stats).toMatchObject({
			nativeImageParts: 1,
			nativeImageMessages: 1,
			nativeImageBytesAfterResize: imageBytes * 2,
			nativeImageBytes: imageBytes,
			nativeBudgetOmittedParts: 1,
			droppedImageParts: 1,
			omittedImageMessages: 1,
		});
	});

	it('allocates same-message images in attachment order', async () => {
		registerResizeCommand();
		const firstBytes = NATIVE_IMAGE_CONTEXT_BUDGET_BYTES - 10;
		const secondBytes = 20;

		const result = await resolveImageMessages(
			[userMessage([repeatedImagePart(firstBytes, 1), repeatedImagePart(secondBytes, 2)])],
			token,
			async () => undefined,
			'native',
		);

		expect(imagePartValue(result.messages[0]?.content[0]).data.byteLength).toBe(firstBytes);
		expect(textPartValue(result.messages[0]?.content[1])).toBe(NATIVE_IMAGE_BUDGET_OMITTED_TEXT);
		expect(result.stats.nativeImageBytes).toBe(firstBytes);
		expect(result.stats.nativeBudgetOmittedParts).toBe(1);
	});

	it('omits a single resized image larger than the native budget and preserves text', async () => {
		registerResizeCommand();
		const oversized = NATIVE_IMAGE_CONTEXT_BUDGET_BYTES + 1;

		const result = await resolveImageMessages(
			[userMessage([new vscode.LanguageModelTextPart('inspect'), repeatedImagePart(oversized, 1)])],
			token,
			async () => undefined,
			'native',
		);

		expect(textPartValue(result.messages[0]?.content[0])).toBe('inspect');
		expect(textPartValue(result.messages[0]?.content[1])).toBe(NATIVE_IMAGE_BUDGET_OMITTED_TEXT);
		expect(result.stats).toMatchObject({
			nativeImageParts: 0,
			nativeImageMessages: 0,
			nativeImageBytesAfterResize: oversized,
			nativeImageBytes: 0,
			nativeBudgetOmittedParts: 1,
		});
	});

	it('propagates cancellation before native resize', async () => {
		const resize = registerResizeCommand();
		const cancelledToken = new MutableCancellationToken();
		cancelledToken.cancel();

		await expect(
			resolveImageMessages(
				[userMessage([imagePart()])],
				cancelledToken as unknown as vscode.CancellationToken,
				async () => undefined,
				'native',
			),
		).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(resize).not.toHaveBeenCalled();
	});

	it('propagates cancellation observed after native resize', async () => {
		const cancelledToken = new MutableCancellationToken();
		const resize = registerResizeCommand((data) => {
			cancelledToken.cancel();
			return data;
		});

		await expect(
			resolveImageMessages(
				[userMessage([imagePart()])],
				cancelledToken as unknown as vscode.CancellationToken,
				async () => undefined,
				'native',
			),
		).rejects.toBeInstanceOf(vscode.CancellationError);
		expect(resize).toHaveBeenCalledOnce();
	});

	it('describes only the current image message and stores replay metadata', async () => {
		const resize = registerResizeCommand();
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
		expect(resize).not.toHaveBeenCalled();
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
