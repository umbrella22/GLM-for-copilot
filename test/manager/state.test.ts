import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthManager } from '../../src/auth';
import {
	getApiModelId,
	getCustomModels,
	getModelEndpointRoute,
	getModelVisionMode,
} from '../../src/config';
import {
	buildModelManagerState,
	createManagedModel,
	deleteManagedModel,
	resetManagedModel,
	saveManagedConnection,
	saveManagedModel,
} from '../../src/manager/state';
import type { ManagerVisionState } from '../../src/manager/ui';
import { ConfigurationTarget } from '../support/vscode.mock';
import {
	__clearConfigurationValues,
	__getConfigurationValueAtScope,
	__setConfigurationValueAtScope,
	__setWorkspaceFolders,
} from '../support/vscode.mock';

const vision: ManagerVisionState = {
	source: 'auto',
	summaryTitle: 'Automatic',
	summaryDetail: 'Automatic vision proxy',
	lmModels: [],
	endpoint: {
		url: '',
		modelId: '',
		hasApiKey: false,
		hasCustomHeaders: false,
		customHeaderNames: [],
		extraBodyJson: '',
	},
	test: { status: 'idle' },
};

function createAuth(configured: readonly string[] = []): AuthManager {
	return {
		hasApiKey: async (channel: string) => configured.includes(channel),
	} as unknown as AuthManager;
}

describe('model manager state', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('presents GLM-5.3-Flash as native with every route allowed', async () => {
		const state = await buildModelManagerState({
			auth: createAuth(['china-coding']),
			scope: 'global',
			revision: 3,
			activeView: 'models',
			vision,
		});

		const model = state.models.find((entry) => entry.id === 'glm-5.3-flash');
		expect(model).toMatchObject({
			visionMode: 'native',
			status: { tone: 'success' },
			draft: { endpointRoute: 'default' },
		});
		expect(model?.allowedRoutes.map((entry) => entry.value)).toEqual([
			'default',
			'same-region-standard',
			'china-coding',
			'china-standard',
			'china-anthropic',
			'international-coding',
			'international-standard',
			'international-anthropic',
		]);
		expect(state.defaultConnection.endpoint).toBe('china-coding');
	});

	it('reports the read-only BYOK utility policy and explicit utility settings', async () => {
		__setConfigurationValueAtScope(
			'chat.byokUtilityModelDefault',
			'none',
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'chat.utilitySmallModel',
			'copilot-utility-small',
			ConfigurationTarget.Global,
		);
		const state = await buildModelManagerState({
			auth: createAuth(),
			scope: 'global',
			revision: 1,
			activeView: 'models',
			vision,
		});

		expect(state.byokUtility).toEqual({
			defaultMode: 'none',
			utilityModelConfigured: false,
			utilitySmallModelConfigured: true,
		});
		expect(
			__getConfigurationValueAtScope('chat.byokUtilityModelDefault', ConfigurationTarget.Global),
		).toBe('none');
	});

	it('writes default connection changes into the selected canonical scope', async () => {
		await saveManagedConnection(
			'global',
			undefined,
			'international-coding',
			true,
			'https://proxy.example.com/v1/',
		);

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toEqual({
			version: 1,
			defaultConnection: {
				endpoint: 'international-coding',
				baseUrl: 'https://proxy.example.com/v1',
			},
		});
	});

	it('creates a custom model with definition and routing in one save', async () => {
		await createManagedModel('global', undefined, 'team-vision', {
			name: 'Team Vision',
			apiModelId: 'provider-team-vision',
			endpointRoute: 'china-standard',
			visionMode: 'native',
			contextWindowTokens: 128_000,
			maxOutputTokens: 16_000,
			toolCalling: true,
			thinking: false,
		});

		const saved = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as Record<string, unknown>;
		expect(saved).toMatchObject({
			models: {
				'team-vision': {
					apiModelId: 'provider-team-vision',
					endpointRoute: 'china-standard',
					visionMode: 'native',
				},
			},
			customModels: {
				'team-vision': {
					id: 'team-vision',
					name: 'Team Vision',
					contextWindowTokens: 128_000,
					maxOutputTokens: 16_000,
					toolCalling: true,
					thinking: false,
				},
			},
		});
	});

	it('does not materialize built-in route and vision defaults when only the API ID changes', async () => {
		await saveManagedModel('global', undefined, 'glm-5.3-flash', {
			name: 'GLM-5.3-Flash',
			apiModelId: 'provider-glm-5.3-flash',
			endpointRoute: 'default',
			visionMode: 'native',
		});

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toEqual({
			version: 1,
			models: {
				'glm-5.3-flash': { apiModelId: 'provider-glm-5.3-flash' },
			},
		});
		expect(getModelEndpointRoute('glm-5.3-flash')).toBe('default');
		expect(getModelVisionMode('glm-5.3-flash')).toBe('native');
	});

	it('keeps inherited model fields absent when saving an unrelated workspace override', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.3': {
						endpointRoute: 'international-standard',
						visionMode: 'native',
					},
				},
			},
			ConfigurationTarget.Global,
		);

		await saveManagedModel('workspace', undefined, 'glm-5.3', {
			name: 'GLM-5.3',
			apiModelId: 'workspace-glm-5.3',
			endpointRoute: 'international-standard',
			visionMode: 'native',
		});

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({
			version: 1,
			models: { 'glm-5.3': { apiModelId: 'workspace-glm-5.3' } },
		});

		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.3': {
						endpointRoute: 'china-standard',
						visionMode: 'proxy',
					},
				},
			},
			ConfigurationTarget.Global,
		);

		expect(getApiModelId('glm-5.3')).toBe('workspace-glm-5.3');
		expect(getModelEndpointRoute('glm-5.3')).toBe('china-standard');
		expect(getModelVisionMode('glm-5.3')).toBe('proxy');
	});

	it('persists explicit default route and proxy choices instead of treating them as inheritance', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.3': {
						endpointRoute: 'china-standard',
						visionMode: 'native',
					},
				},
			},
			ConfigurationTarget.Global,
		);

		await saveManagedModel('workspace', undefined, 'glm-5.3', {
			name: 'GLM-5.3',
			apiModelId: 'glm-5.3',
			endpointRoute: 'default',
			visionMode: 'proxy',
		});

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({
			version: 1,
			models: {
				'glm-5.3': { endpointRoute: 'default', visionMode: 'proxy' },
			},
		});
		expect(getModelEndpointRoute('glm-5.3')).toBe('default');
		expect(getModelVisionMode('glm-5.3')).toBe('proxy');
	});

	it('preserves current-scope explicit route and vision fields when another field changes', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.3': { endpointRoute: 'default', visionMode: 'proxy' },
				},
			},
			ConfigurationTarget.Workspace,
		);

		await saveManagedModel('workspace', undefined, 'glm-5.3', {
			name: 'GLM-5.3',
			apiModelId: 'workspace-provider-id',
			endpointRoute: 'default',
			visionMode: 'proxy',
		});

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({
			version: 1,
			models: {
				'glm-5.3': {
					apiModelId: 'workspace-provider-id',
					endpointRoute: 'default',
					visionMode: 'proxy',
				},
			},
		});
	});

	it('keeps an inherited custom model profile linked to parent route and vision changes', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'inherited-custom': {
						apiModelId: 'parent-provider-id',
						endpointRoute: 'international-standard',
						visionMode: 'native',
					},
				},
				customModels: {
					'inherited-custom': {
						id: 'inherited-custom',
						name: 'Inherited Custom',
						contextWindowTokens: 32_000,
						maxOutputTokens: 8_000,
					},
				},
			},
			ConfigurationTarget.Global,
		);

		await saveManagedModel('workspace', undefined, 'inherited-custom', {
			name: 'Workspace Custom',
			apiModelId: 'parent-provider-id',
			endpointRoute: 'international-standard',
			visionMode: 'native',
			contextWindowTokens: 32_000,
			maxOutputTokens: 8_000,
			toolCalling: true,
			thinking: true,
		});

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({
			version: 1,
			customModels: {
				'inherited-custom': {
					id: 'inherited-custom',
					name: 'Workspace Custom',
					contextWindowTokens: 32_000,
					maxOutputTokens: 8_000,
					toolCalling: true,
					thinking: true,
				},
			},
		});

		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'inherited-custom': {
						apiModelId: 'next-parent-provider-id',
						endpointRoute: 'china-standard',
						visionMode: 'proxy',
					},
				},
				customModels: {
					'inherited-custom': {
						id: 'inherited-custom',
						name: 'Inherited Custom',
						contextWindowTokens: 32_000,
						maxOutputTokens: 8_000,
					},
				},
			},
			ConfigurationTarget.Global,
		);

		expect(getApiModelId('inherited-custom')).toBe('next-parent-provider-id');
		expect(getModelEndpointRoute('inherited-custom')).toBe('china-standard');
		expect(getModelVisionMode('inherited-custom')).toBe('proxy');
	});

	it('creates a custom model whose ID matches an Object prototype property', async () => {
		await createManagedModel('global', undefined, '__proto__', {
			name: 'Prototype Model',
			apiModelId: 'provider-prototype',
			endpointRoute: 'china-standard',
			visionMode: 'proxy',
			contextWindowTokens: 32_000,
			maxOutputTokens: 8_000,
			toolCalling: true,
			thinking: true,
		});

		const saved = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as {
			models?: Record<string, unknown>;
			customModels?: Record<string, unknown>;
		};
		expect(Object.prototype.hasOwnProperty.call(saved.models, '__proto__')).toBe(true);
		expect(Object.prototype.hasOwnProperty.call(saved.customModels, '__proto__')).toBe(true);
		expect(getCustomModels()).toEqual([
			expect.objectContaining({ id: '__proto__', name: 'Prototype Model' }),
		]);
	});

	it('rejects invalid shared context windows and fractional token limits', async () => {
		const baseDraft = {
			name: 'Invalid Window',
			apiModelId: 'invalid-window',
			endpointRoute: 'china-standard' as const,
			visionMode: 'proxy' as const,
			toolCalling: true,
			thinking: true,
		};

		await expect(
			createManagedModel('global', undefined, 'invalid-window', {
				...baseDraft,
				contextWindowTokens: 16_000,
				maxOutputTokens: 16_000,
			}),
		).rejects.toThrow('context window');
		await expect(
			createManagedModel('global', undefined, 'fractional-window', {
				...baseDraft,
				apiModelId: 'fractional-window',
				contextWindowTokens: 16_000.5,
				maxOutputTokens: 4_000,
			}),
		).rejects.toThrow('positive integer');
	});

	it('rejects model identities with leading or trailing whitespace', async () => {
		const draft = {
			name: 'Canonical Identity',
			apiModelId: 'canonical-upstream',
			endpointRoute: 'china-standard' as const,
			visionMode: 'proxy' as const,
			toolCalling: true,
			thinking: true,
		};

		await expect(createManagedModel('global', undefined, ' spaced-id ', draft)).rejects.toThrow(
			'whitespace',
		);
		await expect(
			createManagedModel('global', undefined, 'canonical-id', {
				...draft,
				apiModelId: ' spaced-upstream ',
			}),
		).rejects.toThrow('whitespace');
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toBeUndefined();
	});

	it('resets an inherited custom model definition without deleting a local-only model', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				customModels: { inherited: { id: 'inherited', name: 'Parent Model' } },
			},
			ConfigurationTarget.Global,
		);
		await saveManagedModel('workspace', undefined, 'inherited', {
			name: 'Workspace Model',
			apiModelId: 'workspace-model',
			endpointRoute: 'china-standard',
			visionMode: 'native',
			contextWindowTokens: 32_000,
			maxOutputTokens: 8_000,
			toolCalling: false,
			thinking: false,
		});

		let state = await buildModelManagerState({
			auth: createAuth(),
			scope: 'workspace',
			revision: 1,
			activeView: 'models',
			vision,
		});
		expect(state.models.find((model) => model.id === 'inherited')?.canReset).toBe(true);

		await resetManagedModel('workspace', undefined, 'inherited');

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({ version: 1 });
		state = await buildModelManagerState({
			auth: createAuth(),
			scope: 'workspace',
			revision: 2,
			activeView: 'models',
			vision,
		});
		expect(state.models.find((model) => model.id === 'inherited')).toMatchObject({
			name: 'Parent Model',
			canReset: false,
		});

		await createManagedModel('global', undefined, 'local-only', {
			name: 'Local Only',
			apiModelId: 'local-only',
			endpointRoute: 'default',
			visionMode: 'proxy',
			contextWindowTokens: 32_000,
			maxOutputTokens: 8_000,
			toolCalling: true,
			thinking: true,
		});
		await resetManagedModel('global', undefined, 'local-only');
		expect(getCustomModels().map((model) => model.id)).toContain('local-only');
	});

	it('marks a custom model shadowing a built-in ID as a built-in override with all routes', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				customModels: {
					'glm-5.3-flash': { id: 'glm-5.3-flash', name: 'Local GLM-5.3-Flash' },
				},
			},
			ConfigurationTarget.Global,
		);

		const state = await buildModelManagerState({
			auth: createAuth(['china-coding']),
			scope: 'global',
			revision: 1,
			activeView: 'models',
			vision,
		});
		const model = state.models.find((entry) => entry.id === 'glm-5.3-flash');
		expect(model?.isBuiltInOverride).toBe(true);
		expect(model?.allowedRoutes.map((entry) => entry.value)).toEqual([
			'default',
			'same-region-standard',
			'china-coding',
			'china-standard',
			'china-anthropic',
			'international-coding',
			'international-standard',
			'international-anthropic',
		]);
		await saveManagedModel('global', undefined, 'glm-5.3-flash', {
			name: 'Local GLM-5.3-Flash',
			apiModelId: 'glm-5.3-flash',
			endpointRoute: 'china-coding',
			visionMode: 'native',
			contextWindowTokens: 200_000,
			maxOutputTokens: 131_072,
			toolCalling: true,
			thinking: true,
		});
		expect(getModelEndpointRoute('glm-5.3-flash')).toBe('china-coding');
	});

	it('shows legacy base URLs and custom models as editable effective values', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.baseUrl',
			'https://legacy.example.com/v1/',
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'legacy-model', name: 'Legacy Model', maxOutputTokens: 8_000 }],
			ConfigurationTarget.Global,
		);

		const state = await buildModelManagerState({
			auth: createAuth(),
			scope: 'global',
			revision: 1,
			activeView: 'models',
			vision,
		});
		expect(state.defaultConnection).toMatchObject({
			usesCustomBaseUrl: true,
			customBaseUrl: 'https://legacy.example.com/v1',
			valueSourceLabel: 'User',
		});
		expect(state.models.find((model) => model.id === 'legacy-model')).toMatchObject({
			isCustom: true,
			valueSourceLabel: 'User',
			draft: {
				name: 'Legacy Model',
				maxOutputTokens: 8_000,
				contextWindowTokens: 208_000,
			},
		});
	});

	it('resets legacy model maps at the selected scope without removing sibling entries', async () => {
		const resource = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([resource]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelIdOverrides',
			{ ' glm-5.3 ': 'legacy-id', sibling: 'keep-me' },
			ConfigurationTarget.WorkspaceFolder,
			resource,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ ' glm-5.3 ': 'international-standard' },
			ConfigurationTarget.WorkspaceFolder,
			resource,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ ' glm-5.3 ': 'native' },
			ConfigurationTarget.WorkspaceFolder,
			resource,
		);

		let state = await buildModelManagerState({
			auth: createAuth(),
			scope: 'workspace-folder',
			resource,
			revision: 1,
			activeView: 'models',
			vision,
		});
		expect(state.models.find((model) => model.id === 'glm-5.3')).toMatchObject({
			apiModelId: 'legacy-id',
			visionMode: 'native',
			canReset: true,
			valueSourceLabel: 'Current workspace folder',
		});

		await resetManagedModel('workspace-folder', resource, 'glm-5.3');

		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelIdOverrides',
				ConfigurationTarget.WorkspaceFolder,
				resource,
			),
		).toEqual({ sibling: 'keep-me' });
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelEndpointOverrides',
				ConfigurationTarget.WorkspaceFolder,
				resource,
			),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelVisionModes',
				ConfigurationTarget.WorkspaceFolder,
				resource,
			),
		).toBeUndefined();
		state = await buildModelManagerState({
			auth: createAuth(),
			scope: 'workspace-folder',
			resource,
			revision: 2,
			activeView: 'models',
			vision,
		});
		expect(state.models.find((model) => model.id === 'glm-5.3')).toMatchObject({
			apiModelId: 'glm-5.3',
			visionMode: 'proxy',
			canReset: false,
		});
	});

	it('recognizes a legacy parent custom model when resetting a canonical child override', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'legacy-parent', name: 'Legacy Parent' }],
			ConfigurationTarget.Global,
		);
		await saveManagedModel('workspace', undefined, 'legacy-parent', {
			name: 'Workspace Child',
			apiModelId: 'workspace-child',
			endpointRoute: 'default',
			visionMode: 'proxy',
			contextWindowTokens: 32_000,
			maxOutputTokens: 8_000,
			toolCalling: true,
			thinking: true,
		});

		await resetManagedModel('workspace', undefined, 'legacy-parent');

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({ version: 1 });
		expect(getCustomModels().find((model) => model.id === 'legacy-parent')?.name).toBe(
			'Legacy Parent',
		);
	});

	it('writes a workspace tombstone when deleting an inherited custom model', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				customModels: { inherited: { id: 'inherited', name: 'Inherited' } },
			},
			ConfigurationTarget.Global,
		);

		await deleteManagedModel('workspace', undefined, 'inherited');

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Workspace),
		).toEqual({ version: 1, customModels: { inherited: null } });
	});

	it('writes a canonical tombstone when deleting a legacy custom model', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.customModels',
			[{ id: 'legacy-only', name: 'Legacy Only' }],
			ConfigurationTarget.Global,
		);

		expect(getCustomModels().map((model) => model.id)).toContain('legacy-only');

		await deleteManagedModel('global', undefined, 'legacy-only');

		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toEqual({ version: 1, customModels: { 'legacy-only': null } });
		expect(getCustomModels().map((model) => model.id)).not.toContain('legacy-only');
	});
});
