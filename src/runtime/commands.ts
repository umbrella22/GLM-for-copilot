import vscode from 'vscode';
import { CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import {
	inspectEffectiveModelManagementConfiguration,
	inspectModelManagementConfiguration,
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
	//    Reads the CANONICAL user-scope value via `inspectModelManagementConfiguration`
	//    (not `inspectEffectiveModelManagementConfiguration`) so legacy
	//    sibling models in the same Global scope are NOT merged into the
	//    snapshot we write back — otherwise they'd be permanently promoted
	//    to canonical and later legacy edits would be silently overridden.
	try {
		const resource = getActiveWorkspaceFolderResource();
		const current = inspectModelManagementConfiguration(resource).globalValue;
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

	// 1b. Legacy cleanup — modelEndpointOverrides (route) and modelVisionModes
	//     (vision) may contain stale values that re-fill the canonical
	//     modelManagement on the next read, undoing the reset. The two maps are
	//     evaluated JOINTLY per model id: glm-5.2 is only cleared when BOTH its
	//     endpointRoute (from modelEndpointOverrides) AND visionMode (from
	//     modelVisionModes) still match the preset, mirroring the canonical
	//     subset rule. This prevents half-matching combinations like
	//     `route=china-anthropic + vision=native` from losing just the route,
	//     or `route=china-standard + vision=mcp` from losing just the vision.
	//     glm-5-turbo only carries a visionMode so it falls back to a
	//     single-field match. The route and vision writes form ONE atomic
	//     logical unit: if the route write fails the vision write is not
	//     attempted; if the vision write fails the route write is rolled back
	//     to its original value so a later retry still sees the full eligible
	//     combination and can complete instead of getting stuck half-reset.
	//     Only when both writes succeed does the unit count as one reset.
	//     Empty maps are set to undefined so settings.json stays clean. Other
	//     model entries in the same map are preserved.
	const epInspect = config.inspect<Record<string, unknown>>('modelEndpointOverrides');
	const vmInspect = config.inspect<Record<string, unknown>>('modelVisionModes');
	const epValue =
		epInspect?.globalValue &&
		typeof epInspect.globalValue === 'object' &&
		!Array.isArray(epInspect.globalValue)
			? (epInspect.globalValue as Record<string, unknown>)
			: undefined;
	const vmValue =
		vmInspect?.globalValue &&
		typeof vmInspect.globalValue === 'object' &&
		!Array.isArray(vmInspect.globalValue)
			? (vmInspect.globalValue as Record<string, unknown>)
			: undefined;

	const cleanedEp = epValue ? { ...epValue } : undefined;
	const cleanedVm = vmValue ? { ...vmValue } : undefined;
	let epMatched = false;
	let vmMatched = false;
	for (const id of CODING_PLAN_PRESET_TARGET_IDS) {
		const fields = getCodingPlanPresetResetFields(id, cleanedEp?.[id], cleanedVm?.[id]);
		if (!fields) {
			continue;
		}
		if (fields.endpointRoute && cleanedEp && id in cleanedEp) {
			delete cleanedEp[id];
			epMatched = true;
		}
		if (fields.visionMode && cleanedVm && id in cleanedVm) {
			delete cleanedVm[id];
			vmMatched = true;
		}
	}

	const epUpdated = cleanedEp && Object.keys(cleanedEp).length > 0 ? cleanedEp : undefined;
	const vmUpdated = cleanedVm && Object.keys(cleanedVm).length > 0 ? cleanedVm : undefined;

	if (!epMatched && !vmMatched) {
		skipped += 1;
	} else {
		// Atomic legacy cleanup unit: route first, then vision. Roll back the
		// route write if the vision write fails so the next reset retry still
		// sees the full eligible combination instead of a stuck half-state.
		let epWritten = false;
		let unitFailed = false;
		if (epMatched) {
			try {
				await config.update('modelEndpointOverrides', epUpdated, target);
				epWritten = true;
			} catch (error) {
				logger.warn('Failed to clean legacy modelEndpointOverrides', error);
				errors.push(`modelEndpointOverrides: ${toErrorMessage(error)}`);
				unitFailed = true;
			}
		}
		if (!unitFailed && vmMatched) {
			try {
				await config.update('modelVisionModes', vmUpdated, target);
			} catch (error) {
				logger.warn('Failed to clean legacy modelVisionModes', error);
				errors.push(`modelVisionModes: ${toErrorMessage(error)}`);
				if (epWritten) {
					try {
						await config.update('modelEndpointOverrides', epValue, target);
					} catch (rollbackError) {
						logger.warn(
							'Failed to rollback modelEndpointOverrides after modelVisionModes failure',
							rollbackError,
						);
						errors.push(`modelEndpointOverrides rollback: ${toErrorMessage(rollbackError)}`);
					}
				}
				unitFailed = true;
			}
		}
		if (!unitFailed) {
			reset += 1;
		}
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

	const totalOps = 2 + Object.keys(BUILTIN_MCP_SERVERS).length + 1; // +1 atomic legacy unit
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
 * [FORK] Model ids that `applyCodingPlanPreset` writes to. Shared by the
 * canonical trim path and the legacy cleanup path so the same set of ids is
 * considered eligible for value-based reset in both representations.
 */
const CODING_PLAN_PRESET_TARGET_IDS: ReadonlyArray<string> = ['glm-5.2', 'glm-5-turbo'];

/**
 * [FORK] Per-field result of a value-based preset eligibility check. Each
 * present flag means "the corresponding field still matches the value
 * `applyCodingPlanPreset` writes, so the reset path should clear it". A
 * `null` return means the id is either not a preset target or any targeted
 * field deviates from the preset — caller must leave the entry untouched.
 */
interface CodingPlanPresetResetFields {
	readonly endpointRoute?: true;
	readonly visionMode?: true;
}

/**
 * [FORK] Single source of truth for value-based preset eligibility. Both the
 * canonical reset path (modelManagement.models[id]) and the legacy reset path
 * (modelEndpointOverrides[id] + modelVisionModes[id]) MUST call this helper
 * so glm-5.2's dual AND-match rule (route === 'china-anthropic' AND vision
 * === 'mcp') is applied identically across representations. Any deviation
 * between the two paths reopens the bug where one representation clears a
 * field the other keeps, leaving the user's combination half-reset.
 */
function getCodingPlanPresetResetFields(
	id: string,
	endpointRoute: unknown,
	visionMode: unknown,
): CodingPlanPresetResetFields | null {
	if (id === 'glm-5.2') {
		if (endpointRoute === 'china-anthropic' && visionMode === 'mcp') {
			return { endpointRoute: true, visionMode: true };
		}
		return null;
	}
	if (id === 'glm-5-turbo') {
		if (visionMode === 'mcp') {
			return { visionMode: true };
		}
		return null;
	}
	return null;
}

/**
 * [FORK] Return a shallow copy of `profile` with the preset-targeted fields
 * removed, or `null` to signal "keep this entry untouched" — either because
 * the id isn't a preset target, or because any preset-targeted field
 * deviates from the value `applyCodingPlanPreset` writes (subset match).
 * Delegates to `getCodingPlanPresetResetFields` so the canonical and legacy
 * reset paths share one eligibility rule.
 */
function trimCodingPlanPresetModelEntry(
	id: string,
	profile: ModelManagementModelConfiguration,
): ModelManagementModelConfiguration | null {
	const fields = getCodingPlanPresetResetFields(id, profile.endpointRoute, profile.visionMode);
	if (!fields) {
		return null;
	}
	const trimmed: ModelManagementModelConfiguration = { ...profile };
	if (fields.endpointRoute) {
		delete trimmed.endpointRoute;
	}
	if (fields.visionMode) {
		delete trimmed.visionMode;
	}
	return trimmed;
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
