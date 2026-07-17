import vscode from 'vscode';
import { t } from '../../i18n';
import { toWellFormedString } from '../../json';
import type { ModelVisionMode } from '../../types';
import { parseFirstReplayMarker } from '../replay';
import { createVisionProxyFailureNotice, createVisionProxyMissingNotice } from '../tools/notices';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
	IMAGE_DESCRIPTION_UNAVAILABLE,
} from './consts';
import { logVisionProxyDescribeFailed, logVisionProxyUnavailable } from './log';
import { buildImagePromptText, storeImage } from './image-store'; // [FORK] mcp mode
import { prepareNativeImageMessages } from './native';
import {
	formatVisionProxyErrorCode,
	getVisionProxyErrorDisplayCode,
	isVisionProxyError,
} from './protocols/errors';
import { getVisionPrompt } from './sources/vscode';
import type {
	VisionDescriber,
	VisionImagePart,
	VisionResolutionResult,
	VisionResolutionStats,
} from './types';

interface CurrentVisionResolution {
	text: string;
	failureNotice?: string;
}

/**
 * Resolve image parts without treating image bytes as persistent identity.
 * Historical images replay marker-carried text; only the current tail user
 * image message is sent to the vision proxy.
 */
export async function resolveImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	getDescriber: () => Promise<VisionDescriber | undefined>,
	visionMode: ModelVisionMode = 'proxy',
): Promise<VisionResolutionResult> {
	const stats = createVisionResolutionStats();
	collectInputImageStats(messages, stats);
	if (stats.inputImageParts === 0) {
		return { messages, stats, replayMarkerMetadata: {} };
	}
	if (visionMode === 'native') {
		return prepareNativeImageMessages(messages, token, stats);
	}
	// [FORK] mcp mode: strip images from the request, persist them to disk, and
	// replace each image part with a short text prompt pointing to the file path.
	// This lets an image-capable MCP tool read the image by path, avoiding the
	// massive context bloat of base64 for text-only models. Kept as a single
	// early-return branch so the upstream proxy/native logic below is untouched.
	if (visionMode === 'mcp') {
		return stripImagesForMcpMode(messages, token, stats);
	}

	const markerBindings = createVisionMarkerBindings(messages, stats);
	const currentImageMessageIndex = findCurrentImageMessageIndex(messages);
	const result: vscode.LanguageModelChatRequestMessage[] = [];
	let visionDescriber: VisionDescriber | undefined;
	let visionDescriberRequested = false;
	let missingVisionProxy = false;
	let visionFailureNotice: string | undefined;
	let markerVisionText: string | undefined;

	for (const [messageIndex, message] of messages.entries()) {
		const imageParts = getImageParts(message);
		if (imageParts.length === 0) {
			result.push(message as vscode.LanguageModelChatRequestMessage);
			continue;
		}

		const nonImageParts = getNonImageParts(message);
		const replayText = markerBindings.get(messageIndex);
		if (replayText) {
			stats.replayedImageMessages += 1;
			stats.droppedImageParts += imageParts.length;
			result.push(
				createResolvedMessage(message, [
					...nonImageParts,
					new vscode.LanguageModelTextPart(replayText),
				]),
			);
			continue;
		}

		if (messageIndex === currentImageMessageIndex) {
			stats.currentImageMessages += 1;
			if (!visionDescriberRequested) {
				visionDescriberRequested = true;
				visionDescriber = await getDescriber();
			}
			const visionResolution = await resolveCurrentVisionText(
				imageParts,
				nonImageParts,
				visionDescriber,
				stats,
				token,
			);
			const visionText = visionResolution.text;
			if (!visionDescriber && !token.isCancellationRequested) {
				missingVisionProxy = true;
			}
			visionFailureNotice ??= visionResolution.failureNotice;
			markerVisionText = visionText;
			stats.markerVisionTextChars = visionText.length;
			stats.droppedImageParts += imageParts.length;
			result.push(
				createResolvedMessage(message, [
					...nonImageParts,
					new vscode.LanguageModelTextPart(visionText),
				]),
			);
			continue;
		}

		stats.omittedImageMessages += 1;
		stats.droppedImageParts += imageParts.length;
		result.push(createResolvedMessage(message, nonImageParts));
	}

	return {
		messages: result,
		stats,
		replayMarkerMetadata: { visionText: markerVisionText },
		visionModelId: visionDescriber?.id,
		visionProxySource: visionDescriber?.source,
		initialResponseNotice: missingVisionProxy
			? createVisionProxyMissingNotice()
			: visionFailureNotice,
	};
}

function createVisionResolutionStats(): VisionResolutionStats {
	return {
		inputImageParts: 0,
		inputImageMessages: 0,
		inputImageBytes: 0,
		nativeImageParts: 0,
		nativeImageMessages: 0,
		nativeImageBytesAfterResize: 0,
		nativeImageBytes: 0,
		nativeBudgetOmittedParts: 0,
		nativeResizeFailures: 0,
		currentImageMessages: 0,
		generatedImageMessages: 0,
		replayedImageMessages: 0,
		omittedImageMessages: 0,
		unavailableImageMessages: 0,
		failedImageMessages: 0,
		droppedImageParts: 0,
		markerVisionTextChars: 0,
		invalidMarkerVisionMetadata: 0,
	};
}

function collectInputImageStats(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	stats: VisionResolutionStats,
): void {
	for (const message of messages) {
		const imageParts = getImageParts(message);
		if (imageParts.length === 0) {
			continue;
		}
		stats.inputImageMessages += 1;
		stats.inputImageParts += imageParts.length;
		stats.inputImageBytes += imageParts.reduce((total, part) => total + part.data.byteLength, 0);
	}
}

function createVisionMarkerBindings(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	stats: VisionResolutionStats,
): Map<number, string> {
	const bindings = new Map<number, string>();
	const boundUserMessages = new Set<number>();

	for (const [messageIndex, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}

		const visionText = findAssistantVisionText(message, stats);
		if (!visionText) {
			continue;
		}

		for (let userIndex = messageIndex - 1; userIndex >= 0; userIndex -= 1) {
			if (boundUserMessages.has(userIndex)) {
				continue;
			}
			const candidate = messages[userIndex];
			if (candidate.role !== vscode.LanguageModelChatMessageRole.User) {
				continue;
			}
			if (getImageParts(candidate).length === 0) {
				continue;
			}

			bindings.set(userIndex, visionText);
			boundUserMessages.add(userIndex);
			break;
		}
	}

	return bindings;
}

function findAssistantVisionText(
	message: vscode.LanguageModelChatRequestMessage,
	stats: VisionResolutionStats,
): string | undefined {
	const marker = parseFirstReplayMarker(message);
	if (!marker) {
		return undefined;
	}
	if (!marker.valid) {
		stats.invalidMarkerVisionMetadata += 1;
		return undefined;
	}
	if (marker.visionText) {
		return marker.visionText;
	}
	if (marker.visionTextIgnoredReason) {
		stats.invalidMarkerVisionMetadata += 1;
	}

	return undefined;
}

function findCurrentImageMessageIndex(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			return undefined;
		}
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		if (getImageParts(message).length > 0) {
			return index;
		}
	}
	return undefined;
}

async function resolveCurrentVisionText(
	imageParts: readonly vscode.LanguageModelDataPart[],
	nonImageParts: readonly vscode.LanguageModelInputPart[],
	visionDescriber: VisionDescriber | undefined,
	stats: VisionResolutionStats,
	token: vscode.CancellationToken,
): Promise<CurrentVisionResolution> {
	if (!visionDescriber || token.isCancellationRequested) {
		if (!visionDescriber) {
			logVisionProxyUnavailable();
		}
		stats.unavailableImageMessages += 1;
		return {
			text: createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts),
		};
	}

	try {
		const description = await visionDescriber.describe({
			prompt: getVisionPrompt(),
			images: imageParts.map(toVisionImagePart),
			token,
		});
		if (description.length === 0) {
			stats.failedImageMessages += 1;
			return createFailedVisionResolution(
				formatVisionProxyErrorCode('empty-response'),
				t('vision.proxy.error.emptyResponse'),
				nonImageParts,
			);
		}

		stats.generatedImageMessages += 1;
		return {
			text: createVisionReplayText(createImageDescriptionText(description), nonImageParts),
		};
	} catch (error) {
		// Propagate cancellation instead of converting it into a failure
		// notice. Otherwise a cancelled describe would still be turned into an
		// "image unavailable" text, the request body would keep being built
		// (with a misleading failure notice baked into the conversation), and
		// only later aborted by the stream layer — wasting work and polluting
		// the context of an already-cancelled turn.
		if (token.isCancellationRequested || isCancelledVisionError(error)) {
			throw error;
		}
		logVisionProxyDescribeFailed(error);
		stats.failedImageMessages += 1;
		return createFailedVisionResolution(
			getVisionProxyErrorDisplayCode(error),
			formatVisionProxyErrorMessage(error),
			nonImageParts,
		);
	}
}

/**
 * A vision describe call fails with a `cancelled` error code when the user
 * aborts the request. Mirrors the check in `service.ts` so we don't have to
 * export the helper.
 */
function isCancelledVisionError(error: unknown): boolean {
	return isVisionProxyError(error) && error.code === 'cancelled';
}

function createFailedVisionResolution(
	errorCode: string,
	errorMessage: string,
	nonImageParts: readonly vscode.LanguageModelInputPart[],
): CurrentVisionResolution {
	return {
		text: createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts),
		failureNotice: createVisionProxyFailureNotice(errorCode, errorMessage),
	};
}

function formatVisionProxyErrorMessage(error: unknown): string {
	if (isVisionProxyError(error)) {
		return error.message;
	}
	return t('vision.proxy.error.requestFailed', t('vision.proxy.error.unknown'));
}

function createVisionReplayText(
	visionText: string,
	nonImageParts: readonly vscode.LanguageModelInputPart[],
): string {
	const separatedText = hasNonEmptyTextPart(nonImageParts) ? `\n\n${visionText}` : visionText;
	return toWellFormedString(separatedText);
}

function createImageDescriptionText(description: string): string {
	return IMAGE_DESCRIPTION_PREFIX + description + IMAGE_DESCRIPTION_SUFFIX;
}

function createResolvedMessage(
	message: vscode.LanguageModelChatRequestMessage,
	content: readonly vscode.LanguageModelInputPart[],
): vscode.LanguageModelChatRequestMessage {
	return {
		role: message.role,
		content,
		name: message.name,
	} as unknown as vscode.LanguageModelChatRequestMessage;
}

function getImageParts(
	message: vscode.LanguageModelChatRequestMessage,
): vscode.LanguageModelDataPart[] {
	return (message.content as readonly vscode.LanguageModelInputPart[]).filter(isImageDataPart);
}

function getNonImageParts(
	message: vscode.LanguageModelChatRequestMessage,
): vscode.LanguageModelInputPart[] {
	return (message.content as readonly vscode.LanguageModelInputPart[]).filter(
		(part) => !isImageDataPart(part),
	);
}

function hasNonEmptyTextPart(parts: readonly vscode.LanguageModelInputPart[]): boolean {
	return parts.some(
		(part) => part instanceof vscode.LanguageModelTextPart && part.value.trim().length > 0,
	);
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function toVisionImagePart(part: vscode.LanguageModelDataPart): VisionImagePart {
	return {
		mimeType: part.mimeType,
		data: part.data,
	};
}

// ---- [FORK] MCP mode: strip images, persist to disk, leave file-path prompts ----

/**
 * MCP vision mode: for every message that carries image parts, persist the
 * images to disk (content-addressable) and replace them with a short text
 * prompt pointing to the file path. Non-image parts are preserved.
 *
 * Unlike `proxy` mode, no vision model is called and no base64 is kept in
 * context — the model is expected to call an image-capable MCP tool to read
 * the stored file on demand. This is the right mode for text-only models
 * (e.g. a Claude-compatible text model behind the Anthropic endpoint) where
 * injecting base64 would waste context without any benefit.
 *
 * If storage fails for any image, that image falls back to an
 * "[unavailable]" text marker (still no base64), so a storage hiccup never
 * silently bloats the context.
 */
async function stripImagesForMcpMode(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	stats: VisionResolutionStats,
): Promise<VisionResolutionResult> {
	// [FORK] Collect per-part replacements indexed by (messageIndex, partIndex)
	// and apply them in place — mirroring how `prepareNativeImageMessages`
	// preserves the original text/image interleaving. The earlier version
	// gathered all non-image parts and appended image-path text to the end of
	// each message, which destroyed the original ordering for interleaved
	// text/image parts (e.g. "请分析这张图" + image became a single merged
	// string with no separator).
	const replacements: McpImageReplacement[] = [];

	for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
		const message = messages[messageIndex];
		const content = message.content as readonly vscode.LanguageModelInputPart[];
		// Sequential index of image parts WITHIN this message, for "Image n of m" labels.
		let imageOrdinal = 0;
		const imageCount = content.filter(isImageDataPart).length;
		for (let partIndex = 0; partIndex < content.length; partIndex += 1) {
			const part = content[partIndex];
			if (!isImageDataPart(part)) {
				continue;
			}
			const filePath = await storeImage(part.data, part.mimeType, token);
			stats.droppedImageParts += 1;
			if (filePath) {
				replacements.push({
					messageIndex,
					partIndex,
					part: new vscode.LanguageModelTextPart(
						// Prepend a newline so the image-path prompt is never
						// concatenated to adjacent text without a separator.
						'\n' + buildImagePromptText(filePath, imageOrdinal, imageCount),
					),
				});
			} else {
				// Storage failed — fall back to an unavailable marker. Never keep
				// base64 in context: it would bloat text models with no benefit.
				logVisionProxyUnavailable();
				stats.unavailableImageMessages += 1;
				replacements.push({
					messageIndex,
					partIndex,
					part: new vscode.LanguageModelTextPart('\n' + IMAGE_DESCRIPTION_UNAVAILABLE),
				});
			}
			imageOrdinal += 1;
		}
	}

	return {
		messages: applyMcpImageReplacements(messages, replacements),
		stats,
		replayMarkerMetadata: {},
	};
}

interface McpImageReplacement {
	messageIndex: number;
	partIndex: number;
	part: vscode.LanguageModelInputPart;
}

/** Apply per-(message,part) replacements in place, preserving all other parts. */
function applyMcpImageReplacements(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	replacements: readonly McpImageReplacement[],
): readonly vscode.LanguageModelChatRequestMessage[] {
	const byMessage = new Map<number, Map<number, vscode.LanguageModelInputPart>>();
	for (const replacement of replacements) {
		let bucket = byMessage.get(replacement.messageIndex);
		if (!bucket) {
			bucket = new Map<number, vscode.LanguageModelInputPart>();
			byMessage.set(replacement.messageIndex, bucket);
		}
		bucket.set(replacement.partIndex, replacement.part);
	}
	return messages.map((message, messageIndex) => {
		const bucket = byMessage.get(messageIndex);
		if (!bucket) {
			return message;
		}
		return {
			role: message.role,
			content: (message.content as readonly vscode.LanguageModelInputPart[]).map(
				(part, partIndex) => bucket.get(partIndex) ?? part,
			),
			name: message.name,
		} as unknown as vscode.LanguageModelChatRequestMessage;
	});
}
