import vscode from 'vscode';
import { CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import {
	inspectEffectiveModelManagementConfiguration,
	mergeModelManagementConfigurations,
	resetModelManagementConfiguration,
	resolveDefaultConnection,
	saveModelManagementConfiguration,
} from '../config';
import { CONFIG_SECTION } from '../consts';
import { BUILTIN_MCP_SERVERS } from '../mcp/builtin';
import { resolveCredentialChannelApiKeyUrl } from '../endpoint';
import { cleanupAllStoredImages } from '../provider/vision/image-store';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { getActiveWorkspaceFolderResource } from '../workspace';
import type { ModelManagementConfigurationV1, ModelManagementModelConfiguration } from '../types';

export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('glm-copilot.showLogs', () => logger.show()),
		vscode.commands.registerCommand('glm-copilot.openRequestDumpsFolder', () =>
			openRequestDumpsFolder(context),
		),
		vscode.commands.registerCommand('glm-copilot.getApiKey', openApiKeyPage),
		vscode.commands.registerCommand('glm-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'glm-copilot'),
		),
		// [FORK] Value-based reset of the Coding Plan preset fields: clears only
		// those items whose current user-scope value still matches the preset
		// value. Items the user has modified away from the preset are left
		// untouched. This is NOT a true inverse of applyCodingPlanPreset — it
		// does not record or restore pre-apply state. API keys and workspace-
		// scoped settings are not touched.
		vscode.commands.registerCommand('glm-copilot.resetCodingPlanPreset', resetCodingPlanPreset),
		// [FORK] One-click preset for GLM Coding Plan subscription users.
		// Writes user-scope overrides (NOT built-in model definitions) so the
		// built-in defaults stay aligned with upstream, and Coding Plan users
		// opt in explicitly.
		vscode.commands.registerCommand('glm-copilot.applyCodingPlanPreset', applyCodingPlanPreset),
		// [FORK] Manually delete all stored MCP-vision images. Complements the
		// `glm-copilot.mcp.imageCleanupMode` setting ('manual' default).
		vscode.commands.registerCommand('glm-copilot.cleanupStoredImages', cleanupStoredImages),
	);
}

async function openApiKeyPage(): Promise<void> {
	const defaultChannel = resolveDefaultConnection(
		getActiveWorkspaceFolderResource(),
	).credentialChannel;
	const selected = await vscode.window.showQuickPick(
		CREDENTIAL_CHANNELS.map((channel) => ({
			label: formatCredentialChannel(channel),
			description: channel === defaultChannel ? t('auth.channel.default') : undefined,
			channel,
		})),
		{
			placeHolder: t('auth.selectChannel.get'),
			ignoreFocusOut: true,
		},
	);
	if (selected) {
		await vscode.env.openExternal(
			vscode.Uri.parse(resolveCredentialChannelApiKeyUrl(selected.channel)),
		);
	}
}

async function openRequestDumpsFolder(context: vscode.ExtensionContext): Promise<void> {
	try {
		const root = await ensureRequestDumpRoot(context.globalStorageUri);
		logger.info(`Opening request dumps folder: ${root.toString(true)}`);
		await vscode.commands.executeCommand('revealFileInOS', root);
	} catch (error) {
		logger.warn('Failed to open request dumps folder', error);
		void vscode.window.showErrorMessage(t('extension.openRequestDumpsFolderFailed'));
	}
}

/**
 * [FORK] Value-based reset of the Coding Plan preset fields: clears only
 * those items whose current user-scope value still matches the preset value.
 * Items the user has modified away from the preset are left untouched.
 * This is NOT a true inverse of applyCodingPlanPreset — it does not record
 * or restore pre-apply state. Workspace/workspace-folder overrides, custom
 * MCP servers, API keys, and unrelated user settings (image prompts,
 * imageCapableTools, …) are not touched.
 *
 * Reporting mirrors `applyCodingPlanPreset`'s three-state surface, with a
 * trailing hint listing how many items were skipped because the current
 * value no longer matched the preset.
 */
async function resetCodingPlanPreset(): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		t('command.resetCodingPlanPreset.confirm'),
		{ modal: true },
		t('command.resetCodingPlanPreset.confirmYes'),
	);
	if (confirm !== t('command.resetCodingPlanPreset.confirmYes')) {
		return;
	}

	let reset = 0;
	let skipped = 0;
	const errors: string[] = [];
	const target = vscode.ConfigurationTarget.Global;
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

	// 1. modelManagement — subset match on glm-5.2 / glm-5-turbo entries,
	//    then write back only if something actually changed. If the trimmed
	//    value collapses to the package.json default shape `{version:1}` the
	//    user override is cleared entirely so settings.json stays clean.
	//    Reading `.globalValue` (not the merged `.effective`) prevents
	//    workspace/folder overrides from being promoted into user-global.
	try {
		const resource = getActiveWorkspaceFolderResource();
		const current = inspectEffectiveModelManagementConfiguration(resource).globalValue;
		if (!current) {
			skipped += 1;
		} else {
			const trimmed = trimCodingPlanPresetFromModelManagement(current);
			if (!trimmed.changed) {
				skipped += 1;
			} else if (trimmed.equivalentToDefault) {
				await resetModelManagementConfiguration(target);
				reset += 1;
			} else {
				await saveModelManagementConfiguration(trimmed.value, target);
				reset += 1;
			}
		}
	} catch (error) {
		logger.warn('Failed to reset modelManagement', error);
		errors.push(`modelManagement: ${toErrorMessage(error)}`);
	}

	// 1b. Legacy cleanup — modelEndpointOverrides and modelVisionModes may
	//     contain stale values that re-fill the canonical modelManagement on
	//     the next read, undoing the reset. Value-aware: only delete entries
	//     whose current value still matches what applyCodingPlanPreset wrote.
	//     Other model entries in the same legacy map are preserved, and the
	//     map is set to undefined when it becomes empty so settings.json
	//     stays clean.
	try {
		const epInspect = config.inspect<Record<string, unknown>>('modelEndpointOverrides');
		const epValue = epInspect?.globalValue;
		if (epValue && typeof epValue === 'object' && !Array.isArray(epValue)) {
			const cleaned = { ...epValue };
			if (cleaned['glm-5.2'] === 'china-anthropic') {
				delete cleaned['glm-5.2'];
				const updated = Object.keys(cleaned).length > 0 ? cleaned : undefined;
				await config.update('modelEndpointOverrides', updated, target);
				reset += 1;
			} else {
				skipped += 1;
			}
		} else {
			skipped += 1;
		}
	} catch (error) {
		logger.warn('Failed to clean legacy modelEndpointOverrides', error);
		errors.push(`modelEndpointOverrides: ${toErrorMessage(error)}`);
	}

	try {
		const vmInspect = config.inspect<Record<string, unknown>>('modelVisionModes');
		const vmValue = vmInspect?.globalValue;
		if (vmValue && typeof vmValue === 'object' && !Array.isArray(vmValue)) {
			const cleaned = { ...vmValue };
			let changed = false;
			if (cleaned['glm-5.2'] === 'mcp') {
				delete cleaned['glm-5.2'];
				changed = true;
			}
			if (cleaned['glm-5-turbo'] === 'mcp') {
				delete cleaned['glm-5-turbo'];
				changed = true;
			}
			if (changed) {
				const updated = Object.keys(cleaned).length > 0 ? cleaned : undefined;
				await config.update('modelVisionModes', updated, target);
				reset += 1;
			} else {
				skipped += 1;
			}
		} else {
			skipped += 1;
		}
	} catch (error) {
		logger.warn('Failed to clean legacy modelVisionModes', error);
		errors.push(`modelVisionModes: ${toErrorMessage(error)}`);
	}

	// 2. stabilizeToolList — reset only when the user-scope value is exactly
	//    the preset's `true`. `false` or unset is treated as "user already
	//    moved off the preset" and skipped.
	try {
		const stabilizeInspect = config.inspect<boolean>('experimental.stabilizeToolList');
		if (stabilizeInspect?.globalValue === true) {
			await config.update('experimental.stabilizeToolList', undefined, target);
			reset += 1;
		} else {
			skipped += 1;
		}
	} catch (error) {
		logger.warn('Failed to reset stabilizeToolList', error);
		errors.push(`stabilizeToolList: ${toErrorMessage(error)}`);
	}

	// 3. Per built-in MCP `enabled` toggle — same value-aware rule.
	for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
		const key = `mcp.${id}.enabled`;
		try {
			const enabledInspect = config.inspect<boolean>(key);
			if (enabledInspect?.globalValue === true) {
				await config.update(key, undefined, target);
				reset += 1;
			} else {
				skipped += 1;
			}
		} catch (error) {
			logger.warn(`Failed to reset "${key}"`, error);
			errors.push(`${key}: ${toErrorMessage(error)}`);
		}
	}

	const totalOps = 2 + Object.keys(BUILTIN_MCP_SERVERS).length + 2; // +2 legacy fields
	const skippedHint = skipped > 0 ? `\n${t('command.resetCodingPlanPreset.skipped', skipped)}` : '';

	if (errors.length > 0) {
		if (reset === 0) {
			void vscode.window.showErrorMessage(
				t('command.resetCodingPlanPreset.failed', reset, totalOps, errors.join('\n')) + skippedHint,
			);
		} else {
			void vscode.window.showWarningMessage(
				t('command.resetCodingPlanPreset.partial', reset, totalOps, errors.join('\n')) +
					skippedHint,
			);
		}
		return;
	}
	void vscode.window.showInformationMessage(
		t('command.resetCodingPlanPreset.done', reset) + skippedHint,
	);
}

/**
 * [FORK] Result of stripping the Coding Plan preset fields off an existing
 * user-scope `modelManagement` value.
 */
interface CodingPlanPresetTrimResult {
	/** Value to write back (already normalized — preset fields removed). */
	readonly value: ModelManagementConfigurationV1;
	/** True iff at least one preset-targeted field was actually removed. */
	readonly changed: boolean;
	/**
	 * True iff the trimmed value collapses to the package.json default shape
	 * `{version:1}` (no defaultConnection, models, or customModels). In that
	 * case the caller clears the user override rather than writing back.
	 */
	readonly equivalentToDefault: boolean;
}

/**
 * [FORK] Build the model-management value that remains after stripping the
 * fields `applyCodingPlanPreset` writes. Uses conservative subset match: if
 * EITHER preset-targeted field of a `glm-5.2` / `glm-5-turbo` entry deviates
 * from the value the preset would write, the whole entry is kept untouched
 * (we don't risk breaking a user-tuned combination). Non-targeted entries,
 * `defaultConnection`, and `customModels` are always preserved verbatim.
 */
function trimCodingPlanPresetFromModelManagement(
	current: ModelManagementConfigurationV1,
): CodingPlanPresetTrimResult {
	const value: ModelManagementConfigurationV1 = {
		version: 1,
		...(current.defaultConnection ? { defaultConnection: current.defaultConnection } : {}),
		...(current.customModels ? { customModels: current.customModels } : {}),
	};

	let changed = false;
	if (current.models) {
		// Null-proto record so arbitrary ids (including the literal '__proto__')
		// survive as own data properties rather than hitting a plain object's
		// prototype setter.
		const newModels = Object.create(null) as Record<string, ModelManagementModelConfiguration>;
		let hasAnyModel = false;

		for (const [id, profile] of Object.entries(current.models)) {
			const trimmed = trimCodingPlanPresetModelEntry(id, profile);
			if (trimmed === null) {
				// Not a preset target, or subset didn't match — keep as-is.
				newModels[id] = profile;
				hasAnyModel = true;
				continue;
			}
			changed = true;
			if (Object.keys(trimmed).length === 0) {
				// Entry fully stripped — drop it from the map.
				continue;
			}
			newModels[id] = trimmed;
			hasAnyModel = true;
		}

		if (hasAnyModel) {
			value.models = newModels;
		}
	}

	const equivalentToDefault = !value.defaultConnection && !value.models && !value.customModels;
	return { value, changed, equivalentToDefault };
}

/**
 * [FORK] Return a shallow copy of `profile` with the preset-targeted fields
 * removed, or `null` to signal "keep this entry untouched" — either because
 * the id isn't a preset target, or because any preset-targeted field
 * deviates from the value `applyCodingPlanPreset` writes (subset match).
 */
function trimCodingPlanPresetModelEntry(
	id: string,
	profile: ModelManagementModelConfiguration,
): ModelManagementModelConfiguration | null {
	if (id === 'glm-5.2') {
		if (profile.endpointRoute !== 'china-anthropic' || profile.visionMode !== 'mcp') {
			return null;
		}
		const trimmed: ModelManagementModelConfiguration = { ...profile };
		delete trimmed.endpointRoute;
		delete trimmed.visionMode;
		return trimmed;
	}
	if (id === 'glm-5-turbo') {
		if (profile.visionMode !== 'mcp') {
			return null;
		}
		const trimmed: ModelManagementModelConfiguration = { ...profile };
		delete trimmed.visionMode;
		return trimmed;
	}
	return null;
}

/**
 * [FORK] Delete all stored MCP-vision images. Asks for confirmation because
 * deleting is irreversible and content-addressable files may still be
 * referenced by other (ongoing or future-replayed) conversations.
 */
async function cleanupStoredImages(): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		t('command.cleanupStoredImages.confirm'),
		{ modal: true },
		t('command.cleanupStoredImages.confirmYes'),
	);
	if (confirm !== t('command.cleanupStoredImages.confirmYes')) {
		return;
	}
	try {
		const deleted = await cleanupAllStoredImages();
		void vscode.window.showInformationMessage(t('command.cleanupStoredImages.done', deleted));
	} catch (error) {
		logger.warn('Failed to clean up stored images', error);
		void vscode.window.showErrorMessage(t('command.cleanupStoredImages.failed'));
	}
}

/**
 * [FORK] One-click preset that writes user-scope overrides (NOT built-in
 * model definitions) for GLM Coding Plan subscription users. This keeps the
 * built-in defaults aligned with upstream while letting Coding Plan users opt
 * into the recommended route + vision mode + MCP setup with one command.
 *
 * Writes (all at user scope, preserving existing overrides):
 *   - modelManagement:
 *       glm-5.2     -> { endpointRoute: 'china-anthropic', visionMode: 'mcp' }
 *       glm-5-turbo -> { visionMode: 'mcp' }
 *   - experimental.stabilizeToolList -> true
 *   - mcp.<id>.enabled -> true for all built-in MCP servers
 *
 * Does NOT touch: API keys, workspace-scoped settings, custom models.
 */
async function applyCodingPlanPreset(): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		t('command.applyCodingPlanPreset.confirm'),
		{ modal: true },
		t('command.applyCodingPlanPreset.confirmYes'),
	);
	if (confirm !== t('command.applyCodingPlanPreset.confirmYes')) {
		return;
	}

	let written = 0;
	const errors: string[] = []; // [FORK] collect failures for diagnostics
	const target = vscode.ConfigurationTarget.Global;

	// 1. Merge Coding Plan model overrides onto the USER-scope modelManagement
	//    config only, then save at user scope. Reading `.globalValue` (NOT the
	//    merged `.effective`) ensures workspace/folder overrides — a project-
	//    specific baseUrl, a workspace model route/vision override, a folder
	//    custom model, or a folder customModels tombstone — are NOT promoted
	//    into the user-global config and so do not leak into other projects.
	//    `globalValue` already includes Global-scope legacy translation, so
	//    legacy user settings are still preserved.
	//    The merge reuses the shared null-prototype helper so arbitrary existing
	//    model ids — including the legitimate '__proto__' id — survive as own
	//    data properties instead of hitting a plain object's `__proto__` setter.
	try {
		const resource = getActiveWorkspaceFolderResource();
		const current: ModelManagementConfigurationV1 = inspectEffectiveModelManagementConfiguration(
			resource,
		).globalValue ?? { version: 1 };
		// Coding Plan overrides only. 'glm-5.2' / 'glm-5-turbo' are known-safe
		// keys, so a plain literal is fine for the PRESET; arbitrary existing
		// ids ride on `current` and are merged by the null-prototype helper.
		const preset: ModelManagementConfigurationV1 = {
			version: 1,
			models: {
				'glm-5.2': { endpointRoute: 'china-anthropic', visionMode: 'mcp' },
				'glm-5-turbo': { visionMode: 'mcp' },
			},
		};
		const merged = mergeModelManagementConfigurations(current, preset);
		await saveModelManagementConfiguration(merged, target);
		written += 1;
	} catch (error) {
		logger.warn('Failed to apply Coding Plan preset to modelManagement', error);
		errors.push(`modelManagement: ${toErrorMessage(error)}`);
	}

	// 2. Enable stabilizeToolList (Coding Plan benefits from a stable tool list).
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	try {
		await config.update('experimental.stabilizeToolList', true, target);
		written += 1;
	} catch (error) {
		logger.warn('Failed to enable stabilizeToolList', error);
		errors.push(`stabilizeToolList: ${toErrorMessage(error)}`);
	}

	// 3. Enable all built-in MCP servers via their dedicated checkbox settings.
	//    (Custom servers in mcp.servers are left untouched.)
	for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
		try {
			await config.update(`mcp.${id}.enabled`, true, target);
			written += 1;
		} catch (error) {
			logger.warn(`Failed to enable MCP server "${id}"`, error);
			errors.push(`mcp.${id}.enabled: ${toErrorMessage(error)}`);
		}
	}

	// [FORK] Surface partial failures explicitly. Earlier only a total failure
	// (written === 0) was reported, so a partial failure fell through to the
	// success message and the failing keys lived only in the log.
	const totalOps = 2 + Object.keys(BUILTIN_MCP_SERVERS).length;
	if (errors.length > 0) {
		if (written === 0) {
			void vscode.window.showErrorMessage(
				t('command.applyCodingPlanPreset.failed', written, totalOps, errors.join('\n')),
			);
		} else {
			void vscode.window.showWarningMessage(
				t('command.applyCodingPlanPreset.partial', written, totalOps, errors.join('\n')),
			);
		}
		return;
	}
	void vscode.window.showInformationMessage(t('command.applyCodingPlanPreset.done', written));
}

/**
 * [FORK] Reduce an unknown caught value to a short human-readable message,
 * used when surfacing command failures to the user (debugging the
 * "0 items written" / "0 items reset" symptom).
 */
function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return String(error);
}
