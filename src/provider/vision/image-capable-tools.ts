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
