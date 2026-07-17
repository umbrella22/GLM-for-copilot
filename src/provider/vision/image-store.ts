import vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../logger';
import { detectImageMimeType, resizeImage } from './shared/resize';

/**
 * Image store: persists user-sent images to temporary files so that MCP
 * vision tools (like `analyze_image`) can read them by local file path
 * instead of receiving base64 data in the message context.
 *
 * Lifecycle:
 *   - Files are stored under `<globalStorage>/mcp-images/<hash>.<ext>`.
 *   - The globalStorage is tied to the extension and persists across sessions
 *     unless the user clears extension data. This aligns with chat session
 *     persistence: if the session survives, images survive; if VS Code
 *     clears extension storage, images are cleaned up too.
 *   - File names are content-hashed so the same image is only stored once.
 *
 * [FORK] Cleanup strategy (PR review feedback):
 *   - Mode is user-controlled via `glm-copilot.mcp.imageCleanupMode`:
 *     'manual' (default) — never auto-delete; user runs the
 *     "GLM: Clean Up Stored Images" command.
 *     'ttl-7d' — on activation, delete files whose mtime is older than 7 days.
 *   - Reusing a file refreshes its mtime via `utimes`, so actively-referenced
 *     images survive TTL cleanup. This is an advantage over VS Code's own
 *     `cleanupOldImages` (which encodes the timestamp in the filename and
 *     cannot refresh it).
 */

const IMAGE_DIR_NAME = 'mcp-images';

/**
 * Downstream constraint of the built-in GLM vision MCP
 * (`@z_ai/mcp-server@0.1.4`): only .jpg/.jpeg/.png, max 5 MiB per image.
 * Inputs outside this envelope are normalized (converted/resized) before
 * being written to disk; if normalization fails the image is rejected.
 */
const MCP_DOWNSTREAM_MAX_BYTES = 5 * 1024 * 1024;
const MCP_DOWNSTREAM_ACCEPTED_MIME = new Set(['image/jpeg', 'image/png']);

/** 7-day TTL in milliseconds, used when cleanup mode is 'ttl-7d'. */
const TTL_7D_MS = 7 * 24 * 60 * 60 * 1000;

export type ImageCleanupMode = 'manual' | 'ttl-7d';

let storageRoot: string | undefined;

/**
 * Initialize the image store with the extension's global storage path.
 * Called once during activation. Also runs the cleanup pass when the user
 * has selected an automatic TTL mode.
 */
export async function initImageStore(globalStorageUri: vscode.Uri): Promise<void> {
	storageRoot = join(globalStorageUri.fsPath, IMAGE_DIR_NAME);
	try {
		await mkdir(storageRoot, { recursive: true });
		logger.info(`Image store initialized at ${storageRoot}`);
	} catch (error) {
		logger.warn('Failed to initialize image store', error);
	}
	// [FORK] Best-effort cleanup on activation; never fatal.
	try {
		await runAutomaticCleanup();
	} catch (error) {
		logger.warn('Image store automatic cleanup failed', error);
	}
}

/**
 * Persist an image's binary data to a temporary file and return the
 * absolute file path. If the same content was already stored, the existing
 * file is reused (content-addressable) and its mtime is refreshed so TTL
 * cleanup keeps actively-referenced images.
 *
 * Input is normalized to JPEG/PNG and capped at `MCP_DOWNSTREAM_MAX_BYTES`
 * before being written, so the file on disk always satisfies the built-in
 * GLM vision MCP's input contract. Returns `undefined` when normalization
 * fails or storage is not initialized.
 *
 * @param data Raw image bytes (any common image format)
 * @param mimeType Declared MIME type (will be verified via magic bytes)
 * @param token Cancellation token
 * @returns Absolute file path to the stored image, or `undefined` on failure
 */
export async function storeImage(
	data: Uint8Array,
	mimeType: string,
	token?: vscode.CancellationToken,
): Promise<string | undefined> {
	if (!storageRoot) {
		logger.warn('Image store not initialized; falling back to base64');
		return undefined;
	}

	// [FORK] Normalize to the downstream MCP's accepted envelope before
	// hashing/storing, so the content hash reflects what is actually on disk
	// and two different source encodings of the same pixels still hash
	// differently (correctly — they may have been resized).
	const normalized = await normalizeImageForDownstream(data, mimeType, token);
	if (!normalized) {
		logger.warn(
			`Image rejected by normalization (mime=${mimeType}, bytes=${data.byteLength}); falling back to unavailable marker`,
		);
		return undefined;
	}

	const ext = normalized.mimeType === 'image/png' ? 'png' : 'jpg';
	const hash = createHash('sha256').update(Buffer.from(normalized.data)).digest('hex').slice(0, 16);
	const fileName = `${hash}.${ext}`;
	const filePath = join(storageRoot, fileName);

	try {
		// [FORK] Use `wx` (exclusive create) so an existing file is NOT
		// truncated/rewritten — content-addressable means same hash = same
		// bytes, so rewriting would only waste I/O and risk a partial-read
		// race with an MCP tool reading the file at the same moment. On
		// EEXIST we treat the file as successfully reused and refresh mtime.
		await writeFile(filePath, normalized.data, { flag: 'wx' });
	} catch (error) {
		if (!isAlreadyExistsError(error)) {
			logger.warn(`Failed to store image to ${filePath}`, error);
			return undefined;
		}
		// File already exists: content-addressable reuse succeeded.
	}

	// [FORK] Refresh mtime on both the create and reuse paths so TTL cleanup
	// treats this image as recently referenced. utimes is atomic and cheap.
	try {
		const now = new Date();
		await utimes(filePath, now, now);
	} catch {
		// Non-fatal: mtime refresh is a best-effort optimization.
	}

	return filePath;
}

/**
 * Normalize an image to the envelope accepted by the built-in GLM vision MCP
 * (JPEG/PNG, <= MCP_DOWNSTREAM_MAX_BYTES).
 *
 * Steps:
 *   1. Detect the true MIME via magic bytes (ignore the declared mime, which
 *      is often `image/png` for unknown types and would mislead downstream).
 *   2. If already JPEG/PNG and within the size budget, keep as-is.
 *   3. Otherwise, ask VS Code to resize/convert. Re-detect the output mime
 *      and verify the result is JPEG/PNG and within budget; reject if not.
 *
 * Returns `undefined` when normalization cannot satisfy the envelope.
 */
async function normalizeImageForDownstream(
	data: Uint8Array,
	declaredMimeType: string,
	token?: vscode.CancellationToken,
): Promise<{ data: Uint8Array; mimeType: string } | undefined> {
	if (token?.isCancellationRequested) {
		return undefined;
	}

	// If no cancellation token was provided, use a never-cancelled dummy so
	// resizeImage's cancellation checks pass through cleanly.
	const effectiveToken = token ?? neverCancelledToken();

	const detected = detectImageMimeType(data) ?? declaredMimeType;
	const isAccepted = MCP_DOWNSTREAM_ACCEPTED_MIME.has(detected);
	const withinBudget = data.byteLength <= MCP_DOWNSTREAM_MAX_BYTES;

	if (isAccepted && withinBudget) {
		return { data, mimeType: detected };
	}

	// Need conversion and/or resize. resizeImage delegates to VS Code's
	// `_chat.resizeImage`, which handles both dimension and format conversion.
	try {
		const resized = await resizeImage(data, detected, effectiveToken);
		if (effectiveToken.isCancellationRequested) {
			return undefined;
		}
		const finalMime = detectImageMimeType(resized.data) ?? resized.mimeType;
		if (
			MCP_DOWNSTREAM_ACCEPTED_MIME.has(finalMime) &&
			resized.data.byteLength <= MCP_DOWNSTREAM_MAX_BYTES
		) {
			return { data: resized.data, mimeType: finalMime };
		}
		// resizeImage output still does not fit the envelope (e.g. the source
		// was too large to shrink under the budget, or conversion produced an
		// unsupported type). Give up rather than ship a file the MCP rejects.
		return undefined;
	} catch {
		return undefined;
	}
}

/** Build a CancellationToken that never trips. Used when callers omit one. */
function neverCancelledToken(): vscode.CancellationToken {
	const source = new vscode.CancellationTokenSource();
	// Intentionally never cancel; source is held for process lifetime.
	return source.token;
}

/** Cross-platform EEXIST detection (Node exposes `code` on fs errors). */
function isAlreadyExistsError(error: unknown): boolean {
	return (
		typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST'
	);
}

/**
 * Build a human-readable text prompt that tells the model an image was
 * attached and where to find it on disk. The model can then call an
 * appropriate MCP vision tool to read the image by path.
 *
 * The text is kept short (~50 tokens) to avoid context bloat from base64.
 * It does NOT name any specific MCP tool — the model decides which tool
 * fits the task (analyze_image, extract_text_from_screenshot, etc.).
 */
/**
 * Default template for the per-image stored prompt. Keep in sync with
 * `glm-copilot.imageStoredPrompt.default` in package.json.
 * Supports positional placeholders: {0}=label (e.g. "Image" or "Image 2 of 3"),
 * {1}=file path.
 */
const DEFAULT_IMAGE_STORED_PROMPT =
	'[{0} attached at local file: {1}]\n' +
	'This image cannot be displayed inline; process it with an image-capable MCP tool. ' +
	'The file name is a content hash — if you have already analyzed this path in this ' +
	'conversation, reuse that analysis unless you need new detail, the image has changed, ' +
	'or the requested output type differs from the prior analysis (see the output-type match ' +
	'rule in the system image-handling instruction). ';

/**
 * Build a human-readable text prompt that tells the model an image was
 * attached and where to find it on disk. The model can then call an
 * appropriate MCP vision tool to read the image by path.
 *
 * The template is user-configurable via `glm-copilot.imageStoredPrompt`
 * and supports {0}=label, {1}=filePath placeholders.
 *
 * The text is kept short (~50 tokens) to avoid context bloat from base64.
 * It does NOT name any specific MCP tool — the model decides which tool
 * fits the task (analyze_image, extract_text_from_screenshot, etc.).
 */
export function buildImagePromptText(filePath: string, index: number, total: number): string {
	const label = total > 1 ? `Image ${index + 1} of ${total}` : 'Image';
	const config = vscode.workspace.getConfiguration('glm-copilot');
	const template =
		config.get<string>('imageStoredPrompt', DEFAULT_IMAGE_STORED_PROMPT) ||
		DEFAULT_IMAGE_STORED_PROMPT;
	return template.replace('{0}', label).replace('{1}', filePath);
}

/**
 * [FORK] Read the user's selected image cleanup mode from settings.
 * Defaults to 'manual' (no automatic deletion) to avoid surprising data loss.
 */
export function getImageCleanupMode(): ImageCleanupMode {
	const config = vscode.workspace.getConfiguration('glm-copilot');
	const value = config.get<string>('mcp.imageCleanupMode', 'manual');
	return value === 'ttl-7d' ? 'ttl-7d' : 'manual';
}

/**
 * [FORK] Run the automatic cleanup pass if the user opted into TTL mode.
 * In 'manual' mode this is a no-op — images stay until the user invokes
 * `glm-copilot.cleanupStoredImages`.
 */
export async function runAutomaticCleanup(): Promise<number> {
	if (!storageRoot || getImageCleanupMode() !== 'ttl-7d') {
		return 0;
	}
	return cleanupExpired(TTL_7D_MS);
}

/**
 * [FORK] Delete all stored images regardless of age. Used by the
 * "GLM: Clean Up Stored Images" command (manual mode).
 *
 * @returns number of files deleted
 */
export async function cleanupAllStoredImages(): Promise<number> {
	if (!storageRoot) {
		return 0;
	}
	return cleanupExpired(0);
}

/** Delete files whose mtime is older than `maxAgeMs` (0 = delete everything). */
async function cleanupExpired(maxAgeMs: number): Promise<number> {
	if (!storageRoot) {
		return 0;
	}
	let entries: string[];
	try {
		entries = await readdir(storageRoot);
	} catch {
		return 0;
	}
	const now = Date.now();
	let deleted = 0;
	await Promise.all(
		entries.map(async (name) => {
			const filePath = join(storageRoot!, name);
			try {
				const st = await stat(filePath);
				if (!st.isFile()) {
					return;
				}
				if (maxAgeMs === 0 || now - st.mtimeMs > maxAgeMs) {
					await unlink(filePath);
					deleted += 1;
				}
			} catch {
				// Best-effort; a missing/transient file is not fatal.
			}
		}),
	);
	if (deleted > 0) {
		logger.info(
			`Image store cleanup removed ${deleted} file(s) (mode=${maxAgeMs === 0 ? 'all' : 'ttl'}).`,
		);
	}
	return deleted;
}
