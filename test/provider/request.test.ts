import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthManager } from '../../src/auth';
import { convertToAnthropicRequest } from '../../src/client/anthropic';
import { createCacheDiagnosticsRecorder } from '../../src/provider/debug';
import { prepareChatRequest } from '../../src/provider/request';
import { initImageStore } from '../../src/provider/vision/image-store'; // [FORK] mcp mode persists images
import type { VisionDescriber } from '../../src/provider/vision';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
} from '../../src/provider/vision/consts';
import type { ConversationSegment } from '../../src/provider/segment';
import {
	__clearConfigurationValues,
	__resetCommandState,
	__setConfigurationValueAtScope,
	__setConfigurationValue,
	__setWorkspaceFolders,
	ConfigurationTarget,
} from '../support/vscode.mock';

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

const segment: ConversationSegment = {
	segmentId: 'segment-1',
	reason: 'markerMissing',
};

function userMessage(content: readonly unknown[]): vscode.LanguageModelChatRequestMessage {
	return {
		role: vscode.LanguageModelChatMessageRole.User,
		content,
	} as vscode.LanguageModelChatRequestMessage;
}

function imagePart(data = [1, 2, 3]): vscode.LanguageModelDataPart {
	return new vscode.LanguageModelDataPart(new Uint8Array(data), 'image/png');
}

function tool(name: string): vscode.LanguageModelChatTool {
	return {
		name,
		description: `${name} description`,
		inputSchema: { type: 'object' },
	} as vscode.LanguageModelChatTool;
}

describe('request preparation', () => {
	let resizeImage: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
		resizeImage = vi.fn((data: unknown) => data);
		vscode.commands.registerCommand('_chat.resizeImage', resizeImage);
	});

	it('uses custom model capabilities and still resolves images through the Vision Proxy', async () => {
		__setConfigurationValue('glm-copilot.customModels', [
			{
				id: 'team-coder',
				name: 'Team Coder',
				toolCalling: false,
				thinking: false,
			},
		]);
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'team-coder': 'provider-team-coder',
		});
		const describe = vi.fn().mockResolvedValue('a screenshot description');
		const describer: VisionDescriber = {
			id: 'vision-proxy',
			source: 'auto',
			describe,
		};

		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'team-coder' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([new vscode.LanguageModelTextPart('Look'), imagePart([7, 8, 9])])],
			options: {
				tools: [tool('search')],
				modelConfiguration: { reasoningEffort: 'max' },
			} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => describer,
		});

		expect(prepared.request.model).toBe('provider-team-coder');
		expect(prepared.request.tools).toBeUndefined();
		expect(prepared.request.tool_choice).toBeUndefined();
		expect(prepared.request.thinking).toBeUndefined();
		expect(prepared.isThinkingModel).toBe(false);
		expect(prepared.modelDefinition).toMatchObject({
			id: 'team-coder',
			capabilities: {
				toolCalling: false,
				imageInput: true,
				thinking: false,
			},
		});
		expect(describe).toHaveBeenCalledOnce();
		expect(resizeImage).not.toHaveBeenCalled();
		expect(prepared.request.messages[0]?.content).toContain('Look');
		expect(prepared.request.messages[0]?.content).toContain(IMAGE_DESCRIPTION_PREFIX);
		expect(prepared.request.messages[0]?.content).toContain('a screenshot description');
		expect(prepared.request.messages[0]?.content).toContain(IMAGE_DESCRIPTION_SUFFIX);
		expect(prepared.visionMarkerTextChars).toBeGreaterThan(0);
	});

	it('uses native input by default for GLM-4.6V-Flash without requesting a Vision Proxy', async () => {
		const describe = vi.fn();
		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'glm-4.6v-flash' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([new vscode.LanguageModelTextPart('Look'), imagePart([7, 8, 9])])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe }),
		});

		expect(describe).not.toHaveBeenCalled();
		expect(resizeImage).toHaveBeenCalledOnce();
		expect(prepared.visionMode).toBe('native');
		expect(prepared.nativeImageParts).toBe(1);
		expect(prepared.nativeImageBytes).toBe(3);
		expect(prepared.visionMarkerTextChars).toBeUndefined();
		expect(prepared.request.messages[0]).toEqual({
			role: 'user',
			content: [
				{ type: 'text', text: 'Look' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,BwgJ' } },
			],
		});
	});

	it('routes GLM-5V-Turbo through the regional Standard API key and native image path', async () => {
		__setConfigurationValue('glm-copilot.endpoint', 'china-coding');
		const getApiKey = vi.fn().mockResolvedValue('standard-api-key');
		const describe = vi.fn();

		const prepared = await prepareChatRequest({
			authManager: { getApiKey } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'glm-5v-turbo' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([new vscode.LanguageModelTextPart('Look'), imagePart([5, 2])])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe }),
		});

		expect(getApiKey).toHaveBeenCalledOnce();
		expect(getApiKey).toHaveBeenCalledWith('china-standard', undefined);
		expect(prepared.connection).toMatchObject({
			route: 'same-region-standard',
			endpoint: 'china-standard',
			credentialChannel: 'china-standard',
			apiMode: 'standard',
		});
		expect(describe).not.toHaveBeenCalled();
		expect(resizeImage).toHaveBeenCalledOnce();
		expect(prepared.visionMode).toBe('native');
		expect(prepared.request.messages[0]?.content).toEqual([
			{ type: 'text', text: 'Look' },
			{ type: 'image_url', image_url: { url: 'data:image/png;base64,BQI=' } },
		]);
	});

	it('uses workspace-folder model, route, and vision configuration in the real request', async () => {
		const folder = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: { endpoint: 'international-coding' },
				models: {
					'folder-vision': {
						apiModelId: 'upstream-folder-vision',
						endpointRoute: 'same-region-standard',
						visionMode: 'native',
					},
				},
				customModels: {
					'folder-vision': { id: 'folder-vision', name: 'Folder Vision' },
				},
			},
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		const getApiKey = vi.fn().mockResolvedValue('folder-standard-key');

		const prepared = await prepareChatRequest({
			authManager: { getApiKey } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			configurationResource: folder,
			modelInfo: { id: 'folder-vision' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([imagePart([4, 2])])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => undefined,
		});

		expect(getApiKey).toHaveBeenCalledWith('international-standard', folder);
		expect(prepared.request.model).toBe('upstream-folder-vision');
		expect(prepared.connection).toMatchObject({
			endpoint: 'international-standard',
			credentialChannel: 'international-standard',
		});
		expect(prepared.visionMode).toBe('native');
		expect(prepared.request.messages[0]?.content).toEqual([
			{ type: 'image_url', image_url: { url: 'data:image/png;base64,BAI=' } },
		]);
	});

	it('rejects an unsupported GLM-5V-Turbo Coding Plan route before reading a key', async () => {
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5v-turbo': 'china-coding',
		});
		const getApiKey = vi.fn().mockResolvedValue('coding-plan-key');

		await expect(
			prepareChatRequest({
				authManager: { getApiKey } as unknown as AuthManager,
				globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
				modelInfo: { id: 'glm-5v-turbo' } as vscode.LanguageModelChatInformation,
				segment,
				messages: [userMessage([new vscode.LanguageModelTextPart('Hello')])],
				options: {} as vscode.ProvideLanguageModelChatResponseOptions,
				token,
				cacheDiagnostics: createCacheDiagnosticsRecorder(),
				getVisionDescriber: async () => undefined,
			}),
		).rejects.toThrow('does not support the coding-plan connection route');

		expect(getApiKey).not.toHaveBeenCalled();
		expect(resizeImage).not.toHaveBeenCalled();
	});

	it('uses resized native bytes for OpenAI-compatible and Anthropic requests', async () => {
		const resizedWebp = new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 9,
		]);
		resizeImage.mockReturnValue(resizedWebp);

		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'glm-4.6v-flash' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([new vscode.LanguageModelTextPart('Look'), imagePart([7, 8, 9])])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => undefined,
		});

		const resizedBase64 = Buffer.from(resizedWebp).toString('base64');
		expect(prepared.nativeImageParts).toBe(1);
		expect(prepared.nativeImageBytes).toBe(resizedWebp.byteLength);
		expect(prepared.request.messages[0]?.content).toEqual([
			{ type: 'text', text: 'Look' },
			{
				type: 'image_url',
				image_url: { url: `data:image/webp;base64,${resizedBase64}` },
			},
		]);

		const anthropic = convertToAnthropicRequest(prepared.request);
		expect(anthropic.messages[0]?.content).toEqual([
			{ type: 'text', text: 'Look' },
			{
				type: 'image',
				source: { type: 'base64', media_type: 'image/webp', data: resizedBase64 },
			},
		]);
	});

	it('allows a custom model to opt into native input', async () => {
		__setConfigurationValue('glm-copilot.customModels', ['team-vision']);
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'team-vision': 'native' });
		const describe = vi.fn();
		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'team-vision' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([imagePart([9, 8])])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe }),
		});

		expect(describe).not.toHaveBeenCalled();
		expect(prepared.visionMode).toBe('native');
		expect(prepared.request.messages[0]?.content).toEqual([
			{ type: 'image_url', image_url: { url: 'data:image/png;base64,CQg=' } },
		]);
	});

	it('uses the Vision Proxy when configured to override the GLM-4.6V native default', async () => {
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'glm-4.6v-flash': 'proxy' });
		const describe = vi.fn().mockResolvedValue('a screenshot description');
		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'glm-4.6v-flash' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([imagePart([7, 8, 9])])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'vision-proxy', source: 'auto', describe }),
		});

		expect(describe).toHaveBeenCalledOnce();
		expect(resizeImage).not.toHaveBeenCalled();
		expect(prepared.visionMode).toBe('proxy');
		expect(prepared.nativeImageParts).toBe(0);
		expect(prepared.request.messages[0]?.content).toContain('a screenshot description');
	});
});

// [FORK] mcp vision mode entry guard (PR #14 review #4): the mcp + no-tools +
// has-images conflict is checked BEFORE image processing in prepareChatRequest,
// so images are never silently lost when MCP tools are unavailable.
describe('request preparation — mcp vision mode entry guard (PR #14 review #4)', () => {
	// This block exercises all four quadrants of the (tools × images) matrix
	// for a model in mcp vision mode.

	let resizeImage: ReturnType<typeof vi.fn>;
	let tmpRoot: string;

	beforeEach(async () => {
		__clearConfigurationValues();
		__resetCommandState();
		resizeImage = vi.fn((data: unknown) => data);
		vscode.commands.registerCommand('_chat.resizeImage', resizeImage);
		// mcp mode persists images via initImageStore; use a real tmp dir so
		// storeImage does not fall back to the unavailable marker.
		tmpRoot = await mkdtemp(join(tmpdir(), 'glm-request-mcp-test-'));
		await initImageStore(vscode.Uri.file(tmpRoot));
	});

	afterEach(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	function buildOptions(overrides: {
		tools?: vscode.LanguageModelChatTool[];
	}): vscode.ProvideLanguageModelChatResponseOptions {
		return {
			tools: overrides.tools,
			modelConfiguration: { reasoningEffort: 'max' },
		} as vscode.ProvideLanguageModelChatResponseOptions;
	}

	it('THROWS when mcp mode + tool calling disabled + request carries images', async () => {
		// team-no-tools is a custom model with toolCalling: false. In mcp mode,
		// images cannot be read back by any tool, so the request must be refused.
		__setConfigurationValue('glm-copilot.customModels', [
			{ id: 'team-no-tools', toolCalling: false, thinking: false },
		]);
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'team-no-tools': 'mcp' });

		await expect(
			prepareChatRequest({
				authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
				globalStorageUri: vscode.Uri.file(tmpRoot),
				modelInfo: { id: 'team-no-tools' } as vscode.LanguageModelChatInformation,
				segment,
				messages: [userMessage([imagePart([7, 8, 9])])],
				options: buildOptions({ tools: [tool('search')] }),
				token,
				cacheDiagnostics: createCacheDiagnosticsRecorder(),
				getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe: vi.fn() }),
			}),
		).rejects.toThrowError(/vision mode|MCP tool|tool calling/i);
	});

	it('does NOT throw when mcp mode + tool calling disabled + pure-text request', async () => {
		// Same model, same mode, but no images: the guard only fires when there
		// are image parts to lose. Pure-text requests must proceed normally.
		__setConfigurationValue('glm-copilot.customModels', [
			{ id: 'team-no-tools', toolCalling: false, thinking: false },
		]);
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'team-no-tools': 'mcp' });

		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file(tmpRoot),
			modelInfo: { id: 'team-no-tools' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([new vscode.LanguageModelTextPart('just text')])],
			options: buildOptions({ tools: [tool('search')] }),
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe: vi.fn() }),
		});

		expect(prepared.visionMode).toBe('mcp');
		expect(prepared.request.tools).toBeUndefined();
		// The user's text must survive somewhere in the converted messages
		// (alongside the mcp-mode system image-handling instruction).
		expect(JSON.stringify(prepared.request.messages)).toContain('just text');
	});

	it('THROWS when mcp mode + tools available in capability but user emptied options.tools', async () => {
		// team-tools has toolCalling enabled, but the user disabled tools in the
		// chat configureTools panel (options.tools is an empty array). The guard
		// checks the EFFECTIVE tools list, not the capability flag.
		__setConfigurationValue('glm-copilot.customModels', ['team-tools']);
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'team-tools': 'mcp' });

		await expect(
			prepareChatRequest({
				authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
				globalStorageUri: vscode.Uri.file(tmpRoot),
				modelInfo: { id: 'team-tools' } as vscode.LanguageModelChatInformation,
				segment,
				messages: [userMessage([imagePart([7, 8, 9])])],
				options: buildOptions({ tools: [] }),
				token,
				cacheDiagnostics: createCacheDiagnosticsRecorder(),
				getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe: vi.fn() }),
			}),
		).rejects.toThrowError(/vision mode|MCP tool|tool calling/i);
	});

	it('does NOT throw when mcp mode + tools present + request carries images', async () => {
		// Happy path: mcp mode with a working tool, images get stripped to disk
		// and the file-path prompt replaces the image part.
		__setConfigurationValue('glm-copilot.customModels', ['team-tools']);
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'team-tools': 'mcp' });

		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file(tmpRoot),
			modelInfo: { id: 'team-tools' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([imagePart([7, 8, 9])])],
			options: buildOptions({ tools: [tool('analyze_image')] }),
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe: vi.fn() }),
		});

		expect(prepared.visionMode).toBe('mcp');
		// Image was stripped to a file-path text prompt somewhere in the
		// converted messages (alongside the mcp-mode system instruction).
		// Path separators may be single or doubled (JSON-escaped) depending on OS.
		const serialized = JSON.stringify(prepared.request.messages);
		expect(serialized).toMatch(/mcp-images[\\/]+[a-f0-9]+\.png/);
		expect(serialized).not.toMatch(/data:image/);
	});

	it('does not fire for native/proxy modes even when tool calling is disabled', async () => {
		// Sanity: the guard is mcp-specific. team-no-tools in native mode with
		// images must NOT throw (native mode has its own image handling).
		__setConfigurationValue('glm-copilot.customModels', [
			{ id: 'team-no-tools', toolCalling: false, thinking: false },
		]);
		__setConfigurationValue('glm-copilot.modelVisionModes', { 'team-no-tools': 'native' });

		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'test-key' } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file(tmpRoot),
			modelInfo: { id: 'team-no-tools' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([imagePart([7, 8, 9])])],
			options: buildOptions({ tools: [tool('search')] }),
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => ({ id: 'unused', source: 'auto', describe: vi.fn() }),
		});

		// native mode kept the image as base64; no guard error.
		expect(prepared.visionMode).toBe('native');
		expect(JSON.stringify(prepared.request.messages[0]?.content)).toMatch(/data:image/);
	});
});
