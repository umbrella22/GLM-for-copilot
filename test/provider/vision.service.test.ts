import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthManager } from '../../src/auth';
import { DEFAULT_GLM_VISION_MODEL_ID } from '../../src/provider/vision/consts';
import { createVisionService } from '../../src/provider/vision/service';
import {
	VISION_PROXY_CONFIG_KEY,
	VISION_PROXY_SOURCE_KEY,
} from '../../src/provider/vision/sources/endpoint/config';
import {
	__clearConfigurationValues,
	__resetCommandState,
	__setConfigurationValueAtScope,
	__setWorkspaceFolders,
	ConfigurationTarget,
} from '../support/vscode.mock';

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

describe('automatic Vision Proxy connection routing', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('uses the resource region and model override while keeping OpenAI vision transport', async () => {
		const folder = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: { endpoint: 'international-anthropic' },
				models: {
					[DEFAULT_GLM_VISION_MODEL_ID]: { apiModelId: 'resource-vision-model' },
				},
			},
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		const getApiKey = vi.fn().mockResolvedValue('international-coding-key');
		const fetchMock = mockVisionResponse({ choices: [{ message: { content: 'description' } }] });
		const service = createVisionService(createContext(), { getApiKey } as unknown as AuthManager);

		const describer = await service.get(folder);

		expect(describer?.id).toBe('auto:openai-compatible:resource-vision-model');
		expect(getApiKey).toHaveBeenCalledWith('international-coding', folder);
		expect(
			await describer?.describe({
				prompt: 'Describe the image',
				images: [{ mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }],
				token,
			}),
		).toBe('description');
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			'https://api.z.ai/api/coding/paas/v4/chat/completions',
		);
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
			model: 'resource-vision-model',
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Describe the image' },
						{
							type: 'image_url',
							image_url: { url: 'data:image/png;base64,AQID' },
						},
					],
				},
			],
		});
	});

	it('leaves an explicit Anthropic Vision Endpoint unchanged', async () => {
		const getApiKey = vi.fn();
		const fetchMock = mockVisionResponse({ content: [{ type: 'text', text: 'explicit' }] });
		const service = createVisionService(
			createContext(
				new Map<string, unknown>([
					[VISION_PROXY_SOURCE_KEY, 'api-endpoint'],
					[
						VISION_PROXY_CONFIG_KEY,
						{
							providerFamily: 'anthropic-compatible',
							apiType: 'messages',
							url: 'https://vision.example.com/v1/messages',
							modelId: 'explicit-vision-model',
							updatedAt: 1,
						},
					],
				]),
			),
			{ getApiKey } as unknown as AuthManager,
		);

		const describer = await service.get(vscode.Uri.file('/workspace/app'));

		expect(describer?.id).toBe('anthropic-compatible:explicit-vision-model');
		expect(getApiKey).not.toHaveBeenCalled();
		expect(
			await describer?.describe({
				prompt: 'Describe',
				images: [{ mimeType: 'image/png', data: new Uint8Array([4, 5]) }],
				token,
			}),
		).toBe('explicit');
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://vision.example.com/v1/messages');
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
			model: 'explicit-vision-model',
			max_tokens: 1024,
			messages: [
				{
					content: [
						{ type: 'text', text: 'Describe' },
						{
							type: 'image',
							source: { type: 'base64', media_type: 'image/png', data: 'BAU=' },
						},
					],
				},
			],
		});
	});
});

function createContext(globalValues = new Map<string, unknown>()): vscode.ExtensionContext {
	const secretChanges = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
	return {
		subscriptions: [],
		globalState: {
			get<T>(key: string): T | undefined {
				return globalValues.get(key) as T | undefined;
			},
			update(key: string, value: unknown): Promise<void> {
				globalValues.set(key, value);
				return Promise.resolve();
			},
		},
		secrets: {
			get: vi.fn().mockResolvedValue('explicit-vision-key'),
			store: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			onDidChange: secretChanges.event,
		},
	} as unknown as vscode.ExtensionContext;
}

function mockVisionResponse(body: unknown) {
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}
