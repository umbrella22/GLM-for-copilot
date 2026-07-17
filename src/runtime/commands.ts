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
import { MCP_CONFIG_KEY } from '../mcp/consts';
import { BUILTIN_MCP_SERVERS } from '../mcp/builtin';
import { resolveCredentialChannelApiKeyUrl } from '../endpoint';
import { cleanupAllStoredImages } from '../provider/vision/image-store';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { getActiveWorkspaceFolderResource } from '../workspace';
import type { ModelManagementConfigurationV1 } from '../types';

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
		// [FORK] Reset GLM Copilot settings to the fork's package.json defaults.
		// Useful for migration or for undoing applyCodingPlanPreset: clears user
		// overrides so the defaults take effect. API keys are NOT cleared.
		vscode.commands.registerCommand('glm-copilot.resetToDefaults', resetToDefaults),
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
 * [FORK] Reset fork-relevant settings to their package.json defaults by
 * clearing user-scope overrides. Workspace/workspace-folder overrides are
 * left untouched (those may carry legitimate team or project settings).
 *
 * Resets: modelManagement, stabilizeToolList, mcp.servers + per-server
 * toggles, imageCleanupMode, imageHandlingPrompt, imageStoredPrompt,
 * visionPrompt. API keys are NOT cleared.
 *
 * This is the inverse of `applyCodingPlanPreset` (which writes the subset
 * modelManagement + stabilizeToolList + per-server toggles), and additionally
 * restores the fork's image-handling / vision prompt templates.
 */
async function resetToDefaults(): Promise<void> {
	const confirm = await vscode.window.showWarningMessage(
		t('command.resetToDefaults.confirm'),
		{ modal: true },
		t('command.resetToDefaults.confirmYes'),
	);
	if (confirm !== t('command.resetToDefaults.confirmYes')) {
		return;
	}

	let cleared = 0;
	const errors: string[] = []; // [FORK] collect failures for diagnostics
	const target = vscode.ConfigurationTarget.Global;
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const keysToReset = [
		'experimental.stabilizeToolList',
		MCP_CONFIG_KEY,
		'mcp.zai-mcp-server.enabled',
		'mcp.web-search-prime.enabled',
		'mcp.web-reader.enabled',
		'mcp.zread.enabled',
		'mcp.imageCleanupMode',
		'imageHandlingPrompt',
		'imageStoredPrompt',
		'visionPrompt',
	];

	for (const key of keysToReset) {
		try {
			await config.update(key, undefined, target);
			cleared += 1;
		} catch (error) {
			logger.warn(`Failed to reset "${key}"`, error);
			errors.push(`${key}: ${toErrorMessage(error)}`);
		}
	}

	// modelManagement uses its own reset helper (handles the versioned shape).
	try {
		await resetModelManagementConfiguration(target);
		cleared += 1;
	} catch (error) {
		logger.warn('Failed to reset modelManagement', error);
		errors.push(`modelManagement: ${toErrorMessage(error)}`);
	}

	// [FORK] Surface partial failures explicitly (mirrors applyCodingPlanPreset).
	// Earlier only a total failure (cleared === 0) was reported, so a partial
	// failure fell through to the success message and the failing keys lived
	// only in the log.
	const totalOps = keysToReset.length + 1; // +1 for modelManagement
	if (errors.length > 0) {
		if (cleared === 0) {
			void vscode.window.showErrorMessage(
				t('command.resetToDefaults.failed', cleared, totalOps, errors.join('\n')),
			);
		} else {
			void vscode.window.showWarningMessage(
				t('command.resetToDefaults.partial', cleared, totalOps, errors.join('\n')),
			);
		}
		return;
	}
	void vscode.window.showInformationMessage(t('command.resetToDefaults.done', cleared));
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
