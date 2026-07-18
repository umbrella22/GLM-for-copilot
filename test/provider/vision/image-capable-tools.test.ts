import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
	hasImageCapableTool,
	isImageCapableTool,
	readImageCapableToolOverrides,
} from '../../../src/provider/vision/image-capable-tools';
import { __clearConfigurationValues, __setConfigurationValue } from '../../support/vscode.mock';

const localImageProperty = {
	type: 'string',
	description: 'Local file path or remote URL to the image',
};

describe('image-capable-tools — isImageCapableTool', () => {
	const overrides = new Set<string>();

	function chatTool(
		name: string,
		properties: Record<string, unknown> = {},
		required = Object.keys(properties),
	): vscode.LanguageModelChatTool {
		return {
			name,
			description: `${name} description`,
			inputSchema: { type: 'object', properties, required },
		};
	}

	it('matches a known tool only when its schema accepts the stored image path', () => {
		expect(
			isImageCapableTool(
				chatTool('analyze_image', { image_source: localImageProperty }),
				overrides,
			),
		).toBe(true);
	});

	it('rejects a tool without a local-image schema or exact override', () => {
		expect(isImageCapableTool(chatTool('web_search'), overrides)).toBe(false);
	});

	it('matches a qualified official tool with the expected image input schema', () => {
		// VS Code 1.116 limits the generated MCP prefix to 18 characters, so
		// `zai-mcp-server` is truncated in this runtime id.
		expect(
			isImageCapableTool(
				chatTool('mcp_zai-mcp-serve_analyze_image', {
					image_source: localImageProperty,
				}),
				overrides,
			),
		).toBe(true);
	});

	it('recognizes every official 0.1.4 image tool from its schema, not its generated id', () => {
		const singleImageTools = [
			'ui_to_artifact',
			'extract_text_from_screenshot',
			'diagnose_error_screenshot',
			'understand_technical_diagram',
			'analyze_data_visualization',
			'analyze_image',
		];
		for (const name of singleImageTools) {
			expect(
				isImageCapableTool(
					chatTool(`mcp_dynamic_prefix_${name}`, { image_source: localImageProperty }),
					overrides,
				),
				name,
			).toBe(true);
		}
		expect(
			isImageCapableTool(
				chatTool(
					'mcp_dynamic_prefix_ui_diff_check',
					{
						expected_image_source: localImageProperty,
						actual_image_source: localImageProperty,
					},
					['expected_image_source', 'actual_image_source'],
				),
				overrides,
				2,
			),
		).toBe(true);
		expect(
			isImageCapableTool(
				chatTool('mcp_dynamic_prefix_analyze_video', {
					video_source: {
						type: 'string',
						description: 'Local file path or remote URL to the video',
					},
				}),
				overrides,
			),
		).toBe(false);
	});

	it('requires both image inputs for the official UI diff tool', () => {
		expect(
			isImageCapableTool(
				chatTool(
					'mcp_zai-mcp-serve_ui_diff_check',
					{
						expected_image_source: localImageProperty,
						actual_image_source: localImageProperty,
					},
					['expected_image_source', 'actual_image_source'],
				),
				overrides,
				1,
			),
		).toBe(false);
		expect(
			isImageCapableTool(
				chatTool(
					'mcp_zai-mcp-serve_ui_diff_check',
					{
						expected_image_source: localImageProperty,
						actual_image_source: localImageProperty,
					},
					['expected_image_source', 'actual_image_source'],
				),
				overrides,
				2,
			),
		).toBe(true);
	});

	it('rejects a qualified name without a local-image schema', () => {
		expect(isImageCapableTool(chatTool('mcp_server_web_search'), overrides)).toBe(false);
	});

	it('rejects a bare known name when the tool cannot accept an image path', () => {
		expect(isImageCapableTool(chatTool('analyze_image'), overrides)).toBe(false);
	});

	it('rejects an ambiguous MCP suffix when the actual tool has no image input', () => {
		// A compound id alone cannot prove the tool can read a local image.
		expect(isImageCapableTool(chatTool('mcp_server_not_analyze_image'), overrides)).toBe(false);
	});

	it('trusts a user-added exact runtime tool id without guessing a suffix', () => {
		const configured = new Set<string>(['mcp_custom_server_visual_inspect']);
		expect(isImageCapableTool(chatTool('mcp_custom_server_visual_inspect'), configured)).toBe(true);
	});
});

describe('image-capable-tools — hasImageCapableTool', () => {
	const overrides = new Set<string>();

	function optionsWith(tools: vscode.LanguageModelChatTool[] | undefined) {
		return {
			tools,
		} as vscode.ProvideLanguageModelChatResponseOptions;
	}

	function namedTool(name: string, imageCapable = false): vscode.LanguageModelChatTool {
		return {
			name,
			description: name,
			inputSchema: {
				type: 'object',
				properties: imageCapable ? { image_source: localImageProperty } : {},
				required: imageCapable ? ['image_source'] : [],
			},
		};
	}

	it('returns true when at least one tool is image-capable', () => {
		expect(
			hasImageCapableTool(
				optionsWith([namedTool('web_search'), namedTool('analyze_image', true)]),
				overrides,
			),
		).toBe(true);
	});

	it('returns false when no tool is image-capable', () => {
		expect(
			hasImageCapableTool(optionsWith([namedTool('web_search'), namedTool('terminal')]), overrides),
		).toBe(false);
	});

	it('returns false when options.tools is undefined', () => {
		expect(hasImageCapableTool(optionsWith(undefined), overrides)).toBe(false);
	});

	it('returns false when options.tools is an empty array', () => {
		expect(hasImageCapableTool(optionsWith([]), overrides)).toBe(false);
	});

	it('recognizes a qualified image tool in a mixed tool set', () => {
		expect(
			hasImageCapableTool(
				optionsWith([
					namedTool('mcp_zai-mcp-serve_web_search_prime'),
					namedTool('mcp_zai-mcp-serve_analyze_image', true),
				]),
				new Set(),
			),
		).toBe(true);
	});

	it('accepts a single-image tool when the request carries multiple images', () => {
		// A single-input tool can be invoked once per stored image. Only tools
		// that require multiple image paths need the available-count gate.
		expect(hasImageCapableTool(optionsWith([namedTool('analyze_image', true)]), overrides, 3)).toBe(
			true,
		);
	});
});

describe('image-capable-tools — readImageCapableToolOverrides (user extension)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('returns no name overrides when the user has not configured anything', () => {
		expect(readImageCapableToolOverrides()).toEqual(new Set());
	});

	it('reads exact user-added runtime tool ids', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCapableTools', [
			'my_custom_vision_tool',
			'analyze_image',
		]);
		const result = readImageCapableToolOverrides();
		expect(result.has('my_custom_vision_tool')).toBe(true);
		expect(result.has('analyze_image')).toBe(true);
	});

	it('drops blank / invalid entries defensively', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCapableTools', [
			'  ',
			'valid_tool',
			// @ts-expect-error intentional invalid type for defensive test
			123,
		]);
		const result = readImageCapableToolOverrides();
		expect(result.has('valid_tool')).toBe(true);
		// Blank and non-string entries did not pollute the set.
		expect(result.has('')).toBe(false);
	});

	it('returns no overrides for a malformed non-array setting', () => {
		__setConfigurationValue('glm-copilot.mcp.imageCapableTools', { tool: true });
		expect(readImageCapableToolOverrides()).toEqual(new Set());
	});
});
