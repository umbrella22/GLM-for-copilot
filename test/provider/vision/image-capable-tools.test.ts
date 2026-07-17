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
	const allowlist = new Set<string>(['image_analysis', 'ui_to_artifact']);

	it('matches a short tool name exactly present in the allowlist', () => {
		expect(isImageCapableTool('image_analysis', allowlist)).toBe(true);
	});

	it('rejects a tool name not in the allowlist', () => {
		expect(isImageCapableTool('web_search', allowlist)).toBe(false);
	});

	it('matches a fully-qualified MCP name by its short suffix (mcp__<server>__<tool>)', () => {
		expect(isImageCapableTool('mcp__zai-mcp-server__image_analysis', allowlist)).toBe(true);
		expect(isImageCapableTool('mcp__my-server__ui_to_artifact', allowlist)).toBe(true);
	});

	it('rejects a fully-qualified name whose suffix is not in the allowlist', () => {
		expect(isImageCapableTool('mcp__server__web_search', allowlist)).toBe(false);
	});

	it('handles empty / non-string input defensively', () => {
		expect(isImageCapableTool('', allowlist)).toBe(false);
		// @ts-expect-error intentional invalid type for defensive test
		expect(isImageCapableTool(undefined, allowlist)).toBe(false);
	});

	it('does NOT match a suffix after a single underscore (only double-underscore qualifier)', () => {
		// `someprefix_image_analysis` has only one underscore and is NOT an MCP
		// qualified name; it must not match the short allowlist entry.
		expect(isImageCapableTool('someprefix_image_analysis', allowlist)).toBe(false);
	});
});

describe('image-capable-tools — hasImageCapableTool', () => {
	const allowlist = new Set<string>(['image_analysis']);

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
				optionsWith([{ name: 'web_search' }, { name: 'image_analysis' }]),
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
		expect(
			hasImageCapableTool(
				optionsWith([
					{ name: 'mcp__zai-mcp-server__web_search_prime' },
					{ name: 'mcp__my-tool__ui_to_artifact' },
				]),
				new Set(['ui_to_artifact']),
			),
		).toBe(true);
	});
});

describe('image-capable-tools — DEFAULT_IMAGE_CAPABLE_TOOLS', () => {
	it('covers all official zai-mcp-server vision tools (not video_analysis)', () => {
		// Sourced from the official @z_ai/mcp-server tool list. These are the
		// image-input tools; video_analysis is excluded because it only accepts
		// video file paths and the mcp vision path only strips image/* parts.
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('ui_to_artifact');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('extract_text_from_screenshot');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('diagnose_error_screenshot');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('understand_technical_diagram');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('analyze_data_visualization');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('ui_diff_check');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).toContain('image_analysis');
		// video_analysis intentionally excluded.
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).not.toContain('video_analysis');
		expect(DEFAULT_IMAGE_CAPABLE_TOOLS).not.toContain('analyze_video');
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
			'image_analysis', // already default; should dedupe
		]);
		const result = readImageCapableTools();
		expect(result.has('my_custom_vision_tool')).toBe(true);
		expect(result.has('image_analysis')).toBe(true);
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
