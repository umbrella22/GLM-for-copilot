import vscode from 'vscode';
import { CONFIG_SECTION } from '../../consts';

/**
 * Read exact tool ids the user has explicitly declared image-capable.
 *
 * VS Code generates MCP tool prefixes from live server metadata, truncates
 * them, and adds collision suffixes. A short-name or suffix allowlist cannot
 * therefore identify the tool boundary reliably. Overrides are exact runtime
 * ids only; the common path is detected from each tool's input schema below.
 */
export function readImageCapableToolOverrides(): Set<string> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const configured = config.get<unknown>('mcp.imageCapableTools', []);
	const result = new Set<string>();
	if (!Array.isArray(configured)) {
		return result;
	}
	for (const name of configured) {
		if (typeof name === 'string' && name.trim().length > 0) {
			result.add(name.trim());
		}
	}
	return result;
}

/**
 * Whether a tool can receive a stored local image path.
 *
 * Official `@z_ai/mcp-server` image tools expose a required string input such
 * as `image_source`, `expected_image_source`, or `actual_image_source`, whose
 * schema description explicitly accepts a local file path. That semantic
 * contract remains stable even when VS Code changes the generated MCP tool id.
 * Tools whose schemas cannot express this capability require an exact user
 * override through `glm-copilot.mcp.imageCapableTools`.
 */
export function isImageCapableTool(
	tool: vscode.LanguageModelChatTool,
	exactOverrides: ReadonlySet<string>,
	availableImageCount = 1,
): boolean {
	const imageInputCount = localImagePathInputCount(tool.inputSchema);
	return (
		exactOverrides.has(tool.name) || (imageInputCount > 0 && imageInputCount <= availableImageCount)
	);
}

/**
 * Whether a tool is POTENTIALLY image-capable, ignoring the request's image
 * count. Used by the non-mcp strip filter (`stripImageCapableToolsFromOptions`),
 * which removes EVERY image-capable tool regardless of how many images the
 * current request carries — unlike `isImageCapableTool`, whose count gate
 * serves the mcp-mode guard's "can this tool read these N images" question.
 */
export function isPotentiallyImageCapableTool(
	tool: vscode.LanguageModelChatTool,
	exactOverrides: ReadonlySet<string>,
): boolean {
	return exactOverrides.has(tool.name) || localImagePathInputCount(tool.inputSchema) > 0;
}

/** Whether any available tool can read an image path emitted by MCP mode. */
export function hasImageCapableTool(
	options: vscode.ProvideLanguageModelChatResponseOptions,
	exactOverrides: ReadonlySet<string>,
	availableImageCount = 1,
): boolean {
	return (
		options.tools?.some((tool) => isImageCapableTool(tool, exactOverrides, availableImageCount)) ??
		false
	);
}

function localImagePathInputCount(schema: object | undefined): number {
	if (
		!isRecord(schema) ||
		schema.type !== 'object' ||
		!isRecord(schema.properties) ||
		!Array.isArray(schema.required)
	) {
		return 0;
	}
	const required = new Set(
		schema.required.filter((name): name is string => typeof name === 'string'),
	);
	let count = 0;
	for (const [name, propertySchema] of Object.entries(schema.properties)) {
		if (
			!required.has(name) ||
			!(name === 'image_source' || name.endsWith('_image_source')) ||
			!isRecord(propertySchema)
		) {
			continue;
		}
		if (propertySchema.type !== 'string' || typeof propertySchema.description !== 'string') {
			continue;
		}
		if (/\blocal\s+(?:file\s+)?path\b/i.test(propertySchema.description)) {
			count += 1;
		}
	}
	return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * [FORK] PR #18: Remove image-capable MCP tools from a request's options.
 *
 * native and proxy vision modes give the model its own image path — native
 * inlines the image bytes, proxy replaces them with a text description. In
 * both modes an image-capable MCP tool in the list is redundant AND actively
 * harmful: tested models (e.g. glm-5v-turbo) get lured into calling the MCP
 * vision tool instead of using their own native vision, and hand it VS Code
 * attachment placeholders (e.g. `attachment:0`) the tool cannot resolve,
 * producing tool errors. So for non-mcp modes we strip these tools before
 * they ever reach the model.
 *
 * mcp mode is the ONE case that needs image-capable tools (the model reads
 * images through them), so the caller must skip this filter when
 * visionMode === 'mcp'. This function is intentionally visionMode-agnostic —
 * the mode decision lives in the request layer — it only does the mechanical
 * removal against the supplied allowlist.
 *
 * Returns the SAME options object when nothing was removed (no tools, or no
 * image-capable tool present), so the common case pays no shallow-copy cost
 * and reference-equality callers can detect "unchanged".
 */
export function stripImageCapableToolsFromOptions(
	options: vscode.ProvideLanguageModelChatResponseOptions,
	exactOverrides: ReadonlySet<string>,
): vscode.ProvideLanguageModelChatResponseOptions {
	const tools = options.tools;
	if (!tools || tools.length === 0) {
		return options;
	}
	// Strip ANY image-capable tool regardless of how many images this request
	// carries — a native/proxy model must not see image-capable MCP tools at
	// all. `isPotentiallyImageCapableTool` ignores the request's image count
	// (unlike the mcp-mode guard's `isImageCapableTool`, which gates by count),
	// so multi-image tools like ui_diff_check are also removed here.
	const filtered = tools.filter((tool) => !isPotentiallyImageCapableTool(tool, exactOverrides));
	if (filtered.length === tools.length) {
		return options;
	}
	return { ...options, tools: filtered };
}
