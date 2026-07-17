import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveImageMessages } from '../../../src/provider/vision/resolve';
import { initImageStore } from '../../../src/provider/vision/image-store';
import { IMAGE_DESCRIPTION_UNAVAILABLE } from '../../../src/provider/vision/consts';
import { convertMessages } from '../../../src/provider/convert';
import { __resetCommandState } from '../../support/vscode.mock';

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

// The mcp describer is never used in mcp mode (images are stripped, not
// described), so pass a stub that throws if accidentally called.
const unusedDescriber = vi.fn(async () => {
	throw new Error('describer must not be called in mcp mode');
});

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

/** PNG magic bytes (image/png is accepted by storeImage without resize). */
function pngPart(fill = 0xaa, size = 64): vscode.LanguageModelDataPart {
	const data = new Uint8Array(size);
	data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	data.fill(fill, 8);
	return new vscode.LanguageModelDataPart(data, 'image/png');
}

/** GIF magic bytes (image/gif is rejected unless resize converts it). */
function gifPart(): vscode.LanguageModelDataPart {
	const data = new Uint8Array(16);
	for (let i = 0; i < 6; i += 1) {
		data[i] = 'GIF87a'.charCodeAt(i);
	}
	return new vscode.LanguageModelDataPart(data, 'image/gif');
}

/** Register _chat.resizeImage returning undefined (forces normalization to
 * fail, which makes storeImage return undefined -> unavailable marker). */
function registerFailingResize(): ReturnType<typeof vi.fn> {
	const callback = vi.fn(() => undefined);
	vscode.commands.registerCommand('_chat.resizeImage', callback);
	return callback;
}

function extractText(part: unknown): string {
	expect(part).toBeInstanceOf(vscode.LanguageModelTextPart);
	return (part as vscode.LanguageModelTextPart).value;
}

let tmpRoot: string;

beforeEach(async () => {
	__resetCommandState();
	tmpRoot = await mkdtemp(join(tmpdir(), 'glm-resolve-mcp-test-'));
	await initImageStore(vscode.Uri.file(tmpRoot));
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe('resolveImageMessages — mcp mode basic stripping (PR #14 review #4/#8)', () => {
	it('returns the original messages unchanged when there are no image parts', async () => {
		// Early-return path: inputImageParts === 0, no work done.
		const messages = [userMessage([new vscode.LanguageModelTextPart('hello')])];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		expect(result.messages).toBe(messages);
		expect(result.stats.inputImageParts).toBe(0);
		expect(result.stats.droppedImageParts).toBe(0);
	});

	it('replaces a single image part with a file-path text prompt', async () => {
		const messages = [userMessage([pngPart()])];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const content = result.messages[0]!.content as readonly unknown[];
		expect(content).toHaveLength(1);
		const text = extractText(content[0]);
		// File path points into the mcp-images dir and is a .png (accepted format).
		expect(text).toMatch(/mcp-images[\\/][a-f0-9]+\.png/);
		expect(result.stats.droppedImageParts).toBe(1);
		expect(result.stats.unavailableImageMessages).toBe(0);
	});

	it('marks an image as unavailable when storage fails (no base64 kept)', async () => {
		// GIF is rejected by normalization when resize is unavailable.
		registerFailingResize();
		const messages = [userMessage([gifPart()])];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const content = result.messages[0]!.content as readonly unknown[];
		const text = extractText(content[0]);
		expect(text).toContain(IMAGE_DESCRIPTION_UNAVAILABLE);
		expect(result.stats.unavailableImageMessages).toBe(1);
		expect(result.stats.droppedImageParts).toBe(1);
	});
});

describe('resolveImageMessages — mcp mode order preservation (PR #14 review #8)', () => {
	it('preserves text/image interleaving by replacing in place (NOT appending)', async () => {
		// The regression this guards against: an earlier impl gathered all
		// non-image parts and appended image paths at the end, losing the
		// original "text1 | image | text2" ordering.
		const messages = [
			userMessage([
				new vscode.LanguageModelTextPart('before-image'),
				pngPart(),
				new vscode.LanguageModelTextPart('after-image'),
			]),
		];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const content = result.messages[0]!.content as readonly unknown[];
		expect(content).toHaveLength(3);
		// Order preserved: text0, replaced-image-text1, text2.
		expect(extractText(content[0])).toBe('before-image');
		expect(extractText(content[2])).toBe('after-image');
		// Middle part is now a text part carrying the file path.
		expect(content[1]).toBeInstanceOf(vscode.LanguageModelTextPart);
		expect(extractText(content[1])).toMatch(/\.png/);
	});

	it('wraps the path prompt in leading AND trailing newlines (PR #15 F7)', async () => {
		// The replacement text must start AND end with a newline. convert.ts
		// merges adjacent text parts by concatenation, so a trailing-newline-
		// less prompt would be glued to a following text part.
		const messages = [userMessage([new vscode.LanguageModelTextPart('请分析这张图'), pngPart()])];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const content = result.messages[0]!.content as readonly unknown[];
		const pathText = extractText(content[1]);
		expect(pathText.startsWith('\n')).toBe(true);
		// [F7] Trailing newline so the FOLLOWING text part is not glued on.
		expect(pathText.endsWith('\n')).toBe(true);
	});

	it('keeps a clear separator on BOTH sides through the full convert pipeline (PR #15 F7)', async () => {
		// The real regression from PR #15 F7: after convertMessages merges
		// adjacent text parts, a prompt lacking a trailing newline would
		// produce "...process it with an image-capable MCP tool.after-image".
		// Verify the FINAL GLM message string keeps both boundaries.
		const messages = [
			userMessage([
				new vscode.LanguageModelTextPart('before-image'),
				pngPart(),
				new vscode.LanguageModelTextPart('after-image'),
			]),
		];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const glm = convertMessages(result.messages, false);
		// Exactly one user message survived (content is non-empty).
		const userMsg = glm.find((m) => m.role === 'user');
		expect(userMsg).toBeDefined();
		const contentStr = typeof userMsg!.content === 'string' ? userMsg!.content : '';
		// The leading text survives.
		expect(contentStr).toContain('before-image');
		// The trailing text survives.
		expect(contentStr).toContain('after-image');
		// CRITICAL (the F7 bug): without a leading newline, before-image and the
		// prompt would merge as "before-image[Image attached...]". Without a
		// trailing newline, the prompt's final sentence and after-image would
		// merge as "...MCP tool.after-image". Both boundaries must be newlines.
		expect(contentStr).toMatch(/before-image\n+\[Image/);
		expect(contentStr).toMatch(/after-image$/);
		// The prompt's trailing text and after-image MUST be separated by a
		// newline (the bug produced "tool. after-image" with no separator, or
		// worse, "tool.after-image" glued directly).
		expect(contentStr).toMatch(/\nafter-image$/);
		// And explicitly: no direct glue between the prompt body and after-image.
		expect(contentStr).not.toMatch(/tool\. ?after-image/);
		expect(contentStr).not.toMatch(/\.after-image/);
	});

	it('wraps the unavailable marker in leading AND trailing newlines (PR #15 F7)', async () => {
		// Same symmetric-separator rule applies to the unavailable fallback.
		registerFailingResize();
		const messages = [
			userMessage([
				new vscode.LanguageModelTextPart('before'),
				gifPart(),
				new vscode.LanguageModelTextPart('after'),
			]),
		];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const content = result.messages[0]!.content as readonly unknown[];
		const markerText = extractText(content[1]);
		expect(markerText.startsWith('\n')).toBe(true);
		expect(markerText.endsWith('\n')).toBe(true);
		expect(markerText).toContain(IMAGE_DESCRIPTION_UNAVAILABLE);
	});

	it('handles multiple images in one message with "Image n of m" labels', async () => {
		const messages = [userMessage([pngPart(0x11), pngPart(0x22), pngPart(0x33)])];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const content = result.messages[0]!.content as readonly unknown[];
		expect(content).toHaveLength(3);
		expect(extractText(content[0])).toMatch(/Image 1 of 3/);
		expect(extractText(content[1])).toMatch(/Image 2 of 3/);
		expect(extractText(content[2])).toMatch(/Image 3 of 3/);
		// All three stored to distinct files (different content hashes).
		expect(result.stats.droppedImageParts).toBe(3);
	});

	it('preserves per-message image numbering across multiple messages', async () => {
		// Image ordinal resets per message (each message's images are counted
		// independently as "Image n of m" within that message).
		const messages = [
			userMessage([pngPart(0x11), pngPart(0x22)]),
			assistantMessage([new vscode.LanguageModelTextPart('reply')]),
			userMessage([pngPart(0x33)]),
		];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const user1 = result.messages[0]!.content as readonly unknown[];
		const user2 = result.messages[2]!.content as readonly unknown[];
		// First user message: 2 images, labeled 1/2 and 2/2.
		expect(extractText(user1[0])).toMatch(/Image 1 of 2/);
		expect(extractText(user1[1])).toMatch(/Image 2 of 2/);
		// Second user message: 1 image, bare "Image" label (not "1 of 1").
		expect(extractText(user2[0])).not.toMatch(/Image 1 of 1/);
		expect(extractText(user2[0])).toMatch(/Image/);
		// Assistant message untouched.
		expect(extractText((result.messages[1]!.content as readonly unknown[])[0])).toBe('reply');
	});
});

describe('resolveImageMessages — mcp mode across mixed content', () => {
	it('leaves pure-text messages completely untouched', async () => {
		const messages = [
			userMessage([new vscode.LanguageModelTextPart('only text')]),
			userMessage([new vscode.LanguageModelTextPart('more text')]),
		];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		// No image parts -> no replacements -> same array contents.
		expect(extractText((result.messages[0]!.content as readonly unknown[])[0])).toBe('only text');
		expect(extractText((result.messages[1]!.content as readonly unknown[])[0])).toBe('more text');
		expect(result.stats.inputImageParts).toBe(0);
	});

	it('reuses the same stored file when identical image content repeats', async () => {
		// Content-addressable: same bytes -> same path, referenced twice.
		const messages = [userMessage([pngPart(0x99)]), userMessage([pngPart(0x99)])];
		const result = await resolveImageMessages(messages, token, unusedDescriber, 'mcp');
		const path1 = extractText((result.messages[0]!.content as readonly unknown[])[0]);
		const path2 = extractText((result.messages[1]!.content as readonly unknown[])[0]);
		expect(path1).toBe(path2);
	});
});
