import { beforeEach, describe, expect, it } from 'vitest';
import {
	findModelDefinition,
	getApiKeyUrl,
	getApiModelId,
	getApiProtocol,
	getBaseUrl,
	getCustomModels,
	getEndpoint,
	getModelVisionMode,
	listProviderModels,
	migrateLegacyEndpointSettings,
} from '../src/config';
import { MODELS } from '../src/consts';
import {
	GLM_CN_ANTHROPIC_BASE_URL,
	GLM_CN_CODING_API_KEY_URL,
	GLM_CN_CODING_BASE_URL,
	GLM_INTERNATIONAL_ANTHROPIC_BASE_URL,
	GLM_INTERNATIONAL_CODING_API_KEY_URL,
	GLM_INTERNATIONAL_CODING_BASE_URL,
	GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
	GLM_INTERNATIONAL_GENERAL_BASE_URL,
} from '../src/endpoint';
import { __clearConfigurationValues, __setConfigurationValue } from './support/vscode.mock';

describe('configuration helpers', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('keeps the default endpoint on domestic Coding Plan', () => {
		expect(getBaseUrl()).toBe(GLM_CN_CODING_BASE_URL);
		expect(getApiKeyUrl()).toBe(GLM_CN_CODING_API_KEY_URL);
	});

	it('uses apiMode and region presets when baseUrl is empty', () => {
		__setConfigurationValue('glm-copilot.apiMode', 'standard');
		__setConfigurationValue('glm-copilot.region', 'international');

		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_GENERAL_BASE_URL);
		expect(getApiKeyUrl()).toBe(GLM_INTERNATIONAL_GENERAL_API_KEY_URL);
	});

	it('lets non-empty baseUrl override apiMode and region presets', () => {
		__setConfigurationValue('glm-copilot.apiMode', 'standard');
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.baseUrl', ' https://proxy.example.com/v1/// ');

		expect(getBaseUrl()).toBe('https://proxy.example.com/v1');
	});

	it('lets non-empty baseUrl override the endpoint preset', () => {
		__setConfigurationValue('glm-copilot.endpoint', 'international-anthropic');
		__setConfigurationValue('glm-copilot.baseUrl', 'https://proxy.example.com/v1');

		expect(getBaseUrl()).toBe('https://proxy.example.com/v1');
	});

	it('defaults GLM-4.6V-Flash to native image input and other models to the proxy', () => {
		expect(getModelVisionMode('glm-4.6v-flash')).toBe('native');
		expect(getModelVisionMode('glm-5.2')).toBe('proxy');
		expect(getModelVisionMode('custom-model')).toBe('proxy');
	});

	it('uses valid vision-mode overrides without changing model ID resolution', () => {
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'glm-4.6v-flash': 'text-only-upstream-name',
		});
		__setConfigurationValue('glm-copilot.modelVisionModes', {
			' glm-4.6v-flash ': 'proxy',
			'team-coder': 'native',
			ignored: 'unsupported',
		});

		expect(getApiModelId('glm-4.6v-flash')).toBe('text-only-upstream-name');
		expect(getModelVisionMode('glm-4.6v-flash')).toBe('proxy');
		expect(getModelVisionMode('team-coder')).toBe('native');
		expect(getModelVisionMode('ignored')).toBe('proxy');
	});
});

describe('endpoint preset selection', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('defaults to china-coding when nothing is configured', () => {
		expect(getEndpoint()).toBe('china-coding');
		expect(getBaseUrl()).toBe(GLM_CN_CODING_BASE_URL);
		expect(getApiProtocol()).toBe('openai');
		expect(getApiKeyUrl()).toBe(GLM_CN_CODING_API_KEY_URL);
	});

	it('respects an explicit endpoint preset', () => {
		__setConfigurationValue('glm-copilot.endpoint', 'international-anthropic');

		expect(getEndpoint()).toBe('international-anthropic');
		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_ANTHROPIC_BASE_URL);
		expect(getApiProtocol()).toBe('anthropic');
		expect(getApiKeyUrl()).toBe(GLM_INTERNATIONAL_CODING_API_KEY_URL);
	});

	it('resolves china-anthropic preset to the CN Anthropic endpoint', () => {
		__setConfigurationValue('glm-copilot.endpoint', 'china-anthropic');

		expect(getBaseUrl()).toBe(GLM_CN_ANTHROPIC_BASE_URL);
		expect(getApiProtocol()).toBe('anthropic');
	});

	it('resolves international-coding preset', () => {
		__setConfigurationValue('glm-copilot.endpoint', 'international-coding');

		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_CODING_BASE_URL);
		expect(getApiProtocol()).toBe('openai');
		expect(getApiKeyUrl()).toBe(GLM_INTERNATIONAL_CODING_API_KEY_URL);
	});

	it('falls back to legacy tuple when endpoint is unset (backward compat)', () => {
		// Mimics an existing user who upgraded and has not migrated yet.
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiMode', 'standard');
		__setConfigurationValue('glm-copilot.apiProtocol', 'openai');

		expect(getEndpoint()).toBe('international-standard');
		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_GENERAL_BASE_URL);
		expect(getApiKeyUrl()).toBe(GLM_INTERNATIONAL_GENERAL_API_KEY_URL);
	});

	it('legacy apiProtocol=anthropic + international region now resolves to the international Anthropic endpoint (regression)', () => {
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiProtocol', 'anthropic');

		expect(getEndpoint()).toBe('international-anthropic');
		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_ANTHROPIC_BASE_URL);
		expect(getApiProtocol()).toBe('anthropic');
	});

	it('endpoint preset takes precedence over legacy tuple', () => {
		__setConfigurationValue('glm-copilot.endpoint', 'china-coding');
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiMode', 'standard');

		expect(getEndpoint()).toBe('china-coding');
		expect(getBaseUrl()).toBe(GLM_CN_CODING_BASE_URL);
	});

	it('normalizes custom model strings and objects', () => {
		__setConfigurationValue('glm-copilot.customModels', [
			' team-coder ',
			{
				id: ' custom-no-tools ',
				name: ' Custom No Tools ',
				contextWindowTokens: 1_000,
				maxInputTokens: 123.9,
				maxOutputTokens: 456,
				toolCalling: false,
				thinking: false,
			},
			{ id: '   ' },
			123,
		]);

		const models = getCustomModels();

		expect(models).toHaveLength(2);
		expect(models[0]).toMatchObject({
			id: 'team-coder',
			name: 'team-coder',
			maxInputTokens: 200_000,
			maxOutputTokens: 131_072,
			capabilities: {
				toolCalling: true,
				imageInput: true,
				thinking: true,
			},
			requiresThinkingParam: true,
		});
		expect(models[1]).toMatchObject({
			id: 'custom-no-tools',
			name: 'Custom No Tools',
			maxInputTokens: 544,
			maxOutputTokens: 456,
			capabilities: {
				toolCalling: false,
				imageInput: true,
				thinking: false,
			},
			requiresThinkingParam: false,
		});
	});

	it('uses a valid shared context window before the legacy input limit', () => {
		__setConfigurationValue('glm-copilot.customModels', [
			{
				id: 'shared-window',
				contextWindowTokens: 1_000.9,
				maxOutputTokens: 400.8,
				maxInputTokens: 12,
			},
			{ id: 'invalid-window', contextWindowTokens: 400, maxOutputTokens: 400, maxInputTokens: 12 },
		]);

		const models = getCustomModels();

		expect(models[0]).toMatchObject({ maxInputTokens: 600, maxOutputTokens: 400 });
		expect(models[1]).toMatchObject({ maxInputTokens: 12, maxOutputTokens: 400 });
	});

	it('lets custom model IDs override built-in model lookup and picker registry', () => {
		__setConfigurationValue('glm-copilot.customModels', [
			{
				id: 'glm-5.2',
				name: 'Local GLM-5.2',
				maxInputTokens: 42,
				thinking: false,
			},
		]);

		const models = listProviderModels();

		expect(models).toHaveLength(MODELS.length);
		expect(findModelDefinition('glm-5.2')).toMatchObject({
			id: 'glm-5.2',
			name: 'Local GLM-5.2',
			maxInputTokens: 42,
			capabilities: {
				imageInput: true,
				thinking: false,
			},
		});
	});

	it('supports modelIdOverrides for arbitrary built-in or custom model IDs', () => {
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'glm-5.2': 'upstream-glm-5.2',
			'team-coder': 'provider-team-coder',
			empty: '   ',
		});

		expect(getApiModelId('glm-5.2')).toBe('upstream-glm-5.2');
		expect(getApiModelId('team-coder')).toBe('provider-team-coder');
		expect(getApiModelId('empty')).toBe('empty');
		expect(getApiModelId('unknown')).toBe('unknown');
	});
});

describe('migrateLegacyEndpointSettings', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('writes the derived endpoint and clears the legacy keys', async () => {
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiMode', 'standard');
		__setConfigurationValue('glm-copilot.apiProtocol', 'openai');

		await migrateLegacyEndpointSettings();

		expect(getEndpoint()).toBe('international-standard');
		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_GENERAL_BASE_URL);
		expect(getApiKeyUrl()).toBe(GLM_INTERNATIONAL_GENERAL_API_KEY_URL);
		expect(getApiProtocol()).toBe('openai');
	});

	it('maps legacy anthropic protocol to the international Anthropic endpoint (regression)', async () => {
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiProtocol', 'anthropic');

		await migrateLegacyEndpointSettings();

		expect(getEndpoint()).toBe('international-anthropic');
		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_ANTHROPIC_BASE_URL);
		expect(getApiProtocol()).toBe('anthropic');
	});

	it('does nothing when no legacy keys are configured', async () => {
		await migrateLegacyEndpointSettings();

		// Default preset is still china-coding; no legacy keys were written.
		expect(getEndpoint()).toBe('china-coding');
	});

	it('preserves an explicitly configured endpoint and leaves legacy keys untouched', async () => {
		// If the user already picked a new endpoint, migration defers — the
		// explicit value wins at runtime regardless of stale legacy keys.
		__setConfigurationValue('glm-copilot.endpoint', 'china-anthropic');
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiMode', 'standard');

		await migrateLegacyEndpointSettings();

		expect(getEndpoint()).toBe('china-anthropic');
		expect(getBaseUrl()).toBe(GLM_CN_ANTHROPIC_BASE_URL);
	});

	it('is idempotent — running twice yields the same state', async () => {
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiMode', 'standard');

		await migrateLegacyEndpointSettings();
		const afterFirstRun = getEndpoint();

		await migrateLegacyEndpointSettings();

		expect(getEndpoint()).toBe(afterFirstRun);
		expect(getEndpoint()).toBe('international-standard');
	});
});
