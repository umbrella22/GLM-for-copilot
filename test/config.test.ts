import { beforeEach, describe, expect, it } from 'vitest';
import {
	findModelDefinition,
	getApiKeyUrl,
	getApiModelId,
	getApiProtocol,
	getBaseUrl,
	getBaseUrlOverride,
	getCustomModels,
	getEndpoint,
	getModelManagementConfiguration,
	getModelVisionMode,
	getModelEndpointRoute,
	inspectEffectiveModelManagementConfiguration,
	inspectModelManagementConfiguration,
	listProviderModels,
	migrateLegacyEndpointSettings,
	migrateLegacyModelManagementSettings,
	normalizeModelManagementConfiguration,
	resetModelManagementConfiguration,
	resolveModelConnection,
	saveModelManagementConfiguration,
} from '../src/config';
import { MODELS } from '../src/consts';
import {
	GLM_CN_ANTHROPIC_BASE_URL,
	GLM_CN_CODING_API_KEY_URL,
	GLM_CN_CODING_BASE_URL,
	GLM_CN_GENERAL_BASE_URL,
	GLM_INTERNATIONAL_ANTHROPIC_BASE_URL,
	GLM_INTERNATIONAL_CODING_API_KEY_URL,
	GLM_INTERNATIONAL_CODING_BASE_URL,
	GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
	GLM_INTERNATIONAL_GENERAL_BASE_URL,
} from '../src/endpoint';
import {
	__clearConfigurationValues,
	__getConfigurationValueAtScope,
	__setConfigurationUpdateFailure,
	__setConfigurationValue,
	__setConfigurationValueAtScope,
	__setWorkspaceFolders,
	ConfigurationTarget,
	Uri,
} from './support/vscode.mock';

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
		// [FORK] glm-5.2 / glm-5-turbo default to 'mcp' (built-in defaultVisionMode).
		expect(getModelVisionMode('glm-5.2')).toBe('mcp');
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

	it('routes GLM-5V-Turbo to the Standard API in the global endpoint region', () => {
		expect(getModelEndpointRoute('glm-5v-turbo')).toBe('same-region-standard');
		expect(resolveModelConnection('glm-5v-turbo')).toMatchObject({
			endpoint: 'china-standard',
			baseUrl: GLM_CN_GENERAL_BASE_URL,
			protocol: 'openai',
			apiMode: 'standard',
			credentialChannel: 'china-standard',
			pricingCurrency: 'CNY',
			usesGlobalBaseUrlOverride: false,
		});

		__setConfigurationValue('glm-copilot.endpoint', 'international-coding');
		expect(resolveModelConnection('glm-5v-turbo')).toMatchObject({
			endpoint: 'international-standard',
			baseUrl: GLM_INTERNATIONAL_GENERAL_BASE_URL,
			credentialChannel: 'international-standard',
			pricingCurrency: 'USD',
		});
	});

	it('applies global baseUrl only to models using the default route', () => {
		__setConfigurationValue('glm-copilot.baseUrl', 'https://proxy.example.com/v1');

		// [FORK] glm-5.2 now has a built-in defaultEndpointRoute ('china-anthropic'),
		// so it no longer uses the 'default' route. Use glm-5-turbo (still
		// default-route) as the example of a model that picks up the global baseUrl.
		expect(resolveModelConnection('glm-5-turbo')).toMatchObject({
			baseUrl: 'https://proxy.example.com/v1',
			usesGlobalBaseUrlOverride: true,
			apiMode: undefined,
			pricingCurrency: undefined,
		});
		// [FORK] glm-5.2 has an explicit built-in route, so the global baseUrl
		// override does NOT apply to it.
		expect(resolveModelConnection('glm-5.2')).toMatchObject({
			baseUrl: GLM_CN_ANTHROPIC_BASE_URL,
			endpoint: 'china-anthropic',
			usesGlobalBaseUrlOverride: false,
		});
		expect(resolveModelConnection('glm-5v-turbo')).toMatchObject({
			baseUrl: GLM_CN_GENERAL_BASE_URL,
			usesGlobalBaseUrlOverride: false,
		});
	});

	it('keeps an explicit official model route when a custom default URL uses the same credential channel', () => {
		__setConfigurationValue('glm-copilot.baseUrl', 'https://proxy.example.com/v1');
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5.2': 'china-coding',
		});

		expect(resolveModelConnection('glm-5.2')).toMatchObject({
			route: 'china-coding',
			endpoint: 'china-coding',
			baseUrl: GLM_CN_CODING_BASE_URL,
			credentialChannel: 'china-coding',
			usesGlobalBaseUrlOverride: false,
		});
	});

	it('uses explicit per-model endpoints and rejects unsupported GLM-5V-Turbo routes', () => {
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5.2': 'international-anthropic',
			'glm-5v-turbo': 'china-coding',
			ignored: 'not-an-endpoint',
		});

		expect(resolveModelConnection('glm-5.2')).toMatchObject({
			endpoint: 'international-anthropic',
			protocol: 'anthropic',
			credentialChannel: 'international-coding',
		});
		// [FORK] glm-5v-turbo route restriction removed: coding-plan is now
		// accepted (Coding Plan works with 5V-Turbo in practice).
		expect(resolveModelConnection('glm-5v-turbo')).toMatchObject({
			endpoint: 'china-coding',
		});
		expect(getModelEndpointRoute('ignored')).toBe('default');
	});

	it('keeps built-in route constraints when a custom definition overrides the same ID', () => {
		__setConfigurationValue('glm-copilot.customModels', [
			{ id: 'glm-5v-turbo', name: 'Custom GLM-5V-Turbo' },
		]);
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5v-turbo': 'china-coding',
		});

		// [FORK] glm-5v-turbo route restriction removed; coding-plan accepted.
		expect(resolveModelConnection('glm-5v-turbo')).toMatchObject({
			endpoint: 'china-coding',
		});
	});
});

describe('model management configuration', () => {
	const folder = Uri.file('/workspace/app');

	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('merges scopes field-wise and preserves explicit empty and tombstone values', () => {
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: {
					endpoint: 'china-coding',
					baseUrl: 'https://proxy.example.com/v1',
				},
				models: {
					'glm-5.2': { apiModelId: 'global-glm-5.2' },
				},
				customModels: {
					'team-coder': { name: 'Team Coder', maxInputTokens: 1_000 },
					'removed-model': { name: 'Remove Me' },
				},
			},
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: { endpoint: 'international-coding', baseUrl: '' },
				models: { 'glm-5.2': { endpointRoute: 'same-region-standard' } },
				customModels: {
					'team-coder': { thinking: false },
					'removed-model': null,
				},
			},
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: { 'glm-5.2': { visionMode: 'native' } },
			},
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);

		expect(getModelManagementConfiguration(folder)).toEqual({
			version: 1,
			defaultConnection: { endpoint: 'international-coding', baseUrl: '' },
			models: {
				'glm-5.2': {
					apiModelId: 'global-glm-5.2',
					endpointRoute: 'same-region-standard',
					visionMode: 'native',
				},
			},
			customModels: {
				'team-coder': {
					name: 'Team Coder',
					maxInputTokens: 1_000,
					thinking: false,
				},
				'removed-model': null,
			},
		});
		expect(getBaseUrlOverride(folder)).toBeUndefined();
		expect(getBaseUrl(folder)).toBe(GLM_INTERNATIONAL_CODING_BASE_URL);
		expect(getApiModelId('glm-5.2', folder)).toBe('global-glm-5.2');
		expect(getModelEndpointRoute('glm-5.2', folder)).toBe('same-region-standard');
		expect(getModelVisionMode('glm-5.2', folder)).toBe('native');
		expect(getCustomModels(folder).map((model) => model.id)).toContain('team-coder');
		expect(getCustomModels(folder).map((model) => model.id)).not.toContain('removed-model');

		const inspection = inspectModelManagementConfiguration(folder);
		expect(inspection.globalValue?.defaultConnection?.endpoint).toBe('china-coding');
		expect(inspection.workspaceValue?.defaultConnection?.baseUrl).toBe('');
		expect(inspection.workspaceFolderValue?.models?.['glm-5.2']?.visionMode).toBe('native');
	});

	it('uses canonical fields first while legacy settings fill missing fields', () => {
		__setConfigurationValue('glm-copilot.endpoint', 'china-coding');
		__setConfigurationValue('glm-copilot.baseUrl', 'https://legacy.example.com/v1');
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'glm-5.2': 'legacy-api-id',
			'glm-5-turbo': 'legacy-turbo-id',
		});
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5.2': 'china-standard',
		});
		__setConfigurationValue('glm-copilot.modelVisionModes', {
			'glm-5.2': 'proxy',
		});
		__setConfigurationValue('glm-copilot.customModels', [
			{ id: 'legacy-custom', name: 'Legacy Custom' },
			{ id: 'deleted-custom', name: 'Deleted Custom' },
		]);
		__setConfigurationValue('glm-copilot.modelManagement', {
			version: 1,
			defaultConnection: { endpoint: 'international-standard', baseUrl: '' },
			models: {
				'glm-5.2': {
					apiModelId: 'canonical-api-id',
					endpointRoute: 'international-anthropic',
					visionMode: 'native',
				},
			},
			customModels: {
				'canonical-custom': { name: 'Canonical Custom' },
				'deleted-custom': null,
			},
		});

		expect(getEndpoint()).toBe('international-standard');
		expect(getBaseUrlOverride()).toBeUndefined();
		expect(getApiModelId('glm-5.2')).toBe('canonical-api-id');
		expect(getApiModelId('glm-5-turbo')).toBe('legacy-turbo-id');
		expect(getModelEndpointRoute('glm-5.2')).toBe('international-anthropic');
		expect(getModelVisionMode('glm-5.2')).toBe('native');
		expect(getCustomModels().map((model) => model.id)).toEqual([
			'legacy-custom',
			'canonical-custom',
		]);
	});

	it('lets higher-scope legacy values override lower-scope canonical values', () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: {
					endpoint: 'china-coding',
					baseUrl: 'https://global.example.com/v1',
				},
				models: {
					'glm-5.2': {
						apiModelId: 'global-api-id',
						endpointRoute: 'china-coding',
						visionMode: 'proxy',
					},
				},
				customModels: {
					'scope-model': { name: 'Global Canonical' },
					'revived-model': null,
				},
			},
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.endpoint',
			'international-standard',
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope('glm-copilot.baseUrl', '', ConfigurationTarget.Workspace);
		__setConfigurationValueAtScope(
			'glm-copilot.modelIdOverrides',
			{ 'glm-5.2': 'workspace-api-id' },
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'international-anthropic' },
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'native' },
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[
				{ id: 'scope-model', name: 'Workspace Legacy' },
				{ id: 'revived-model', name: 'Workspace Revived' },
			],
			ConfigurationTarget.Workspace,
		);

		expect(getEndpoint()).toBe('international-standard');
		expect(getBaseUrlOverride()).toBeUndefined();
		expect(getBaseUrl()).toBe(GLM_INTERNATIONAL_GENERAL_BASE_URL);
		expect(getApiModelId('glm-5.2')).toBe('workspace-api-id');
		expect(getModelEndpointRoute('glm-5.2')).toBe('international-anthropic');
		expect(getModelVisionMode('glm-5.2')).toBe('native');
		expect(getCustomModels()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'scope-model', name: 'Workspace Legacy' }),
				expect.objectContaining({ id: 'revived-model', name: 'Workspace Revived' }),
			]),
		);

		const runtimeInspection = inspectEffectiveModelManagementConfiguration();
		expect(runtimeInspection.globalValue?.models?.['glm-5.2']?.apiModelId).toBe('global-api-id');
		expect(runtimeInspection.workspaceValue).toMatchObject({
			defaultConnection: { endpoint: 'international-standard', baseUrl: '' },
			models: {
				'glm-5.2': {
					apiModelId: 'workspace-api-id',
					endpointRoute: 'international-anthropic',
					visionMode: 'native',
				},
			},
		});
		expect(inspectModelManagementConfiguration().workspaceValue).toBeUndefined();
	});

	it('normalizes only version 1 values and uses canonical map keys as model identity', () => {
		expect(normalizeModelManagementConfiguration({ version: 2 })).toBeUndefined();
		expect(
			normalizeModelManagementConfiguration({
				version: 1,
				defaultConnection: { endpoint: 'invalid', baseUrl: '' },
				models: {
					'glm-5.2': {
						apiModelId: 'upstream-id',
						endpointRoute: 'same-region-standard',
						visionMode: 'invalid',
					},
				},
				customModels: {
					'custom-id': { id: 'ignored-at-runtime', name: 'Custom' },
					empty: null,
				},
			}),
		).toEqual({
			version: 1,
			defaultConnection: { baseUrl: '' },
			models: {
				'glm-5.2': {
					apiModelId: 'upstream-id',
					endpointRoute: 'same-region-standard',
				},
			},
			customModels: {
				'custom-id': { id: 'ignored-at-runtime', name: 'Custom' },
				empty: null,
			},
		});
		expect(
			normalizeModelManagementConfiguration({
				version: 1,
				models: {
					foo: { apiModelId: 'A' },
					' foo ': { apiModelId: 'B' },
				},
			}),
		).toBeUndefined();
		expect(
			normalizeModelManagementConfiguration({
				version: 1,
				customModels: {
					foo: { name: 'A' },
					' foo ': null,
				},
			}),
		).toBeUndefined();
	});

	it('does not persist fractional token counts in canonical V1 values', () => {
		expect(
			normalizeModelManagementConfiguration({
				version: 1,
				customModels: {
					fractional: {
						contextWindowTokens: 1_000.9,
						maxInputTokens: 600.4,
						maxOutputTokens: 400.8,
					},
				},
			}),
		).toEqual({ version: 1, customModels: { fractional: {} } });
	});

	it('preserves JavaScript object prototype names as model identities', () => {
		__setConfigurationValue(
			'glm-copilot.modelManagement',
			JSON.parse(`{
				"version": 1,
				"models": {
					"__proto__": { "apiModelId": "upstream-proto" }
				},
				"customModels": {
					"__proto__": { "name": "Prototype Model" }
				}
			}`),
		);

		expect(getApiModelId('__proto__')).toBe('upstream-proto');
		expect(getCustomModels()).toEqual([
			expect.objectContaining({ id: '__proto__', name: 'Prototype Model' }),
		]);
	});

	it('saves and resets exactly one configuration scope', async () => {
		__setWorkspaceFolders([folder]);
		await saveModelManagementConfiguration(
			{ version: 1, models: { 'glm-5.2': { visionMode: 'native' } } },
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelManagement',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toEqual({ version: 1, models: { 'glm-5.2': { visionMode: 'native' } } });

		await resetModelManagementConfiguration(ConfigurationTarget.WorkspaceFolder, folder);
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelManagement',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toBeUndefined();
		await expect(
			saveModelManagementConfiguration({ version: 1 }, ConfigurationTarget.WorkspaceFolder),
		).rejects.toThrow('workspace folder resource');
	});
});

describe('migrateLegacyModelManagementSettings', () => {
	const folder = Uri.file('/workspace/app');

	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('migrates every scope independently, then removes its legacy values', async () => {
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.endpoint',
			'international-coding',
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelIdOverrides',
			{ 'glm-5.2': 'workspace-api-id' },
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'native' },
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			['folder-model'],
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);

		await migrateLegacyModelManagementSettings();

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toEqual({
			version: 1,
			defaultConnection: { endpoint: 'international-coding' },
		});
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({
			version: 1,
			models: { 'glm-5.2': { apiModelId: 'workspace-api-id' } },
		});
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelManagement',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toEqual({
			version: 1,
			models: { 'glm-5.2': { visionMode: 'native' } },
			customModels: {
				'folder-model': {
					id: 'folder-model',
					name: 'folder-model',
					contextWindowTokens: 331_072,
					maxOutputTokens: 131_072,
					toolCalling: true,
					thinking: true,
				},
			},
		});
		expect(
			__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Global),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelVisionModes',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toBeUndefined();
		expect(getEndpoint(folder)).toBe('international-coding');
		expect(getApiModelId('glm-5.2', folder)).toBe('workspace-api-id');
		expect(getModelVisionMode('glm-5.2', folder)).toBe('native');
		expect(getCustomModels(folder).map((model) => model.id)).toContain('folder-model');

		const afterFirstRun = getModelManagementConfiguration(folder);
		await migrateLegacyModelManagementSettings();
		expect(getModelManagementConfiguration(folder)).toEqual(afterFirstRun);
	});

	it('keeps canonical conflicts while filling fields that only exist in legacy settings', async () => {
		__setConfigurationValue('glm-copilot.endpoint', 'china-standard');
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'glm-5.2': 'legacy-id',
		});
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5.2': 'china-coding',
		});
		__setConfigurationValue('glm-copilot.modelManagement', {
			version: 1,
			defaultConnection: { baseUrl: '' },
			models: { 'glm-5.2': { endpointRoute: 'international-standard' } },
		});

		await migrateLegacyModelManagementSettings();

		expect(getModelManagementConfiguration()).toEqual({
			version: 1,
			defaultConnection: { endpoint: 'china-standard', baseUrl: '' },
			models: {
				'glm-5.2': {
					apiModelId: 'legacy-id',
					endpointRoute: 'international-standard',
				},
			},
		});
	});

	it('preserves an empty higher-scope legacy custom model list after migration', async () => {
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'global-model', name: 'Global Model' }],
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope('glm-copilot.customModels', [], ConfigurationTarget.Workspace);

		expect(getCustomModels()).toEqual([]);

		await migrateLegacyModelManagementSettings();

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({ version: 1, customModels: { 'global-model': null } });
		expect(getCustomModels()).toEqual([]);
	});

	it('replaces lower-scope legacy custom models while keeping same-scope canonical fields', async () => {
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'global-model', name: 'Global Model' }],
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'workspace-model', name: 'Workspace Legacy' }],
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				customModels: { 'workspace-model': { name: 'Workspace Canonical' } },
			},
			ConfigurationTarget.Workspace,
		);

		expect(getCustomModels().map((model) => [model.id, model.name])).toEqual([
			['workspace-model', 'Workspace Canonical'],
		]);

		await migrateLegacyModelManagementSettings();

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({
			version: 1,
			customModels: {
				'global-model': null,
				'workspace-model': {
					id: 'workspace-model',
					name: 'Workspace Canonical',
					contextWindowTokens: 331_072,
					maxOutputTokens: 131_072,
					toolCalling: true,
					thinking: true,
				},
			},
		});
		expect(getCustomModels().map((model) => [model.id, model.name])).toEqual([
			['workspace-model', 'Workspace Canonical'],
		]);
	});

	it('treats a sparse higher-scope legacy custom model as a full replacement', async () => {
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[
				{
					id: 'same',
					name: 'Global Name',
					maxOutputTokens: 8_000,
					thinking: false,
				},
			],
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			['same'],
			ConfigurationTarget.Workspace,
		);

		expect(getCustomModels()).toEqual([
			expect.objectContaining({
				id: 'same',
				name: 'same',
				maxInputTokens: 200_000,
				maxOutputTokens: 131_072,
				capabilities: expect.objectContaining({ thinking: true }),
			}),
		]);

		await migrateLegacyModelManagementSettings();

		expect(getCustomModels()).toEqual([
			expect.objectContaining({
				id: 'same',
				name: 'same',
				maxInputTokens: 200_000,
				maxOutputTokens: 131_072,
				capabilities: expect.objectContaining({ thinking: true }),
			}),
		]);
	});

	it('writes folder tombstones for models omitted by a folder legacy list', async () => {
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'global-model', name: 'Global Model' }],
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'workspace-model', name: 'Workspace Model' }],
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[],
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);

		expect(getCustomModels(folder)).toEqual([]);

		await migrateLegacyModelManagementSettings();

		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelManagement',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toEqual({ version: 1, customModels: { 'workspace-model': null } });
		expect(getCustomModels(folder)).toEqual([]);
	});

	it('preserves legacy fallback settings when the canonical write fails', async () => {
		__setConfigurationValue('glm-copilot.endpoint', 'international-standard');
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'glm-5.2': 'legacy-id',
		});
		__setConfigurationUpdateFailure('glm-copilot.modelManagement', ConfigurationTarget.Global);

		await expect(migrateLegacyModelManagementSettings()).rejects.toThrow(
			'Configuration update failed',
		);
		expect(__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Global)).toBe(
			'international-standard',
		);
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelIdOverrides', ConfigurationTarget.Global),
		).toEqual({ 'glm-5.2': 'legacy-id' });
		expect(getEndpoint()).toBe('international-standard');
		expect(getApiModelId('glm-5.2')).toBe('legacy-id');
	});

	it('continues clearing legacy settings when one cleanup update fails', async () => {
		__setConfigurationValue('glm-copilot.endpoint', 'international-standard');
		__setConfigurationValue('glm-copilot.baseUrl', 'https://proxy.example.com/v1');
		__setConfigurationValue('glm-copilot.modelIdOverrides', {
			'glm-5.2': 'legacy-id',
		});
		__setConfigurationValue('glm-copilot.modelEndpointOverrides', {
			'glm-5.2': 'international-anthropic',
		});
		__setConfigurationValue('glm-copilot.modelVisionModes', {
			'glm-5.2': 'native',
		});
		__setConfigurationValue('glm-copilot.customModels', ['legacy-model']);
		__setConfigurationValue('glm-copilot.modelManagement', {
			version: 1,
			models: { 'glm-5.2': { apiModelId: 'canonical-id' } },
		});
		__setConfigurationUpdateFailure('glm-copilot.modelIdOverrides', ConfigurationTarget.Global);

		await expect(migrateLegacyModelManagementSettings()).resolves.toBeUndefined();

		expect(__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Global)).toBe(
			undefined,
		);
		expect(__getConfigurationValueAtScope('glm-copilot.baseUrl', ConfigurationTarget.Global)).toBe(
			undefined,
		);
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelIdOverrides', ConfigurationTarget.Global),
		).toEqual({ 'glm-5.2': 'legacy-id' });
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelEndpointOverrides',
				ConfigurationTarget.Global,
			),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelVisionModes', ConfigurationTarget.Global),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope('glm-copilot.customModels', ConfigurationTarget.Global),
		).toBeUndefined();
		expect(getEndpoint()).toBe('international-standard');
		expect(getBaseUrl()).toBe('https://proxy.example.com/v1');
		expect(getApiModelId('glm-5.2')).toBe('canonical-id');
		expect(getModelEndpointRoute('glm-5.2')).toBe('international-anthropic');
		expect(getModelVisionMode('glm-5.2')).toBe('native');
		expect(getCustomModels().map((model) => model.id)).toContain('legacy-model');
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
			{
				id: 'invalid-window',
				contextWindowTokens: 400,
				maxOutputTokens: 400,
				maxInputTokens: 12,
			},
		]);

		const models = getCustomModels();

		expect(models[0]).toMatchObject({
			maxInputTokens: 600,
			maxOutputTokens: 400,
		});
		expect(models[1]).toMatchObject({
			maxInputTokens: 12,
			maxOutputTokens: 400,
		});
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
			' team-coder ': ' provider-team-coder ',
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

	it('derives each workspace folder endpoint from its own legacy tuple', async () => {
		const chinaFolder = Uri.file('/workspace/china');
		const internationalFolder = Uri.file('/workspace/international');
		__setWorkspaceFolders([chinaFolder, internationalFolder]);
		__setConfigurationValueAtScope(
			'glm-copilot.region',
			'china',
			ConfigurationTarget.WorkspaceFolder,
			chinaFolder,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiMode',
			'coding-plan',
			ConfigurationTarget.WorkspaceFolder,
			chinaFolder,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.region',
			'international',
			ConfigurationTarget.WorkspaceFolder,
			internationalFolder,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiMode',
			'standard',
			ConfigurationTarget.WorkspaceFolder,
			internationalFolder,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiProtocol',
			'anthropic',
			ConfigurationTarget.WorkspaceFolder,
			internationalFolder,
		);

		await migrateLegacyEndpointSettings();

		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.endpoint',
				ConfigurationTarget.WorkspaceFolder,
				chinaFolder,
			),
		).toBe('china-coding');
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.endpoint',
				ConfigurationTarget.WorkspaceFolder,
				internationalFolder,
			),
		).toBe('international-anthropic');
		expect(getEndpoint(chinaFolder)).toBe('china-coding');
		expect(getEndpoint(internationalFolder)).toBe('international-anthropic');
	});

	it('migrates Global and partial Workspace tuples without crossing scope values', async () => {
		__setWorkspaceFolders([Uri.file('/workspace/app')]);
		__setConfigurationValueAtScope(
			'glm-copilot.region',
			'international',
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiMode',
			'standard',
			ConfigurationTarget.Workspace,
		);

		await migrateLegacyEndpointSettings();

		expect(__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Global)).toBe(
			'international-coding',
		);
		expect(
			__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Workspace),
		).toBe('international-standard');
	});

	it('keeps the legacy tuple when the endpoint write fails', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.region',
			'international',
			ConfigurationTarget.Global,
		);
		__setConfigurationUpdateFailure('glm-copilot.endpoint', ConfigurationTarget.Global);

		await expect(migrateLegacyEndpointSettings()).rejects.toThrow('Configuration update failed');

		expect(__getConfigurationValueAtScope('glm-copilot.region', ConfigurationTarget.Global)).toBe(
			'international',
		);
		expect(
			__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Global),
		).toBeUndefined();
	});

	it('does nothing when no legacy keys are configured', async () => {
		await migrateLegacyEndpointSettings();

		// Default preset is still china-coding; no legacy keys were written.
		expect(getEndpoint()).toBe('china-coding');
	});

	it('preserves an explicitly configured endpoint and clears its ignored tuple', async () => {
		// If the user already picked a new endpoint, migration defers — the
		// explicit value wins at runtime regardless of stale legacy keys.
		__setConfigurationValue('glm-copilot.endpoint', 'china-anthropic');
		__setConfigurationValue('glm-copilot.region', 'international');
		__setConfigurationValue('glm-copilot.apiMode', 'standard');

		await migrateLegacyEndpointSettings();

		expect(getEndpoint()).toBe('china-anthropic');
		expect(getBaseUrl()).toBe(GLM_CN_ANTHROPIC_BASE_URL);
		expect(
			__getConfigurationValueAtScope('glm-copilot.region', ConfigurationTarget.Global),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope('glm-copilot.apiMode', ConfigurationTarget.Global),
		).toBeUndefined();
	});

	it('does not let a child legacy tuple override an inherited canonical endpoint', async () => {
		__setWorkspaceFolders([Uri.file('/workspace/app')]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{ version: 1, defaultConnection: { endpoint: 'international-coding' } },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope('glm-copilot.region', 'china', ConfigurationTarget.Workspace);
		__setConfigurationValueAtScope(
			'glm-copilot.apiMode',
			'standard',
			ConfigurationTarget.Workspace,
		);

		await migrateLegacyEndpointSettings();
		await migrateLegacyModelManagementSettings();

		expect(getEndpoint()).toBe('international-coding');
		expect(
			__getConfigurationValueAtScope('glm-copilot.endpoint', ConfigurationTarget.Workspace),
		).toBeUndefined();
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
