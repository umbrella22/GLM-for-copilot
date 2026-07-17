import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
	DEFAULT_IMAGE_CAPABLE_TOOLS,
	hasImageCapableTool,
	isImageCapableTool,
	readImageCapableTools,
} from '../../../src/provider/vision/image-capable-tools';
import { __clearConfigurationValues, __setConfigurationValue } from '../../support/vscode.mock';

describe('image-capable-tools — isImageCapableTool', () => {
	const allowlist = new Set<string>(['analyze_image', 'ui_to_artifact']);

	it('matches a short tool name exactly present in the allowlist', () => {
		expect(isImageCapableTool('analyze_image', allowlist)).toBe(true);
	});

	it('rejects a tool name not in the allowlist', () => {
		expect(isImageCapableTool('web_search', allowlist)).toBe(false);
	});

	it('matches a fully-qualified MCP name by its short suffix (mcp_<server>_<tool>)', () => {
		// VS Code's real MCP id format: McpToolName.Prefix='mcp_' + safeServerName
		// + '_' + toolName, all SINGLE underscores. See McpPrefixGenerator in
		// vscode/src/vs/workbench/contrib/mcp/common/mcpServer.ts.
		expect(isImageCapableTool('mcp_zai-mcp-server_analyze_image', allowlist)).toBe(true);
		expect(isImageCapableTool('mcp_my-server_ui_to_artifact', allowlist)).toBe(true);
	});

	it('matches even when the server name itself contains underscores', () => {
		// Custom server whose safe name has underscores: the endsWith('_<tool>')
		// check must still find the allowlist entry regardless of how many
		// underscores precede it in the server portion.
		expect(isImageCapableTool('mcp_my_custom_srv_analyze_image', allowlist)).toBe(true);
	});

	it('rejects a fully-qualified name whose suffix is not in the allowlist', () => {
		expect(isImageCapableTool('mcp_server_web_search', allowlist)).toBe(false);
	});

	it('handles empty / non-string input defensively', () => {
		expect(isImageCapableTool('', allowlist)).toBe(false);
		// @ts-expect-error intentional invalid type for defensive test
		expect(isImageCapableTool(undefined, allowlist)).toBe(false);
	});

	it('does NOT match a non-MCP name that merely ends with an allowlist entry', () => {
		// The `mcp_` start-anchor is what proves this is an MCP tool id. A
		// built-in editor tool whose name happens to end with the same suffix
		// must not be misclassified as image-capable.
		expect(isImageCapableTool('someprefix_analyze_image', allowlist)).toBe(false);
		expect(isImageCapableTool('debugger_ui_to_artifact', allowlist)).toBe(false);
	});

	it('REGRESSION: still matches the real VS Code id for the zai-mcp-server vision tool', () => {
		// Previous buggy implementation looked for a `__` double-underscore
		// separator that NEVER appears in real VS Code MCP ids, so EVERY real
		// MCP vision tool was missed and F2 always fell back to the proxy.
		// Pin the real runtime id (single underscores, McpPrefixGenerator
		// format) so a revert to the old `__` logic fails this test loudly.
		// zai-mcp-server's safe name keeps its dashes (dash is in the allowed
		// charset [a-z0-9_.-]); the tool is analyze_image (NOT image_analysis).
		expect(isImageCapableTool('mcp_zai-mcp-server_analyze_image', allowlist)).toBe(true);
		expect(isImageCapableTool('mcp_zai-mcp-server_ui_to_artifact', allowlist)).toBe(true);
	});
});

describe('image-capable-tools — hasImageCapableTool', () => {
	const allowlist = new Set<string>(['analyze_image']);

	function optionsWith(
		tools: { name: string }[] | undefined,
	): vscode.ProvideLanguageModelChatResponseOptions {
		return {
			tools: tools as vscode.LanguageModelChatTool[] | undefined,
		} as vscode.ProvideLanguageModelChatResponseOptions;
	}

	it('returns true when at least one tool is image-capable', () => {
		expect(
			hasImageCapableTool(
				optionsWith([{ name: 'web_search' }, { name: 'analyze_image' }]),
				allowlist,
			),
		).toBe(true);
	});

	it('returns false when no tool is image-capable', () => {
		expect(
			hasImageCapableTool(optionsWith([{ name: 'web_search' }, { name: 'terminal' }]), allowlist),
		).toBe(false);
	});

	it('returns false when options.tools is undefined', () => {
		expect(hasImageCapableTool(optionsWith(undefined), allowlist)).toBe(false);
	});

	it('returns false when options.tools is an empty array', () => {
		expect(hasImageCapableTool(optionsWith([]), allowlist)).toBe(false);
	});

	it('recognizes fully-qualified names in a mixed tool set', () => {
		// Real VS Code MCP id format with single underscores.
		expect(
			hasImageCapableTool(
				optionsWith([
					{ name: 'mcp_zai-mcp-server_web_search_prime' },
					{ name: 'mcp_my-tool_ui_to_artifact' },
				]),
				new Set(['ui_to_artifact']),
			),
		).toBe(true);
	});
});

describe('image-capable-tools — DEFAULT_IMAGE_CAPABLE_TOOLS', () => {
	it('covers all official zai-mcp-server vision tools (not analyze_video)', () => {
		// Sourced from the official @z_ai/mcp-server tool list. These are the
		// image-input tools; analyze_video is excluded because it only accepts
		// video file paths and the mcp vision path only strips image/* parts.
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('ui_to_artifact');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('extract_text_from_screenshot');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('diagnose_error_screenshot');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('understand_technical_diagram');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('analyze_data_visualization');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('ui_diff_check');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('analyze_image');
		// analyze_video intentionally excluded (video-only input).
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).not.toContain('analyze_video');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).not.toContain('video_analysis');
	});
});

describe('image-capable-tools — readImageCapableTools (user extension)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('returns the defaults when the user has not configured anything', () => {
		const result = readImageCapableTools();
		for (const name of DEFAULT_IMAGE_CAPABLE_TOOLS) {
			expect(result.has(name)).toBe(true);
		}
	});

	it('unions user-added tool names with the defaults', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCapableTools', [
			'my_custom_vision_tool',
			'analyze_image', // already default; should dedupe
		]);
		const result = readImageCapableTools();
		expect(result.has('my_custom_vision_tool')).toBe(true);
		expect(result.has('analyze_image')).toBe(true);
		// Defaults still present.
		expect(result.has('ui_to_artifact')).toBe(true);
	});

	it('drops blank / invalid entries defensively', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCapableTools', [
			'  ',
			'valid_tool',
			// @ts-expect-error intentional invalid type for defensive test
			123,
		]);
		const result = readImageCapableTools();
		expect(result.has('valid_tool')).toBe(true);
		// Blank and non-string entries did not pollute the set.
		expect(result.has('')).toBe(false);
	});
});
