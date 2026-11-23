import { createHash } from 'crypto';
import vscode from 'vscode';
import { parseFirstReplayMarker, type ToolVisionReplayEntry } from '../replay';
import { createVisionProxyMissingNotice } from '../tools/notices';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
	IMAGE_DESCRIPTION_UNAVAILABLE,
} from './consts';
import { getVisionPrompt } from './sources/vscode';
import type { VisionDescriber, VisionImagePart, VisionResolutionStats } from './types';

export type ToolResultContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; mimeType: string; data: Uint8Array }
	| { type: 'other'; value: unknown };

export interface NormalizedToolResult {
	callId: string;
	parts: ToolResultContentPart[];
	originalContent: readonly unknown[];
}

export interface ToolImageResolution {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	replayEntries: ToolVisionReplayEntry[];
	notice?: string;
}

/**
 * Split a tool result into text/image/other parts without inspecting opaque
 * values (paths, URIs, objects). Only real image data parts count as images.
 */
export function normalizeToolResult(
	part: vscode.LanguageModelToolResultPart,
): NormalizedToolResult {
	const parts: ToolResultContentPart[] = part.content.map((item): ToolResultContentPart => {
		if (item instanceof vscode.LanguageModelTextPart) {
			return { type: 'text', text: item.value };
		}
		if (item instanceof vscode.LanguageModelDataPart && item.mimeType.startsWith('image/')) {
			return { type: 'image', mimeType: item.mimeType, data: item.data };
		}
		return { type: 'other', value: item };
	});
	return { callId: part.callId, parts, originalContent: part.content };
}

/** Collect authoritative counts for nested tool-result images (all vision modes). */
export function collectToolResultImageStats(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	stats: VisionResolutionStats,
): void {
	for (const message of messages) {
		for (const part of message.content) {
			if (!(part instanceof vscode.LanguageModelToolResultPart)) {
				continue;
			}
			const images = normalizeToolResult(part).parts.filter(
				(item): item is Extract<ToolResultContentPart, { type: 'image' }> => item.type === 'image',
			);
			if (images.length === 0) {
				continue;
			}
			stats.toolResultImageResults += 1;
			stats.toolResultImageParts += images.length;
			stats.toolResultImageBytes += images.reduce(
				(total, image) => total + image.data.byteLength,
				0,
			);
		}
	}
}

/**
 * Replace nested tool-result images with Vision Proxy descriptions.
 *
 * The description is also recorded per tool-call id so the assistant response
 * that follows this turn can carry it in its replay marker. Later requests then
 * reuse the same text instead of re-describing the image (which would change the
 * prompt prefix and break upstream prompt caching).
 */
export async function resolveToolResultImages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	getDescriber: () => Promise<VisionDescriber | undefined>,
	stats: VisionResolutionStats,
): Promise<ToolImageResolution> {
	const replayIndex = buildToolVisionReplayIndex(messages);
	const descriptionCache = new Map<string, string>();
	const replayEntries: ToolVisionReplayEntry[] = [];
	let describer: VisionDescriber | undefined;
	let describerRequested = false;
	let missingDescriber = false;
	let changed = false;

	const resolvedMessages: vscode.LanguageModelChatRequestMessage[] = [];
	for (const [messageIndex, message] of messages.entries()) {
		let messageChanged = false;
		const content: vscode.LanguageModelChatRequestMessage['content'][number][] = [];

		for (const part of message.content) {
			if (!(part instanceof vscode.LanguageModelToolResultPart)) {
				content.push(part);
				continue;
			}

			const normalized = normalizeToolResult(part);
			const imageParts = normalized.parts.filter(
				(item): item is Extract<ToolResultContentPart, { type: 'image' }> => item.type === 'image',
			);
			if (imageParts.length === 0) {
				content.push(part);
				continue;
			}

			const replayEntry = findReplayEntry(
				replayIndex,
				normalized.callId,
				messageIndex,
				imageParts.length,
			);
			if (replayEntry) {
				stats.toolResultImagesReplayed += imageParts.length;
				stats.droppedImageParts += imageParts.length;
				content.push(
					new vscode.LanguageModelToolResultPart(normalized.callId, [
						new vscode.LanguageModelTextPart(replayEntry.resolvedContent),
					]),
				);
				messageChanged = true;
				continue;
			}

			if (!describerRequested) {
				describerRequested = true;
				describer = await getDescriber();
			}

			const resolvedContent: string[] = [];
			const resolvedParts: vscode.LanguageModelToolResultPart['content'] = [];
			for (const item of normalized.parts) {
				if (item.type === 'text') {
					resolvedContent.push(item.text);
					resolvedParts.push(new vscode.LanguageModelTextPart(item.text));
				} else if (item.type === 'image') {
					const resolution = await describeToolImage(
						item,
						token,
						describer,
						descriptionCache,
						stats,
					);
					if (resolution.missing) {
						missingDescriber = true;
					}
					const text = resolution.text ?? IMAGE_DESCRIPTION_UNAVAILABLE;
					resolvedContent.push(text);
					resolvedParts.push(new vscode.LanguageModelTextPart(text));
				} else {
					resolvedParts.push(item.value as never);
				}
			}

			replayEntries.push({
				callId: normalized.callId,
				resolvedContent: resolvedContent.join(''),
				imageParts: imageParts.length,
			});
			content.push(new vscode.LanguageModelToolResultPart(normalized.callId, resolvedParts));
			messageChanged = true;
		}

		if (!messageChanged) {
			resolvedMessages.push(message);
			continue;
		}
		changed = true;
		resolvedMessages.push({
			role: message.role,
			content,
			name: message.name,
		} as vscode.LanguageModelChatRequestMessage);
	}

	return {
		messages: changed ? resolvedMessages : messages,
		replayEntries: replayEntries.filter((entry) => entry.resolvedContent.length > 0),
		notice: missingDescriber ? createVisionProxyMissingNotice() : undefined,
	};
}

async function describeToolImage(
	image: Extract<ToolResultContentPart, { type: 'image' }>,
	token: vscode.CancellationToken,
	describer: VisionDescriber | undefined,
	cache: Map<string, string>,
	stats: VisionResolutionStats,
): Promise<{ text?: string; missing: boolean }> {
	if (!describer) {
		stats.toolResultImagesUnavailable += 1;
		return { missing: true };
	}
	if (token.isCancellationRequested) {
		stats.toolResultImagesUnavailable += 1;
		return { missing: false };
	}
	const cacheKey = hashImage(image);
	const cached = cache.get(cacheKey);
	if (cached) {
		stats.toolResultImagesReplayed += 1;
		return { text: cached, missing: false };
	}

	try {
		const description = await describer.describe({
			prompt: getVisionPrompt(),
			images: [toVisionImagePart(image)],
			token,
		});
		if (description.trim().length === 0) {
			stats.toolResultImagesUnavailable += 1;
			return { missing: false };
		}
		stats.toolResultImagesDescribed += 1;
		const text = IMAGE_DESCRIPTION_PREFIX + description + IMAGE_DESCRIPTION_SUFFIX;
		cache.set(cacheKey, text);
		return { text, missing: false };
	} catch (error) {
		if (token.isCancellationRequested) {
			throw error;
		}
		stats.toolResultImagesUnavailable += 1;
		return { missing: false };
	}
}

function hashImage(image: Extract<ToolResultContentPart, { type: 'image' }>): string {
	return `${image.mimeType}:${createHash('sha256').update(image.data).digest('hex')}`;
}

function toVisionImagePart(
	image: Extract<ToolResultContentPart, { type: 'image' }>,
): VisionImagePart {
	return { mimeType: image.mimeType, data: image.data };
}

function buildToolVisionReplayIndex(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): Map<string, Array<{ markerIndex: number; entry: ToolVisionReplayEntry }>> {
	const index = new Map<string, Array<{ markerIndex: number; entry: ToolVisionReplayEntry }>>();
	for (const [messageIndex, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}
		const entries = parseFirstReplayMarker(message)?.toolVision ?? [];
		for (const entry of entries) {
			const list = index.get(entry.callId) ?? [];
			list.push({ markerIndex: messageIndex, entry });
			index.set(entry.callId, list);
		}
	}
	return index;
}

function findReplayEntry(
	index: Map<string, Array<{ markerIndex: number; entry: ToolVisionReplayEntry }>>,
	callId: string,
	messageIndex: number,
	imageParts: number,
): ToolVisionReplayEntry | undefined {
	return index
		.get(callId)
		?.find(
			(candidate) =>
				candidate.markerIndex > messageIndex && candidate.entry.imageParts === imageParts,
		)?.entry;
}
