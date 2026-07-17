import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommands } from '../../src/runtime/commands';
import { formatCredentialChannel } from '../../src/auth';
import {
	GLM_CN_CODING_API_KEY_URL,
	GLM_CN_GENERAL_API_KEY_URL,
	GLM_INTERNATIONAL_CODING_API_KEY_URL,
	GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
} from '../../src/endpoint';
import { BUILTIN_MCP_SERVERS } from '../../src/mcp/builtin';
import {
	__clearConfigurationValues,
	__getOpenedExternal,
	__getConfigurationValueAtScope,
	__resetCommandState,
	__setConfigurationValue,
	__setConfigurationValueAtScope,
	__setQuickPickSelectionLabel,
	__setWarningMessageButton,
	__setWorkspaceFolders,
	ConfigurationTarget,
	Uri,
	__getWindowMessages,
} from '../support/vscode.mock';

// Mock cleanupAllStoredImages so the cleanup command can be tested without
// initializing the real image store. The spy records the call count.
const cleanupAllStoredImagesMock = vi.fn(async () => 0);
vi.mock('../../src/provider/vision/image-store', () => ({
	cleanupAllStoredImages: (...args: unknown[]) => cleanupAllStoredImagesMock(...args),
}));

describe('runtime commands', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
	});

	it.each([
		['coding-plan', 'china', 'china-coding', GLM_CN_CODING_API_KEY_URL],
		['standard', 'china', 'china-standard', GLM_CN_GENERAL_API_KEY_URL],
		['coding-plan', 'international', 'international-coding', GLM_INTERNATIONAL_CODING_API_KEY_URL],
		['standard', 'international', 'international-standard', GLM_INTERNATIONAL_GENERAL_API_KEY_URL],
	] as const)('opens the API key page for %s/%s', async (apiMode, region, channel, expectedUrl) => {
		__setConfigurationValue('glm-copilot.apiMode', apiMode);
		__setConfigurationValue('glm-copilot.region', region);
		__setQuickPickSelectionLabel(formatCredentialChannel(channel));
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);

		await vscode.commands.executeCommand('glm-copilot.getApiKey');

		expect(__getOpenedExternal()?.toString()).toBe(expectedUrl);
	});
});

describe('runtime commands — cleanupStoredImages (FORK)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
		cleanupAllStoredImagesMock.mockClear();
	});

	it('does nothing when the user dismisses the confirmation dialog', async () => {
		__setWarningMessageButton(undefined);
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.cleanupStoredImages');
		expect(cleanupAllStoredImagesMock).not.toHaveBeenCalled();
	});

	it('calls cleanupAllStoredImages when confirmed and reports the count', async () => {
		cleanupAllStoredImagesMock.mockResolvedValueOnce(7);
		__setWarningMessageButton('Delete');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.cleanupStoredImages');
		expect(cleanupAllStoredImagesMock).toHaveBeenCalledTimes(1);
		// Success message includes the deleted count.
		expect(__getWindowMessages().information.join(' ')).toMatch(/7/);
	});

	it('shows an error message when cleanup throws', async () => {
		cleanupAllStoredImagesMock.mockRejectedValueOnce(new Error('fs error'));
		__setWarningMessageButton('Delete');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.cleanupStoredImages');
		expect(cleanupAllStoredImagesMock).toHaveBeenCalledTimes(1);
		// An error message was surfaced (not silently swallowed).
		expect(__getWindowMessages().error.length).toBeGreaterThan(0);
	});
});

describe('runtime commands — applyCodingPlanPreset (FORK)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
		cleanupAllStoredImagesMock.mockClear();
	});

	it('does nothing when the user dismisses the confirmation dialog', async () => {
		__setWarningMessageButton(undefined);
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		// No MCP servers enabled, no stabilizeToolList set.
		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			expect(cfg.get(`mcp.${id}.enabled`)).toBeFalsy();
		}
		expect(cfg.get('experimental.stabilizeToolList')).toBeFalsy();
	});

	it('enables all built-in MCP servers and stabilizeToolList when confirmed', async () => {
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		// All four built-in servers enabled at user scope.
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			expect(cfg.get(`mcp.${id}.enabled`), `mcp.${id}.enabled should be true after preset`).toBe(
				true,
			);
		}
		expect(cfg.get('experimental.stabilizeToolList')).toBe(true);
	});

	it('writes Coding Plan model overrides for glm-5.2 and glm-5-turbo', async () => {
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		// modelManagement is stored as a versioned object; read it back and
		// check the per-model profiles.
		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { models?: Record<string, { endpointRoute?: string; visionMode?: string }> };
		expect(mm?.models?.['glm-5.2']?.endpointRoute).toBe('china-anthropic');
		expect(mm?.models?.['glm-5.2']?.visionMode).toBe('mcp');
		expect(mm?.models?.['glm-5-turbo']?.visionMode).toBe('mcp');
		// glm-5-turbo should NOT get a route override (only visionMode).
		expect(mm?.models?.['glm-5-turbo']?.endpointRoute).toBeUndefined();
	});

	it('preserves existing user overrides when merging the preset', async () => {
		// Pre-existing custom model + default connection must survive the merge.
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: { endpoint: 'china-standard' },
				models: { 'glm-4.6v-flash': { visionMode: 'native' } },
				customModels: { 'my-team-model': { id: 'my-team-model', thinking: true } },
			},
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as {
			defaultConnection?: { endpoint?: string };
			models?: Record<string, unknown>;
			customModels?: Record<string, unknown>;
		};
		// Existing defaultConnection preserved.
		expect(mm?.defaultConnection?.endpoint).toBe('china-standard');
		// Existing per-model override preserved.
		expect(mm?.models?.['glm-4.6v-flash']).toMatchObject({ visionMode: 'native' });
		// Preset added on top.
		expect(mm?.models?.['glm-5.2']).toMatchObject({
			endpointRoute: 'china-anthropic',
			visionMode: 'mcp',
		});
		// Custom models preserved.
		expect(mm?.customModels?.['my-team-model']).toBeDefined();
	});

	it('does not promote workspace-scoped models to the user-global config (F1)', async () => {
		// A model that exists ONLY at Workspace scope must not be baked into the
		// user-global override when the preset is applied. Before the F1 fix the
		// command read `.effective` (Global+Workspace+Folder merge) and promoted
		// it; now it reads `.globalValue` (user scope only).
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{ version: 1, models: { 'workspace-only-model': { visionMode: 'native' } } },
			ConfigurationTarget.Workspace,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { models?: Record<string, unknown> };
		const models = mm?.models ?? {};
		// Workspace-only model is NOT promoted to Global.
		expect(Object.prototype.hasOwnProperty.call(models, 'workspace-only-model')).toBe(false);
		// Preset overrides are still applied at Global.
		expect(models['glm-5.2']).toMatchObject({
			endpointRoute: 'china-anthropic',
			visionMode: 'mcp',
		});
	});

	it('does not promote a workspace defaultConnection.baseUrl to Global (F1)', async () => {
		// Field-level cross-scope merge: Global has {endpoint}, Workspace has a
		// different {baseUrl}. Only Global's fields may reach the user-global write.
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{ version: 1, defaultConnection: { endpoint: 'china-standard' } },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{ version: 1, defaultConnection: { baseUrl: 'https://workspace-only.example.com' } },
			ConfigurationTarget.Workspace,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { defaultConnection?: { endpoint?: string; baseUrl?: string } };
		expect(mm?.defaultConnection?.endpoint).toBe('china-standard');
		// Workspace baseUrl is NOT promoted to Global.
		expect(Object.prototype.hasOwnProperty.call(mm?.defaultConnection ?? {}, 'baseUrl')).toBe(
			false,
		);
	});

	it('does not promote workspace-folder-scoped custom models to Global (F1)', async () => {
		// Single-folder workspace so getActiveWorkspaceFolderResource() resolves to
		// it (no active text editor). A custom model seeded ONLY at folder scope
		// must not be promoted to the user-global override.
		const folder = Uri.file('/proj/folder');
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				customModels: { 'folder-team-model': { id: 'folder-team-model', thinking: true } },
			},
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { customModels?: Record<string, unknown> };
		expect(Object.prototype.hasOwnProperty.call(mm?.customModels ?? {}, 'folder-team-model')).toBe(
			false,
		);
	});

	it('does not promote a workspace customModels tombstone to Global (F1)', async () => {
		// Workspace sets customModels[<id>] = null (tombstone) while Global still
		// defines that model. The workspace tombstone must NOT delete the model at
		// the user-global scope (which would affect every other project).
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				customModels: { 'existing-global-model': { id: 'existing-global-model', thinking: true } },
			},
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{ version: 1, customModels: { 'existing-global-model': null } },
			ConfigurationTarget.Workspace,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { customModels?: Record<string, unknown> };
		// Global model is still defined — the workspace tombstone did not propagate.
		expect(mm?.customModels?.['existing-global-model']).toBeDefined();
	});

	it('preserves Global-scope legacy settings when reading user-scope only (F1)', async () => {
		// A legacy Global baseUrl (no canonical modelManagement) must still be
		// translated into the user-global defaultConnection: `globalValue` includes
		// Global-scope legacy translation, only the Workspace/Folder layers drop out.
		__setConfigurationValueAtScope(
			'glm-copilot.baseUrl',
			'https://user.example.com',
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { defaultConnection?: { baseUrl?: string } };
		expect(mm?.defaultConnection?.baseUrl).toBe('https://user.example.com');
	});
});
