import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { listProviderModels } from '../../src/config';
import { MODELS } from '../../src/consts';
import {
	getConfiguredThinkingEffort,
	getModelConfigurationResource,
	toChatInfo,
} from '../../src/provider/models';
import { __clearConfigurationValues, __setConfigurationValue } from '../support/vscode.mock';

describe('model metadata helpers', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('normalizes configured thinking effort aliases', () => {
		expect(
			getConfiguredThinkingEffort({
				modelConfiguration: { reasoningEffort: 'disabled' },
			}),
		).toBe('none');
		expect(
			getConfiguredThinkingEffort({
				configuration: { thinking_effort: 'balanced' },
			}),
		).toBe('high');
		expect(
			getConfiguredThinkingEffort({
				modelConfiguration: { thinkingEffort: 'deep' },
			}),
		).toBe('max');
	});

	it('defaults thinking effort to max when no valid value is configured', () => {
		expect(getConfiguredThinkingEffort({})).toBe('max');
		expect(
			getConfiguredThinkingEffort({
				modelConfiguration: { reasoningEffort: 'surprise' },
			}),
		).toBe('max');
	});

	it('shows locked model metadata before an API key is configured', () => {
		const info = toChatInfo(MODELS[0], false, 'CNY');

		expect(info.statusIcon).toBeInstanceOf(vscode.ThemeIcon);
		expect(info.statusIcon?.id).toBe('warning');
		expect(info.detail).toBe('Please run GLM: Set API Key to configure.');
		expect(info.tooltip).toBe('Please run GLM: Set API Key to configure.');
		expect(info.isBYOK).toBe(true);
		expect(info.isUserSelectable).toBe(true);
	});

	it('reports capabilities, thinking configuration, and price metadata when unlocked', () => {
		const info = toChatInfo(MODELS[0], true, 'CNY');

		expect(info.statusIcon).toBeUndefined();
		expect(info.capabilities).toEqual({
			toolCalling: MODELS[0].capabilities.toolCalling,
			imageInput: true,
		});
		expect(info.configurationSchema?.properties.reasoningEffort.default).toBe('max');
		expect(info.inputCost).toBe('¥8');
		expect(info.outputCost).toBe('¥28');
		expect(info.cacheCost).toBe('¥2');
		expect(info.priceCategory).toBe('high');
	});

	it('carries the resource-scoped configuration snapshot with picker metadata', () => {
		const resource = vscode.Uri.file('/workspace/app');
		const info = toChatInfo(MODELS[0], true, 'CNY', undefined, resource);

		expect(info.configurationResource).toBe(resource.toString());
		expect(getModelConfigurationResource(info)?.toString()).toBe(resource.toString());
	});

	it('publishes built-in shared windows as Copilot input plus output budgets', () => {
		// [FORK] MODELS now includes glm-claude-opus-4.8 (868928 input + 131072
		// output, synced to GLM-5.2) and glm-5v-turbo no longer has
		// supportedApiModes (route unlocked).
		expect(MODELS.map((model) => model.maxInputTokens + model.maxOutputTokens)).toEqual([
			1_000_000, 131_072, 200_000, 200_000, 1_000_000,
		]);
		expect(MODELS[1].maxOutputTokens).toBe(32_768);
		expect(toChatInfo(MODELS[0], true).maxInputTokens).toBe(868_928);
		expect(toChatInfo(MODELS[2], true).maxOutputTokens).toBe(131_072);
		expect(MODELS[2]).toMatchObject({
			id: 'glm-5v-turbo',
			defaultEndpointRoute: 'same-region-standard',
			defaultVisionMode: 'native',
			capabilities: { imageInput: true, thinking: true },
		});
		// [FORK] glm-5v-turbo route restriction removed
		expect(MODELS[2].supportedApiModes).toBeUndefined();
		// [FORK] new built-in glm-claude-opus-4.8
		expect(MODELS[4]).toMatchObject({
			id: 'glm-claude-opus-4.8',
			defaultApiModelId: 'claude-opus-4.8',
			defaultEndpointRoute: 'china-anthropic',
			defaultVisionMode: 'mcp',
			// [FORK] imageInput true so Copilot allows image attachment; visionMode
			// mcp then strips images to disk for MCP tools (model itself is text-only).
			capabilities: { imageInput: true, thinking: true },
		});
	});

	it('includes custom models in picker metadata with Vision Proxy image support', () => {
		__setConfigurationValue('glm-copilot.customModels', [
			'team-coder',
			{ id: 'no-thinking', thinking: false },
		]);

		const infos = listProviderModels().map((model) => toChatInfo(model, true, 'USD'));
		const custom = infos.find((info) => info.id === 'team-coder');
		const noThinking = infos.find((info) => info.id === 'no-thinking');

		expect(infos.map((info) => info.id)).toEqual([
			...MODELS.map((model) => model.id),
			'team-coder',
			'no-thinking',
		]);
		expect(custom).toMatchObject({
			id: 'team-coder',
			name: 'team-coder',
			detail: 'Custom GLM-compatible model',
			capabilities: {
				toolCalling: true,
				imageInput: true,
			},
		});
		expect(custom?.configurationSchema?.properties.reasoningEffort.default).toBe('max');
		expect(noThinking?.capabilities.imageInput).toBe(true);
		expect(noThinking?.configurationSchema).toBeUndefined();
	});
});
