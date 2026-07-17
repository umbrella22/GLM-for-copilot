import vscode from 'vscode';
import { CONFIG_SECTION } from '../../consts';

/**
 * [FORK] Image-capable MCP tool detection (PR #15 Finding 2).
 *
 * MCP vision mode strips images to disk and leaves a file-path prompt in the
 * conversation, relying on an image-capable MCP tool (e.g. `image_analysis`,
 * `extract_text_from_screenshot`) to read them back. The earlier guard in
 * `request.ts` only checked "ANY tool exists", so a session with only ordinary
 * tools (web search, terminal, edits) would pass the guard, images would be
 * stripped, and the model would have no way to read them — a silent loss.
 *
 * VS Code does not expose a per-tool "supports images" capability flag, so we
 * match tool names against an explicit allowlist. No heuristic guessing: a
 * false positive (treating a text tool as image-capable) means images get
 * stripped with no reader, which is exactly the bug we are fixing. A false
 * negative (treating a real vision tool as non-capable) is safe — it falls
 * back to the vision proxy instead.
 *
 * The allowlist is user-extensible via `glm-copilot.mcp.imageCapableTools` so
 * third-party / custom MCP servers can be recognized without code changes.
 */

/**
 * Default allowlist of image-capable MCP tool names.
 *
 * These are the vision tools shipped by the official GLM `@z_ai/mcp-server`
 * (the stdio built-in), sourced from the server's published tool list. Only
 * tools that actually ACCEPT an image input are listed — e.g. `video_analysis`
 * is excluded because it only accepts video file paths and the MCP vision path
 * only strips `image/*` parts, so listing it would be a false positive.
 *
 * Keep this in sync with the `default` of `glm-copilot.mcp.imageCapableTools`
 * in package.json.
 */
export const DEFAULT_IMAGE_CAPABLE_TOOLS: readonly string[] = [
	'ui_to_artifact',
	'extract_text_from_screenshot',
	'diagnose_error_screenshot',
	'understand_technical_diagram',
	'analyze_data_visualization',
	'ui_diff_check',
	'image_analysis',
];

/**
 * Read the effective image-capable tool allowlist: the built-in defaults
 * unioned with whatever the user added via `glm-copilot.mcp.imageCapableTools`.
 *
 * User entries are NOT filtered against the defaults — if a user lists a name
 * that is already in the defaults, the union dedupes it. Invalid entries
 * (non-strings / blank) are dropped defensively.
 */
export function readImageCapableTools(): Set<string> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const userAdded = config.get<string[]>('mcp.imageCapableTools', []);
	const merged = new Set<string>(DEFAULT_IMAGE_CAPABLE_TOOLS);
	for (const name of userAdded) {
		if (typeof name === 'string' && name.trim().length > 0) {
			merged.add(name.trim());
		}
	}
	return merged;
}

/**
 * Whether a tool name refers to an image-capable MCP tool.
 *
 * Matching is name-based and tolerant of the MCP name-prefix conventions used
 * by different VS Code versions:
 *   - Exact match: `image_analysis`
 *   - Suffix match: `mcp__zai-mcp-server__image_analysis` (the fully-qualified
 *     MCP tool name format) — matches when the allowlist entry equals the
 *     segment after the last `__`.
 *
 * This lets users write short names in the allowlist regardless of how VS Code
 * qualifies the tool name at runtime.
 */
export function isImageCapableTool(toolName: string, allowlist: ReadonlySet<string>): boolean {
	if (typeof toolName !== 'string' || toolName.length === 0) {
		return false;
	}
	if (allowlist.has(toolName)) {
		return true;
	}
	// Suffix match: `mcp__<server>__<tool>` -> `<tool>`.
	const lastSeparator = toolName.lastIndexOf('__');
	if (lastSeparator >= 0 && lastSeparator + 2 < toolName.length) {
		const shortName = toolName.slice(lastSeparator + 2);
		return allowlist.has(shortName);
	}
	return false;
}

/**
 * Whether any of the tools available for this request is image-capable,
 * i.e. the model would actually have a way to read back images that MCP
 * vision mode strips to disk.
 *
 * `options.tools` is the list VS Code collected from all enabled providers
 * (built-in editor tools + MCP server tools). We only inspect tool names;
 * descriptions are intentionally NOT used as a signal — they are too easy to
 * misclassify and a false positive here silently loses images.
 */
export function hasImageCapableTool(
	options: vscode.ProvideLanguageModelChatResponseOptions,
	allowlist: ReadonlySet<string>,
): boolean {
	const tools = options.tools;
	if (!tools || tools.length === 0) {
		return false;
	}
	return tools.some((tool) => isImageCapableTool(tool.name, allowlist));
}
