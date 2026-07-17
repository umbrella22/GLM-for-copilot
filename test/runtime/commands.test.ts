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
	__setConfigurationUpdateFailure,
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

describe('runtime commands — resetToDefaults (FORK)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
		cleanupAllStoredImagesMock.mockClear();
	});

	it('does nothing when the user dismisses the confirmation dialog', async () => {
		__setWarningMessageButton(undefined);
		// Pre-set some values to prove they are NOT cleared on cancel.
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'ttl-7d');
		__setConfigurationValue('glm-copilot.mcp.zread.enabled', true);

		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetToDefaults');

		// Values untouched because the user cancelled.
		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		expect(cfg.get('mcp.imageCleanupMode')).toBe('ttl-7d');
		expect(cfg.get('mcp.zread.enabled')).toBe(true);
	});

	it('clears all fork-relevant keys including visionPrompt when confirmed', async () => {
		__setWarningMessageButton('Reset');
		// Set values across every category resetToDefaults should clear.
		__setConfigurationValue('glm-copilot.mcp.imageCleanupMode', 'ttl-7d');
		__setConfigurationValue('glm-copilot.mcp.zread.enabled', true);
		__setConfigurationValue('glm-copilot.imageHandlingPrompt', 'custom');
		__setConfigurationValue('glm-copilot.imageStoredPrompt', 'custom');
		__setConfigurationValue('glm-copilot.visionPrompt', 'custom');
		__setConfigurationValue('glm-copilot.experimental.stabilizeToolList', true);

		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetToDefaults');

		const cfg = vscode.workspace.getConfiguration('glm-copilot');
		// imageCleanupMode must be in the reset list (regression guard: an
		// earlier version missed it).
		expect(cfg.get('mcp.imageCleanupMode')).toBeUndefined();
		// All four built-in server toggles cleared.
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			expect(cfg.get(`mcp.${id}.enabled`), `mcp.${id}.enabled should be cleared`).toBeUndefined();
		}
		expect(cfg.get('imageHandlingPrompt')).toBeUndefined();
		expect(cfg.get('imageStoredPrompt')).toBeUndefined();
		// visionPrompt must be in the reset list (regression guard: this port
		// intentionally adds it — without it, a vision-prompt override would
		// survive "reset to defaults" while imageHandlingPrompt/imageStoredPrompt
		// do not, leaving an inconsistent footprint).
		expect(cfg.get('visionPrompt')).toBeUndefined();
		expect(cfg.get('experimental.stabilizeToolList')).toBeUndefined();
	});

	it('reports the full cleared count on success', async () => {
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetToDefaults');
		const messages = __getWindowMessages().information;
		// The done message includes the cleared count: 10 keys + modelManagement
		// = 11. Guards against the reset list silently shrinking.
		expect(messages.join(' ')).toMatch(/11/);
	});

	it('reports a partial failure when one key fails (F2)', async () => {
		const totalOps = 11; // 10 keys + modelManagement
		__setConfigurationUpdateFailure('glm-copilot.visionPrompt', ConfigurationTarget.Global);
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetToDefaults');

		const msgs = __getWindowMessages();
		// Partial-failure warning must include the failing key and the ratio.
		const partial = msgs.warning.find(
			(m) => m.includes('visionPrompt') && m.includes(`${totalOps - 1}/${totalOps}`),
		);
		expect(partial).toBeDefined();
		// The misleading success info and any error must NOT fire.
		expect(msgs.information.length).toBe(0);
		expect(msgs.error.length).toBe(0);
	});

	it('reports a total failure (error) when every reset fails (F2)', async () => {
		const totalOps = 11; // 10 keys + modelManagement
		// Fail every per-key reset, then the modelManagement write.
		const failingKeys = [
			'experimental.stabilizeToolList',
			'mcp.servers',
			'mcp.imageCleanupMode',
			'imageHandlingPrompt',
			'imageStoredPrompt',
			'visionPrompt',
			'modelManagement',
		];
		for (const key of failingKeys) {
			__setConfigurationUpdateFailure(`glm-copilot.${key}`, ConfigurationTarget.Global);
		}
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			__setConfigurationUpdateFailure(`glm-copilot.mcp.${id}.enabled`, ConfigurationTarget.Global);
		}
		__setWarningMessageButton('Reset');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.resetToDefaults');

		const msgs = __getWindowMessages();
		// Total failure -> error message with 0/totalOps.
		expect(msgs.error.length).toBe(1);
		expect(msgs.error[0]).toContain(`0/${totalOps}`);
		// Only the modal confirm warning fired; no success info, no partial warning.
		expect(msgs.warning.length).toBe(1);
		expect(msgs.information.length).toBe(0);
	});
});

describe('runtime commands — resetToDefaults i18n (FORK)', () => {
	it('renders partial, failed, and done messages without leftover placeholders (F2)', () => {
		// Guards against positional-arg misuse: t() maps {N} -> args[N] with no
		// skipping, so a mismatched template would leave a literal {N} behind.
		const partial = t('command.resetToDefaults.partial', 10, 11, 'visionPrompt: boom');
		expect(partial).not.toMatch(/\{\d\}/);
		expect(partial).toContain('10/11');
		expect(partial).toContain('visionPrompt');

		const failed = t('command.resetToDefaults.failed', 0, 11, 'modelManagement: boom');
		expect(failed).not.toMatch(/\{\d\}/);
		expect(failed).toContain('0/11');
		expect(failed).toContain('modelManagement');

		const done = t('command.resetToDefaults.done', 11);
		expect(done).not.toMatch(/\{\d\}/);
		expect(done).toContain('11');
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
