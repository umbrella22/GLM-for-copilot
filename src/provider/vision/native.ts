import vscode from 'vscode';
import { resizeImage } from './shared/resize';
import type { VisionResolutionResult, VisionResolutionStats } from './types';

export const NATIVE_IMAGE_CONTEXT_BUDGET_BYTES = (5 * 1024 * 1024) / 2;

export const NATIVE_IMAGE_BUDGET_OMITTED_TEXT =
	'[Image omitted - native image context budget exceeded. Try attaching fewer or smaller images.]';

type NativeImageCandidate =
	| {
			kind: 'message';
			messageIndex: number;
			partIndex: number;
			order: number;
			part: vscode.LanguageModelDataPart;
	  }
	| {
			kind: 'tool-result';
			messageIndex: number;
			outerPartIndex: number;
			innerPartIndex: number;
			order: number;
			part: vscode.LanguageModelDataPart;
	  };

type NativeImageReplacement =
	| {
			kind: 'message';
			messageIndex: number;
			partIndex: number;
			part: vscode.LanguageModelInputPart;
	  }
	| {
			kind: 'tool-result';
			messageIndex: number;
			outerPartIndex: number;
			innerPartIndex: number;
			part: unknown;
	  };

/**
 * Resize native images and apply the request-body image budget without
 * changing message or content-part ordering. Nested tool-result images share
 * the same budget as user attachments, so multi-turn screenshots cannot grow
 * the request without bound.
 */
export async function prepareNativeImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	stats: VisionResolutionStats,
): Promise<VisionResolutionResult> {
	const candidates = collectNativeImageCandidates(messages).sort(
		(left, right) => right.messageIndex - left.messageIndex || left.order - right.order,
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
			replacements.push(
				toReplacement(candidate, new vscode.LanguageModelDataPart(resized.data, resized.mimeType)),
			);
			continue;
		}

		stats.nativeBudgetOmittedParts += 1;
		stats.droppedImageParts += 1;
		omittedMessageIndexes.add(candidate.messageIndex);
		replacements.push(
			toReplacement(candidate, new vscode.LanguageModelTextPart(NATIVE_IMAGE_BUDGET_OMITTED_TEXT)),
		);
	}

	stats.nativeImageMessages = sentMessageIndexes.size;
	stats.omittedImageMessages += omittedMessageIndexes.size;

	return {
		messages: applyNativeImageReplacements(messages, replacements),
		stats,
		replayMarkerMetadata: {},
	};
}

function toReplacement(
	candidate: NativeImageCandidate,
	part: vscode.LanguageModelInputPart,
): NativeImageReplacement {
	if (candidate.kind === 'message') {
		return {
			kind: 'message',
			messageIndex: candidate.messageIndex,
			partIndex: candidate.partIndex,
			part,
		};
	}
	return {
		kind: 'tool-result',
		messageIndex: candidate.messageIndex,
		outerPartIndex: candidate.outerPartIndex,
		innerPartIndex: candidate.innerPartIndex,
		part,
	};
}

function collectNativeImageCandidates(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): NativeImageCandidate[] {
	const candidates: NativeImageCandidate[] = [];
	let order = 0;
	for (const [messageIndex, message] of messages.entries()) {
		for (const [partIndex, part] of message.content.entries()) {
			if (isImageDataPart(part)) {
				candidates.push({ kind: 'message', messageIndex, partIndex, order: order++, part });
				continue;
			}
			if (!(part instanceof vscode.LanguageModelToolResultPart)) {
				continue;
			}
			for (const [innerPartIndex, item] of part.content.entries()) {
				if (isImageDataPart(item)) {
					candidates.push({
						kind: 'tool-result',
						messageIndex,
						outerPartIndex: partIndex,
						innerPartIndex,
						order: order++,
						part: item,
					});
				}
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
	const messageReplacements = new Map<number, Map<number, vscode.LanguageModelInputPart>>();
	const toolReplacements = new Map<number, Map<number, Map<number, unknown>>>();
	for (const replacement of replacements) {
		if (replacement.kind === 'message') {
			let bucket = messageReplacements.get(replacement.messageIndex);
			if (!bucket) {
				bucket = new Map();
				messageReplacements.set(replacement.messageIndex, bucket);
			}
			bucket.set(replacement.partIndex, replacement.part);
			continue;
		}

		let messageBucket = toolReplacements.get(replacement.messageIndex);
		if (!messageBucket) {
			messageBucket = new Map();
			toolReplacements.set(replacement.messageIndex, messageBucket);
		}
		let toolBucket = messageBucket.get(replacement.outerPartIndex);
		if (!toolBucket) {
			toolBucket = new Map();
			messageBucket.set(replacement.outerPartIndex, toolBucket);
		}
		toolBucket.set(replacement.innerPartIndex, replacement.part);
	}

	return messages.map((message, messageIndex) => {
		const messageBucket = messageReplacements.get(messageIndex);
		const toolBucket = toolReplacements.get(messageIndex);
		if (!messageBucket && !toolBucket) {
			return message;
		}
		return {
			role: message.role,
			content: message.content.map((part, partIndex) => {
				const direct = messageBucket?.get(partIndex);
				if (direct) {
					return direct;
				}
				const inner = toolBucket?.get(partIndex);
				if (inner && part instanceof vscode.LanguageModelToolResultPart) {
					return new vscode.LanguageModelToolResultPart(
						part.callId,
						part.content.map((item, innerIndex) => inner.get(innerIndex) ?? item),
					);
				}
				return part;
			}),
			name: message.name,
		} as unknown as vscode.LanguageModelChatRequestMessage;
	});
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}
