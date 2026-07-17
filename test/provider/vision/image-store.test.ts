import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildImagePromptText,
	cleanupAllStoredImages,
	getImageCleanupMode,
	initImageStore,
	runAutomaticCleanup,
	storeImage,
} from '../../../src/provider/vision/image-store';
import { __clearConfigurationValues, __setConfigurationValue } from '../../support/vscode.mock';

// --- Test image byte fixtures (valid magic-byte prefixes) ---

/** Minimal PNG: 8-byte signature + enough bytes to exceed any hash slicing. */
function pngBytes(fill = 0xaa, size = 64): Uint8Array {
	const data = new Uint8Array(size);
	data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	data.fill(fill, 8);
	return data;
}

/** Minimal JPEG: 3-byte signature + fill. */
function jpegBytes(fill = 0xbb, size = 64): Uint8Array {
	const data = new Uint8Array(size);
	data.set([0xff, 0xd8, 0xff], 0);
	data.fill(fill, 3);
	return data;
}

/** GIF87a signature + fill. */
function gifBytes(size = 32): Uint8Array {
	const data = new Uint8Array(size);
	for (let i = 0; i < 6; i += 1) {
		data[i] = 'GIF87a'.charCodeAt(i);
	}
	return data;
}

/** WebP: RIFF....WEBP signature + fill. */
function webpBytes(size = 32): Uint8Array {
	const data = new Uint8Array(size);
	for (let i = 0; i < 4; i += 1) {
		data[i] = 'RIFF'.charCodeAt(i);
	}
	for (let i = 0; i < 4; i += 1) {
		data[8 + i] = 'WEBP'.charCodeAt(i);
	}
	return data;
}

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

let tmpRoot: string;

beforeEach(async () => {
	__clearConfigurationValues();
	// Fresh unique temp dir per test so storage state never leaks between tests.
	tmpRoot = await mkdtemp(join(tmpdir(), 'glm-image-store-test-'));
	// Default cleanup mode is manual (no auto-deletion) unless a test overrides.
	__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'manual');
	await initImageStore(vscode.Uri.file(tmpRoot));
	// Remove the _resize_ command mock between tests so a test that registers
	// its own does not leak into the next one.
	try {
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
	} catch {
		// ignore
	}
});

afterEach(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe('storeImage — accepted formats pass through (PR #14 review #10)', () => {
	it('stores a PNG within the 5 MiB budget unchanged', async () => {
		const data = pngBytes();
		const path = await storeImage(data, 'image/png', token);
		expect(path).toBeDefined();
		expect(path).toMatch(/\.png$/);
	});

	it('stores a JPEG within the 5 MiB budget unchanged', async () => {
		const data = jpegBytes();
		const path = await storeImage(data, 'image/jpeg', token);
		expect(path).toBeDefined();
		expect(path).toMatch(/\.jpg$/);
	});

	it('detects true mime from magic bytes even when declared mime is wrong', async () => {
		// PNG bytes declared as image/jpeg: should still be stored as .png because
		// detectImageMimeType inspects the bytes, not the declared header.
		const data = pngBytes();
		const path = await storeImage(data, 'image/jpeg', token);
		expect(path).toMatch(/\.png$/);
	});
});

describe('storeImage — content-addressable reuse (PR #14 review #7)', () => {
	it('returns the same path for identical content', async () => {
		const data = pngBytes(0x11);
		const path1 = await storeImage(data, 'image/png', token);
		const path2 = await storeImage(data, 'image/png', token);
		expect(path1).toBe(path2);
		const files = await readdir(join(tmpRoot, 'mcp-images'));
		expect(files).toHaveLength(1);
	});

	it('returns different paths for different content', async () => {
		const path1 = await storeImage(pngBytes(0x11), 'image/png', token);
		const path2 = await storeImage(pngBytes(0x22), 'image/png', token);
		expect(path1).not.toBe(path2);
		const files = await readdir(join(tmpRoot, 'mcp-images'));
		expect(files).toHaveLength(2);
	});
});

describe('storeImage — rejected formats (PR #14 review #10)', () => {
	it('rejects GIF when resize is unavailable (returns undefined)', async () => {
		// No _chat.resizeImage registered: resizeImage returns resizeFailed,
		// normalizeImageForDownstream returns undefined, storeImage returns undefined.
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
		const path = await storeImage(gifBytes(), 'image/gif', token);
		expect(path).toBeUndefined();
	});

	it('rejects WebP when resize is unavailable', async () => {
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
		const path = await storeImage(webpBytes(), 'image/webp', token);
		expect(path).toBeUndefined();
	});

	it('accepts GIF when resize returns a valid JPEG', async () => {
		// Simulate VS Code successfully converting gif -> jpeg.
		vscode.commands.registerCommand('_chat.resizeImage', () => jpegBytes());
		const path = await storeImage(gifBytes(), 'image/gif', token);
		expect(path).toBeDefined();
		expect(path).toMatch(/\.jpg$/);
	});

	it('rejects when resize returns something that is still not jpg/png', async () => {
		// resize returns gif bytes again (conversion did not help): still rejected.
		vscode.commands.registerCommand('_chat.resizeImage', () => gifBytes());
		const path = await storeImage(gifBytes(), 'image/gif', token);
		expect(path).toBeUndefined();
	});

	it('rejects when resize returns an empty Uint8Array', async () => {
		vscode.commands.registerCommand('_chat.resizeImage', () => new Uint8Array(0));
		const path = await storeImage(gifBytes(), 'image/gif', token);
		expect(path).toBeUndefined();
	});
});

describe('storeImage — size budget enforcement (PR #14 review #10)', () => {
	it('triggers resize for a PNG larger than 5 MiB', async () => {
		// Build a PNG that exceeds the 5 MiB budget. Register resize to return a
		// small valid JPEG so the normalization succeeds.
		const big = pngBytes(0x00, 6 * 1024 * 1024);
		let resizeCalled = false;
		vscode.commands.registerCommand('_chat.resizeImage', () => {
			resizeCalled = true;
			return jpegBytes(undefined, 1024);
		});
		const path = await storeImage(big, 'image/png', token);
		expect(resizeCalled).toBe(true);
		expect(path).toMatch(/\.jpg$/);
	});

	it('rejects when resize of an oversized image still exceeds the budget', async () => {
		// resize returns a JPEG that is STILL over 5 MiB: rejected.
		const big = pngBytes(0x00, 6 * 1024 * 1024);
		vscode.commands.registerCommand('_chat.resizeImage', () => jpegBytes(0x00, 6 * 1024 * 1024));
		const path = await storeImage(big, 'image/png', token);
		expect(path).toBeUndefined();
	});
});

/**
 * [FORK] PR #15 Finding 6: unrecognizable bytes must NOT be saved as PNG/JPEG
 * just because the caller declared an image MIME. The earlier `?? declaredMimeType`
 * fallback let arbitrary payloads bypass validation by declaring image/png,
 * only to fail later at the downstream MCP. Now the direct path requires a
 * POSITIVE magic-byte identification; unrecognizable bytes must be transcoded
 * and re-verified, or rejected.
 */
describe('storeImage — strict magic-byte direct path (PR #15 F6)', () => {
	/** Bytes that are NOT a recognized image format (random ASCII payload). */
	function unknownBytes(size = 32): Uint8Array {
		const data = new Uint8Array(size);
		// Deliberately NOT a PNG/JPEG/GIF/WEBP magic prefix.
		data.fill(0x41); // 'A' repeated
		return data;
	}

	it('rejects unknown bytes that DECLARE image/png when resize is unavailable', async () => {
		// The headline F6 bug: unknown payload + declared image/png + <5MiB
		// used to pass the direct path and ship as .png. Now it must be
		// rejected because magic bytes do not confirm PNG.
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
		const path = await storeImage(unknownBytes(), 'image/png', token);
		expect(path).toBeUndefined();
	});

	it('rejects unknown bytes that DECLARE image/jpeg when resize is unavailable', async () => {
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
		const path = await storeImage(unknownBytes(), 'image/jpeg', token);
		expect(path).toBeUndefined();
	});

	it('rejects unknown bytes even when resize ALSO returns unrecognizable output', async () => {
		// resize echoes the same unknown bytes back (conversion failed silently):
		// re-detection via magic bytes fails, so reject.
		vscode.commands.registerCommand('_chat.resizeImage', () => unknownBytes());
		const path = await storeImage(unknownBytes(), 'image/png', token);
		expect(path).toBeUndefined();
	});

	it('accepts unknown bytes ONLY when resize actually transcodes to valid JPEG', async () => {
		// The declared image/png is used as the conversion INPUT hint; resize
		// produces real JPEG bytes whose magic prefix is then re-verified.
		vscode.commands.registerCommand('_chat.resizeImage', () => jpegBytes());
		const path = await storeImage(unknownBytes(), 'image/png', token);
		expect(path).toBeDefined();
		expect(path).toMatch(/\.jpg$/);
	});

	it('still trusts positive magic-byte detection for genuine PNG', async () => {
		// Sanity: the strict check did not break the happy path for real PNGs.
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
		const path = await storeImage(pngBytes(), 'image/png', token);
		expect(path).toBeDefined();
		expect(path).toMatch(/\.png$/);
	});

	it('still trusts positive magic-byte detection even when declared mime is WRONG', async () => {
		// Real PNG bytes declared as image/jpeg: magic bytes win, saved as .png.
		vscode.commands.registerCommand('_chat.resizeImage', () => undefined);
		const path = await storeImage(pngBytes(), 'image/jpeg', token);
		expect(path).toMatch(/\.png$/);
	});
});

describe('getImageCleanupMode', () => {
	it('defaults to manual when nothing is configured', () => {
		__clearConfigurationValues();
		expect(getImageCleanupMode()).toBe('manual');
	});

	it('returns manual when explicitly set', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'manual');
		expect(getImageCleanupMode()).toBe('manual');
	});

	it('returns ttl-7d when set', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'ttl-7d');
		expect(getImageCleanupMode()).toBe('ttl-7d');
	});

	it('falls back to manual for unknown values', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'unexpected');
		expect(getImageCleanupMode()).toBe('manual');
	});
});

describe('runAutomaticCleanup', () => {
	it('is a no-op in manual mode (does not delete anything)', async () => {
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'manual');
		await storeImage(pngBytes(), 'image/png', token);
		const deleted = await runAutomaticCleanup();
		expect(deleted).toBe(0);
		const files = await readdir(join(tmpRoot, 'mcp-images'));
		expect(files).toHaveLength(1);
	});

	it('keeps fresh files in ttl-7d mode (mtime refreshed by storeImage)', async () => {
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'ttl-7d');
		await storeImage(pngBytes(), 'image/png', token);
		// File was just stored; mtime is now, so TTL cleanup must keep it.
		const deleted = await runAutomaticCleanup();
		expect(deleted).toBe(0);
		const files = await readdir(join(tmpRoot, 'mcp-images'));
		expect(files).toHaveLength(1);
	});
});

describe('cleanupAllStoredImages', () => {
	it('deletes all stored images regardless of age', async () => {
		await storeImage(pngBytes(0x11), 'image/png', token);
		await storeImage(pngBytes(0x22), 'image/png', token);
		expect(await readdir(join(tmpRoot, 'mcp-images'))).toHaveLength(2);

		const deleted = await cleanupAllStoredImages();
		expect(deleted).toBe(2);
		expect(await readdir(join(tmpRoot, 'mcp-images'))).toHaveLength(0);
	});

	it('returns 0 when no images are stored', async () => {
		expect(await cleanupAllStoredImages()).toBe(0);
	});
});

describe('buildImagePromptText', () => {
	it('renders a single-image label and the file path', () => {
		__clearConfigurationValues();
		const text = buildImagePromptText('/tmp/abc123.png', 0, 1);
		expect(text).toContain('Image');
		expect(text).toContain('/tmp/abc123.png');
		// Single image uses the bare label, not the "n of m" form.
		expect(text).not.toMatch(/Image 1 of 1/);
	});

	it('renders "Image n of m" for multi-image messages', () => {
		__clearConfigurationValues();
		const text = buildImagePromptText('/tmp/def456.png', 1, 3);
		expect(text).toContain('Image 2 of 3');
		expect(text).toContain('/tmp/def456.png');
	});

	it('honors a user-configured template overriding the default', () => {
		__setConfigurationValue('glm-copilot.imageStoredPrompt', 'IMG[{1}]#{0}');
		const text = buildImagePromptText('/tmp/x.png', 0, 1);
		// {0}=label, {1}=path
		expect(text).toBe('IMG[/tmp/x.png]#Image');
	});

	it('falls back to default template when configured value is empty', () => {
		__setConfigurationValue('glm-copilot.imageStoredPrompt', '');
		const text = buildImagePromptText('/tmp/x.png', 0, 1);
		expect(text).toContain('Image');
		expect(text).toContain('/tmp/x.png');
	});
});
