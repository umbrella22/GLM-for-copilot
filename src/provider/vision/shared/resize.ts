import vscode from 'vscode';

/**
 * [FORK] Shared image resize / format-detection helpers used by both the
 * `native` vision pipeline (resize + base64 inline) and the `mcp` vision
 * pipeline (normalize + persist to disk for MCP tools).
 *
 * Extracted as a shared module so the two pipelines stay consistent and so
 * neither has to reach into the other's internals. The actual resizing is
 * delegated to VS Code's internal `_chat.resizeImage` command (the same one
 * the chat input uses for pasted images), which already handles aspect
 * ratio, size budgets, and format conversion.
 */

export interface ResizedImage {
	data: Uint8Array;
	mimeType: string;
	resizeFailed: boolean;
}

/**
 * Resize an image via VS Code's internal `_chat.resizeImage` command.
 *
 * Returns the original bytes with `resizeFailed: true` when the resize
 * command is unavailable or errors out, so callers can decide on a fallback.
 * Throws `vscode.CancellationError` if the token is cancelled.
 */
export async function resizeImage(
	data: Uint8Array,
	mimeType: string,
	token: vscode.CancellationToken,
): Promise<ResizedImage> {
	throwIfCancellationRequested(token);

	try {
		const resized = await vscode.commands.executeCommand<unknown>(
			'_chat.resizeImage',
			data,
			mimeType,
		);
		throwIfCancellationRequested(token);
		if (!(resized instanceof Uint8Array) || resized.byteLength === 0) {
			return { data, mimeType, resizeFailed: true };
		}
		return {
			data: resized,
			mimeType: detectImageMimeType(resized) ?? mimeType,
			resizeFailed: false,
		};
	} catch {
		throwIfCancellationRequested(token);
		return { data, mimeType, resizeFailed: true };
	}
}

/**
 * Detect an image's true MIME type from its magic bytes. Returns `undefined`
 * when the format is not recognized (caller should keep the declared type).
 *
 * Recognized: png, jpeg, gif, webp. Other types (bmp, svg, tiff) are left
 * for the caller to handle — the downstream vision MCP we target only
 * accepts jpg/png anyway, so those would be rejected at normalization time.
 */
export function detectImageMimeType(data: Uint8Array): string | undefined {
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

function throwIfCancellationRequested(token: vscode.CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
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
