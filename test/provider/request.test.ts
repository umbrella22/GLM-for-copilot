import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthManager } from '../../src/auth';
import { convertToAnthropicRequest } from '../../src/client/anthropic';
import { createCacheDiagnosticsRecorder } from '../../src/provider/debug';
import { prepareChatRequest } from '../../src/provider/request';
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

	it('[FORK] accepts a GLM-5V-Turbo Coding Plan route (restriction removed)', async () => {
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5v-turbo': 'china-coding',
		});
		const getApiKey = vi.fn().mockResolvedValue('coding-plan-key');

		const prepared = await prepareChatRequest({
			authManager: { getApiKey } as unknown as AuthManager,
			globalStorageUri: vscode.Uri.file('/tmp/glm-request-test'),
			modelInfo: { id: 'glm-5v-turbo' } as vscode.LanguageModelChatInformation,
			segment,
			messages: [userMessage([new vscode.LanguageModelTextPart('Hello')])],
			options: {} as vscode.ProvideLanguageModelChatResponseOptions,
			token,
			cacheDiagnostics: createCacheDiagnosticsRecorder(),
			getVisionDescriber: async () => undefined,
		});

		// [FORK] Previously this threw 'does not support the coding-plan route';
		// the fork removed the supportedApiModes restriction on glm-5v-turbo.
		expect(getApiKey).toHaveBeenCalledWith('china-coding', undefined);
		expect(prepared.connection.endpoint).toBe('china-coding');
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
