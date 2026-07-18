import vscode from 'vscode';
import { resizeImage } from './shared/resize';
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
		const resized = await resizeImage(candidate.part.data, candidate.part.mimeType, token);
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

// `resizeImage` / `detectImageMimeType` were extracted to `./shared/resize`
// so both the native pipeline (here) and the mcp pipeline (image-store) can
// reuse the same resize + magic-byte detection logic.

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
