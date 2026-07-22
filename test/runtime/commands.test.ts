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
	__clearConfigurationUpdateFailure,
	__getOpenedExternal,
	__getConfigurationValueAtScope,
	__resetCommandState,
	__setConfigurationUpdateFailure,
	__setConfigurationValue,
	__setConfigurationValueAtScope,
	__setQuickPickSelectionLabel,
	__setWarningMessageButton,
	__setWorkspaceFolders,
	ConfigurationTarget,
	Uri,
	__getWindowMessages,
} from '../support/vscode.mock';
import { t } from '../../src/i18n';

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

	it('preserves a legitimate "__proto__" model id as an own property (F3)', async () => {
		// '__proto__' is a valid canonical model id in this repo. Seed it via
		// JSON.parse so it lands as an OWN data property — an object literal
		// { __proto__: ... } would hit the setter and fail to seed. The preset
		// must preserve it end-to-end (previously a plain {} build dropped it).
		const seeded = JSON.parse('{"version":1,"models":{"__proto__":{"visionMode":"native"}}}');
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			seeded,
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { models?: Record<string, { visionMode?: string; endpointRoute?: string }> };
		expect(mm?.models).toBeDefined();
		// __proto__ survives as an own data property end-to-end.
		expect(Object.prototype.hasOwnProperty.call(mm?.models, '__proto__')).toBe(true);
		expect(mm?.models?.['__proto__']).toMatchObject({ visionMode: 'native' });
		// Preset still applies on the known-safe keys.
		expect(mm?.models?.['glm-5.2']).toMatchObject({
			endpointRoute: 'china-anthropic',
			visionMode: 'mcp',
		});
	});

	it('reports a partial failure when one MCP checkbox fails (F2)', async () => {
		const [failingId] = Object.keys(BUILTIN_MCP_SERVERS);
		const totalOps = 2 + Object.keys(BUILTIN_MCP_SERVERS).length;
		__setConfigurationUpdateFailure(
			`glm-copilot.mcp.${failingId}.enabled`,
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const msgs = __getWindowMessages();
		// warning[0] is the modal confirm; the partial-failure warning comes
		// after it and must include the failing key and the success/total ratio.
		const partial = msgs.warning.find(
			(m) => m.includes(`mcp.${failingId}.enabled`) && m.includes(`${totalOps - 1}/${totalOps}`),
		);
		expect(partial).toBeDefined();
		// The misleading success info and any error must NOT fire.
		expect(msgs.information.length).toBe(0);
		expect(msgs.error.length).toBe(0);
		// Non-failing MCP ids still wrote.
		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			if (id === failingId) continue;
			expect(cfg.get(`mcp.${id}.enabled`)).toBe(true);
		}
	});

	it('reports a partial failure when the modelManagement write fails (F2)', async () => {
		const totalOps = 2 + Object.keys(BUILTIN_MCP_SERVERS).length;
		__setConfigurationUpdateFailure('glm-copilot.modelManagement', ConfigurationTarget.Global);
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const msgs = __getWindowMessages();
		// modelManagement failed but stabilizeToolList + all MCP succeeded.
		const partial = msgs.warning.find(
			(m) => m.includes('modelManagement') && m.includes(`${totalOps - 1}/${totalOps}`),
		);
		expect(partial).toBeDefined();
		expect(msgs.information.length).toBe(0);
	});

	it('reports a total failure (error) when every write fails (F2)', async () => {
		const totalOps = 2 + Object.keys(BUILTIN_MCP_SERVERS).length;
		// Fail every sub-op: modelManagement, stabilizeToolList, all MCP checkboxes.
		__setConfigurationUpdateFailure('glm-copilot.modelManagement', ConfigurationTarget.Global);
		__setConfigurationUpdateFailure(
			'glm-copilot.experimental.stabilizeToolList',
			ConfigurationTarget.Global,
		);
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			__setConfigurationUpdateFailure(`glm-copilot.mcp.${id}.enabled`, ConfigurationTarget.Global);
		}
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		const msgs = __getWindowMessages();
		// Total failure -> error message with 0/totalOps and the joined reasons.
		expect(msgs.error.length).toBe(1);
		expect(msgs.error[0]).toContain(`0/${totalOps}`);
		expect(msgs.error[0]).toContain('modelManagement');
		// Only the modal confirm warning fired; no success info, no partial warning.
		expect(msgs.warning.length).toBe(1);
		expect(msgs.information.length).toBe(0);
	});
});

describe('runtime commands — applyCodingPlanPreset i18n (FORK)', () => {
	it('renders partial and failed messages without leftover placeholders (F2)', () => {
		// Guards against positional-arg misuse: t() maps {N} -> args[N] with no
		// skipping, so a mismatched template would leave a literal {N} behind.
		const partial = t('command.applyCodingPlanPreset.partial', 5, 6, 'mcp.x.enabled: boom');
		expect(partial).not.toMatch(/\{\d\}/);
		expect(partial).toContain('5/6');
		expect(partial).toContain('mcp.x.enabled');

		const failed = t('command.applyCodingPlanPreset.failed', 0, 6, 'modelManagement: boom');
		expect(failed).not.toMatch(/\{\d\}/);
		expect(failed).toContain('0/6');
		expect(failed).toContain('modelManagement');
	});
});

describe('runtime commands — resetCodingPlanPreset (FORK)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
		cleanupAllStoredImagesMock.mockClear();
	});

	it('does nothing when the user dismisses the confirmation dialog', async () => {
		__setWarningMessageButton(undefined);
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// No success/error message surfaced (only the confirmation prompt).
		expect(__getWindowMessages().information.length).toBe(0);
		expect(__getWindowMessages().error.length).toBe(0);
	});

	it('resets all 6 preset items after applyCodingPlanPreset and clears modelManagement entirely', async () => {
		// Apply preset first so we have the canonical values to reset.
		__setWarningMessageButton('Apply');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.applyCodingPlanPreset');

		// Reset.
		__setWarningMessageButton('Reset');
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		// All MCP toggles back to default (false / unset).
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			expect(
				cfg.inspect<boolean>(`mcp.${id}.enabled`)?.globalValue,
				`mcp.${id}.enabled globalValue should be unset after reset`,
			).toBeUndefined();
		}
		// stabilizeToolList back to default (unset; package.json default false).
		expect(cfg.inspect<boolean>('experimental.stabilizeToolList')?.globalValue).toBeUndefined();
		// modelManagement collapsed to default {version:1} → user override cleared entirely.
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toBeUndefined();
	});

	it('preserves non-preset model entries and customModels when resetting', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				defaultConnection: { endpoint: 'china-standard' },
				models: {
					'glm-5.2': { endpointRoute: 'china-anthropic', visionMode: 'mcp' },
					'glm-5-turbo': { visionMode: 'mcp' },
					'glm-4.6v-flash': { visionMode: 'native' },
				},
				customModels: { 'my-team-model': { id: 'my-team-model', thinking: true } },
			},
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as {
			defaultConnection?: { endpoint?: string };
			models?: Record<string, unknown>;
			customModels?: Record<string, unknown>;
		};
		// Preset entries removed.
		expect(mm?.models?.['glm-5.2']).toBeUndefined();
		expect(mm?.models?.['glm-5-turbo']).toBeUndefined();
		// Non-preset entry preserved.
		expect(mm?.models?.['glm-4.6v-flash']).toMatchObject({ visionMode: 'native' });
		// Other user fields preserved.
		expect(mm?.defaultConnection?.endpoint).toBe('china-standard');
		expect(mm?.customModels?.['my-team-model']).toBeDefined();
	});

	it('keeps the glm-5.2 entry untouched when visionMode was changed by the user', async () => {
		// User changed visionMode from preset 'mcp' to 'native' but left endpointRoute alone.
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.2': { endpointRoute: 'china-anthropic', visionMode: 'native' },
				},
			},
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { models?: Record<string, { endpointRoute?: string; visionMode?: string }> };
		// Subset didn't match → entire entry preserved (no field stripped).
		expect(mm?.models?.['glm-5.2']).toEqual({
			endpointRoute: 'china-anthropic',
			visionMode: 'native',
		});
	});

	it('keeps the glm-5-turbo entry untouched when visionMode was changed by the user', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: { 'glm-5-turbo': { visionMode: 'proxy' } },
			},
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as { models?: Record<string, { visionMode?: string }> };
		expect(mm?.models?.['glm-5-turbo']).toEqual({ visionMode: 'proxy' });
	});

	it('drops only preset fields when glm-5.2 has extra user fields (apiModelId)', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.2': {
						apiModelId: 'custom-5.2-id',
						endpointRoute: 'china-anthropic',
						visionMode: 'mcp',
					},
				},
			},
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const mm = __getConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
		) as {
			models?: Record<string, { apiModelId?: string; endpointRoute?: string; visionMode?: string }>;
		};
		// Preset fields removed, user-added apiModelId preserved.
		expect(mm?.models?.['glm-5.2']).toEqual({ apiModelId: 'custom-5.2-id' });
	});

	it('skips stabilizeToolList when user set it to false (no preset match)', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.experimental.stabilizeToolList',
			false,
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		// Still false — user override left alone.
		expect(cfg.inspect<boolean>('experimental.stabilizeToolList')?.globalValue).toBe(false);
		// The skipped hint surfaces in the info message.
		expect(__getWindowMessages().information.join(' ')).toMatch(/skipped/i);
	});

	it('skips mcp.<id>.enabled when user set it to false (no preset match)', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.mcp.zai-mcp-server.enabled',
			false,
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		expect(cfg.inspect<boolean>('mcp.zai-mcp-server.enabled')?.globalValue).toBe(false);
		// The skipped hint surfaces in the info message.
		expect(__getWindowMessages().information.join(' ')).toMatch(/skipped/i);
	});

	it('reports total failure when every reset op throws', async () => {
		// Seed values so the command actually attempts writes (otherwise the
		// ops are no-ops and never reach the throwing update()).
		__setConfigurationValueAtScope(
			'glm-copilot.experimental.stabilizeToolList',
			true,
			ConfigurationTarget.Global,
		);
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			__setConfigurationValueAtScope(
				`glm-copilot.mcp.${id}.enabled`,
				true,
				ConfigurationTarget.Global,
			);
		}
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.2': { endpointRoute: 'china-anthropic', visionMode: 'mcp' },
					'glm-5-turbo': { visionMode: 'mcp' },
				},
			},
			ConfigurationTarget.Global,
		);
		// Legacy fields: seed matching preset values so the cleanup attempts
		// to write, then make those writes fail as well.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp', 'glm-5-turbo': 'mcp' },
			ConfigurationTarget.Global,
		);
		// Force every update() to throw. The key is registered without a
		// target so any scope matches.
		__setConfigurationUpdateFailure('glm-copilot.experimental.stabilizeToolList');
		__setConfigurationUpdateFailure('glm-copilot.mcp.zai-mcp-server.enabled');
		__setConfigurationUpdateFailure('glm-copilot.mcp.web-search-prime.enabled');
		__setConfigurationUpdateFailure('glm-copilot.mcp.web-reader.enabled');
		__setConfigurationUpdateFailure('glm-copilot.mcp.zread.enabled');
		__setConfigurationUpdateFailure('glm-copilot.modelManagement');
		__setConfigurationUpdateFailure('glm-copilot.modelEndpointOverrides');
		__setConfigurationUpdateFailure('glm-copilot.modelVisionModes');

		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// 0/7 surfaced as an error message.
		const errors = __getWindowMessages().error;
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(' ')).toMatch(/0\/7/);
	});

	it('reports partial failure when some ops throw and others succeed', async () => {
		__setConfigurationValueAtScope(
			'glm-copilot.experimental.stabilizeToolList',
			true,
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.mcp.zai-mcp-server.enabled',
			true,
			ConfigurationTarget.Global,
		);
		// Only stabilizeToolList throws; other ops succeed.
		__setConfigurationUpdateFailure('glm-copilot.experimental.stabilizeToolList');

		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const warnings = __getWindowMessages().warning;
		expect(warnings.length).toBeGreaterThan(0);
		// 1 op succeeded out of 7 total → "1/7".
		expect(warnings.join(' ')).toMatch(/1\/7/);
	});

	// -- Legacy cleanup regression tests (PR #16 R3) --

	it('cleans stale legacy modelEndpointOverrides and modelVisionModes (pure legacy)', async () => {
		// Legacy-only values matching the preset — no canonical modelManagement.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic', 'other-model': 'same-region-standard' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp', 'glm-5-turbo': 'mcp' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// Legacy entries matching the preset are removed.
		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(ep?.['glm-5.2']).toBeUndefined();
		// Non-preset model entry preserved.
		expect(ep?.['other-model']).toBe('same-region-standard');

		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(vm?.['glm-5.2']).toBeUndefined();
		expect(vm?.['glm-5-turbo']).toBeUndefined();
	});

	it('cleans both canonical and stale legacy entries together', async () => {
		// Canonical + matching legacy values coexist (post-migration partial-failure scenario).
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.2': { endpointRoute: 'china-anthropic', visionMode: 'mcp' },
					'glm-5-turbo': { visionMode: 'mcp' },
				},
			},
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp', 'glm-5-turbo': 'mcp' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// Canonical modelManagement collapsed to default → cleared.
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toBeUndefined();
		// Legacy fields cleared.
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelEndpointOverrides',
				ConfigurationTarget.Global,
			),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelVisionModes', ConfigurationTarget.Global),
		).toBeUndefined();
	});

	it('preserves non-matching legacy sibling model entries', async () => {
		// visionModes has glm-5-turbo matching the preset, but glm-4.6v-flash
		// set to 'native' — only the preset-matching entry is removed.
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5-turbo': 'mcp', 'glm-4.6v-flash': 'native' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(vm?.['glm-5-turbo']).toBeUndefined();
		expect(vm?.['glm-4.6v-flash']).toBe('native');
	});

	it('rolls back modelEndpointOverrides when modelVisionModes write fails (R5 atomic)', async () => {
		// Seed matching legacy values and force modelVisionModes write to fail.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp', 'glm-5-turbo': 'mcp' },
			ConfigurationTarget.Global,
		);
		__setConfigurationUpdateFailure('glm-copilot.modelVisionModes');
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// The atomic unit failed: nothing was reset, so it surfaces as an error.
		const errors = __getWindowMessages().error;
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(' ')).toContain('modelVisionModes');
		// modelEndpointOverrides was rolled back to its original value — NOT
		// left cleared, so a retry still sees the eligible combination.
		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(ep?.['glm-5.2']).toBe('china-anthropic');
		// modelVisionModes retain their original values too.
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(vm?.['glm-5.2']).toBe('mcp');
		expect(vm?.['glm-5-turbo']).toBe('mcp');
	});

	it('recovers on retry after a legacy vision write failure (R5 retry)', async () => {
		// Seed matching legacy values, force the vision write to fail on the
		// first attempt, then clear the failure and retry — both maps must end
		// up fully cleaned, proving the rollback left no stuck half-state.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp', 'glm-5-turbo': 'mcp' },
			ConfigurationTarget.Global,
		);
		__setConfigurationUpdateFailure('glm-copilot.modelVisionModes');
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// First attempt: vision failed, route rolled back — nothing cleaned.
		expect(
			(
				__getConfigurationValueAtScope(
					'glm-copilot.modelEndpointOverrides',
					ConfigurationTarget.Global,
				) as Record<string, unknown> | undefined
			)?.['glm-5.2'],
		).toBe('china-anthropic');

		// Clear the failure and retry.
		__clearConfigurationUpdateFailure('glm-copilot.modelVisionModes');
		__setWarningMessageButton('Reset');
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// Second attempt: both maps fully cleaned.
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.modelEndpointOverrides',
				ConfigurationTarget.Global,
			),
		).toBeUndefined();
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(vm?.['glm-5.2']).toBeUndefined();
		expect(vm?.['glm-5-turbo']).toBeUndefined();
	});

	it('does not touch modelVisionModes when modelEndpointOverrides write fails (R5 reverse)', async () => {
		// Reverse direction: route write fails first → vision write is never
		// attempted, so vision stays at its original value untouched.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp', 'glm-5-turbo': 'mcp' },
			ConfigurationTarget.Global,
		);
		__setConfigurationUpdateFailure('glm-copilot.modelEndpointOverrides');
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const errors = __getWindowMessages().error;
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(' ')).toContain('modelEndpointOverrides');
		// Route write failed → it was never cleared.
		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(ep?.['glm-5.2']).toBe('china-anthropic');
		// Vision write was not attempted → original values preserved.
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(vm?.['glm-5.2']).toBe('mcp');
		expect(vm?.['glm-5-turbo']).toBe('mcp');
	});

	// -- Legacy × canonical interaction regression tests (PR #16 R4) --

	it('does NOT promote legacy sibling models into canonical modelManagement', async () => {
		// Pure legacy config: only a non-preset-target sibling lives in the
		// legacy maps. Previously reset would read the merged Global value
		// (legacy + canonical) and write the legacy sibling back as canonical,
		// permanently freezing it. Now reset reads canonical-only and the
		// sibling stays in legacy untouched.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'other-model': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'other-model': 'native' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// Canonical never written for non-preset models.
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toBeUndefined();
		// Legacy sibling preserved verbatim.
		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(ep?.['other-model']).toBe('china-anthropic');
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(vm?.['other-model']).toBe('native');
	});

	it('preserves glm-5.2 legacy entries when route matches but vision does not (R4 F2a)', async () => {
		// glm-5.2: route=china-anthropic + vision=native → subset does NOT
		// match. The legacy path must keep BOTH maps intact for glm-5.2,
		// mirroring the canonical subset rule.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'native' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		// Neither map should lose its glm-5.2 entry — the dual-field preset
		// match failed, so both halves stay.
		expect(ep?.['glm-5.2']).toBe('china-anthropic');
		expect(vm?.['glm-5.2']).toBe('native');
	});

	it('preserves glm-5.2 legacy entries when vision matches but route does not (R4 F2b)', async () => {
		// glm-5.2: route=china-standard + vision=mcp → subset does NOT match.
		// The legacy path must keep BOTH maps intact for glm-5.2.
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'glm-5.2': 'china-standard' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'glm-5.2': 'mcp' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(ep?.['glm-5.2']).toBe('china-standard');
		expect(vm?.['glm-5.2']).toBe('mcp');
	});

	it('does not promote legacy siblings to canonical when canonical already has preset entries', async () => {
		// Composite scenario: user ran applyCodingPlanPreset (which wrote the
		// canonical preset entries) AND has unrelated legacy siblings from
		// pre-migration configuration. reset must clear the canonical preset
		// entries AND leave the legacy siblings untouched (not freeze them
		// into canonical by writing back the merged Global value).
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{
				version: 1,
				models: {
					'glm-5.2': { endpointRoute: 'china-anthropic', visionMode: 'mcp' },
					'glm-5-turbo': { visionMode: 'mcp' },
				},
			},
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			{ 'other-model': 'china-anthropic' },
			ConfigurationTarget.Global,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			{ 'other-model': 'native' },
			ConfigurationTarget.Global,
		);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetCodingPlanPreset');

		// Canonical collapsed to default → user override cleared.
		expect(
			__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
		).toBeUndefined();
		// Legacy siblings still in legacy, NOT promoted into canonical.
		const ep = __getConfigurationValueAtScope(
			'glm-copilot.modelEndpointOverrides',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		const vm = __getConfigurationValueAtScope(
			'glm-copilot.modelVisionModes',
			ConfigurationTarget.Global,
		) as Record<string, unknown> | undefined;
		expect(ep?.['other-model']).toBe('china-anthropic');
		expect(vm?.['other-model']).toBe('native');
	});
});
