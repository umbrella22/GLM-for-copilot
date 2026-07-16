import vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../logger';

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
 */

const IMAGE_DIR_NAME = 'mcp-images';

let storageRoot: string | undefined;

/**
 * Initialize the image store with the extension's global storage path.
 * Called once during activation.
 */
export async function initImageStore(globalStorageUri: vscode.Uri): Promise<void> {
	storageRoot = join(globalStorageUri.fsPath, IMAGE_DIR_NAME);
	try {
		await mkdir(storageRoot, { recursive: true });
		logger.info(`Image store initialized at ${storageRoot}`);
	} catch (error) {
		logger.warn('Failed to initialize image store', error);
	}
}

/**
 * Persist an image's binary data to a temporary file and return the
 * absolute file path. If the same content was already stored, the existing
 * file is reused (content-addressable).
 *
 * @param data Raw image bytes
 * @param mimeType MIME type (e.g. "image/png")
 * @returns Absolute file path to the stored image, or `undefined` on failure
 */
export async function storeImage(
	data: Uint8Array,
	mimeType: string,
): Promise<string | undefined> {
	if (!storageRoot) {
		logger.warn('Image store not initialized; falling back to base64');
		return undefined;
	}

	const ext = mimeToExtension(mimeType);
	const hash = createHash('sha256').update(Buffer.from(data)).digest('hex').slice(0, 16);
	const fileName = `${hash}.${ext}`;
	const filePath = join(storageRoot, fileName);

	try {
		// Write only if not already present (content-addressable: same hash = same file).
		// Using writeFile with flag 'wx' would fail if exists, but simpler to just write;
		// the OS handles overwriting identical content efficiently.
		await writeFile(filePath, data);
		return filePath;
	} catch (error) {
		logger.warn(`Failed to store image to ${filePath}`, error);
		return undefined;
	}
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

function mimeToExtension(mimeType: string): string {
	const map: Record<string, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/gif': 'gif',
		'image/webp': 'webp',
		'image/bmp': 'bmp',
		'image/svg+xml': 'svg',
	};
	return map[mimeType] ?? 'png';
}
