import vscode from 'vscode';
import type { VisionResolutionResult, VisionResolutionStats } from './types';

export const NATIVE_IMAGE_CONTEXT_BUDGET_BYTES = (5 * 1024 * 1024) / 2;

export const NATIVE_IMAGE_BUDGET_OMITTED_TEXT =
	'[Image omitted - native image context budget exceeded. Try attaching fewer or smaller images.]';

interface NativeImageCandidate {
	messageIndex: number;
	partIndex: number;
	part: vscode.LanguageModelDataPart;
}

interface NativeImageReplacement {
	messageIndex: number;
	partIndex: number;
	part: vscode.LanguageModelInputPart;
}

interface ResizedNativeImage {
	data: Uint8Array;
	mimeType: string;
	resizeFailed: boolean;
}

/**
 * Resize native images and apply the request-body image budget without
 * changing message or content-part ordering.
 */
export async function prepareNativeImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	stats: VisionResolutionStats,
): Promise<VisionResolutionResult> {
	const candidates = collectNativeImageCandidates(messages).sort(
		(left, right) => right.messageIndex - left.messageIndex || left.partIndex - right.partIndex,
	);
	const replacements: NativeImageReplacement[] = [];
	const sentMessageIndexes = new Set<number>();
	const omittedMessageIndexes = new Set<number>();
	let remainingBytes = NATIVE_IMAGE_CONTEXT_BUDGET_BYTES;

	for (const candidate of candidates) {
		const resized = await resizeNativeImage(candidate.part, token);
		stats.nativeImageBytesAfterResize += resized.data.byteLength;
		if (resized.resizeFailed) {
			stats.nativeResizeFailures += 1;
		}

		if (resized.data.byteLength <= remainingBytes) {
			remainingBytes -= resized.data.byteLength;
			stats.nativeImageParts += 1;
			stats.nativeImageBytes += resized.data.byteLength;
			sentMessageIndexes.add(candidate.messageIndex);
			replacements.push({
				messageIndex: candidate.messageIndex,
				partIndex: candidate.partIndex,
				part: new vscode.LanguageModelDataPart(resized.data, resized.mimeType),
			});
			continue;
		}

		stats.nativeBudgetOmittedParts += 1;
		stats.droppedImageParts += 1;
		omittedMessageIndexes.add(candidate.messageIndex);
		replacements.push({
			messageIndex: candidate.messageIndex,
			partIndex: candidate.partIndex,
			part: new vscode.LanguageModelTextPart(NATIVE_IMAGE_BUDGET_OMITTED_TEXT),
		});
	}

	stats.nativeImageMessages = sentMessageIndexes.size;
	stats.omittedImageMessages += omittedMessageIndexes.size;

	return {
		messages: applyNativeImageReplacements(messages, replacements),
		stats,
		replayMarkerMetadata: {},
	};
}

function collectNativeImageCandidates(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): NativeImageCandidate[] {
	const candidates: NativeImageCandidate[] = [];
	for (const [messageIndex, message] of messages.entries()) {
		for (const [partIndex, part] of message.content.entries()) {
			if (isImageDataPart(part)) {
				candidates.push({ messageIndex, partIndex, part });
			}
		}
	}
	return candidates;
}

async function resizeNativeImage(
	part: vscode.LanguageModelDataPart,
	token: vscode.CancellationToken,
): Promise<ResizedNativeImage> {
	throwIfCancellationRequested(token);

	try {
		const resized = await vscode.commands.executeCommand<unknown>(
			'_chat.resizeImage',
			part.data,
			part.mimeType,
		);
		throwIfCancellationRequested(token);
		if (!(resized instanceof Uint8Array) || resized.byteLength === 0) {
			return createResizeFallback(part);
		}
		return {
			data: resized,
			mimeType: detectImageMimeType(resized) ?? part.mimeType,
			resizeFailed: false,
		};
	} catch {
		throwIfCancellationRequested(token);
		return createResizeFallback(part);
	}
}

function createResizeFallback(part: vscode.LanguageModelDataPart): ResizedNativeImage {
	return {
		data: part.data,
		mimeType: part.mimeType,
		resizeFailed: true,
	};
}

function throwIfCancellationRequested(token: vscode.CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

function detectImageMimeType(data: Uint8Array): string | undefined {
	if (hasBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return 'image/png';
	}
	if (hasBytes(data, [0xff, 0xd8, 0xff])) {
		return 'image/jpeg';
	}
	if (hasAscii(data, 0, 'GIF87a') || hasAscii(data, 0, 'GIF89a')) {
		return 'image/gif';
	}
	if (hasAscii(data, 0, 'RIFF') && hasAscii(data, 8, 'WEBP')) {
		return 'image/webp';
	}
	return undefined;
}

function hasBytes(data: Uint8Array, expected: readonly number[]): boolean {
	return expected.every((byte, index) => data[index] === byte);
}

function hasAscii(data: Uint8Array, offset: number, expected: string): boolean {
	for (let index = 0; index < expected.length; index += 1) {
		if (data[offset + index] !== expected.charCodeAt(index)) {
			return false;
		}
	}
	return true;
}

function applyNativeImageReplacements(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	replacements: readonly NativeImageReplacement[],
): readonly vscode.LanguageModelChatRequestMessage[] {
	const replacementsByMessage = new Map<number, Map<number, vscode.LanguageModelInputPart>>();
	for (const replacement of replacements) {
		let messageReplacements = replacementsByMessage.get(replacement.messageIndex);
		if (!messageReplacements) {
			messageReplacements = new Map<number, vscode.LanguageModelInputPart>();
			replacementsByMessage.set(replacement.messageIndex, messageReplacements);
		}
		messageReplacements.set(replacement.partIndex, replacement.part);
	}

	return messages.map((message, messageIndex) => {
		const messageReplacements = replacementsByMessage.get(messageIndex);
		if (!messageReplacements) {
			return message;
		}
		return {
			role: message.role,
			content: message.content.map((part, partIndex) => messageReplacements.get(partIndex) ?? part),
			name: message.name,
		} as unknown as vscode.LanguageModelChatRequestMessage;
	});
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}
