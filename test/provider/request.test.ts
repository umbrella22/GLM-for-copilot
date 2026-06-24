import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthManager } from '../../src/auth';
import { createCacheDiagnosticsRecorder } from '../../src/provider/debug';
import { prepareChatRequest } from '../../src/provider/request';
import type { VisionDescriber } from '../../src/provider/vision';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
} from '../../src/provider/vision/consts';
import type { ConversationSegment } from '../../src/provider/segment';
import { __clearConfigurationValues, __setConfigurationValue } from '../support/vscode.mock';

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
	beforeEach(() => {
		__clearConfigurationValues();
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
		expect(prepared.request.messages[0]?.content).toContain('Look');
		expect(prepared.request.messages[0]?.content).toContain(IMAGE_DESCRIPTION_PREFIX);
		expect(prepared.request.messages[0]?.content).toContain('a screenshot description');
		expect(prepared.request.messages[0]?.content).toContain(IMAGE_DESCRIPTION_SUFFIX);
		expect(prepared.visionMarkerTextChars).toBeGreaterThan(0);
	});
});
