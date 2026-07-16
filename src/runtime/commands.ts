import vscode from 'vscode';
import { CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import { resetModelManagementConfiguration, resolveDefaultConnection } from '../config';
import { CONFIG_SECTION } from '../consts';
import { MCP_CONFIG_KEY } from '../mcp/consts';
import { resolveCredentialChannelApiKeyUrl } from '../endpoint';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { getActiveWorkspaceFolderResource } from '../workspace';

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
		// Useful for migration: clears user overrides so the new defaults (mcp
		// vision mode, stabilizeToolList on, built-in MCP servers, prompt
		// templates) take effect.
		vscode.commands.registerCommand('glm-copilot.resetToDefaults', resetToDefaults),
	);
}

/**
 * [FORK] Reset fork-relevant settings to their package.json defaults by
 * clearing user-scope overrides. Workspace/workspace-folder overrides are
 * left untouched (those may carry legitimate team or project settings).
 *
 * Resets: modelManagement, stabilizeToolList, mcp.servers + per-server
 * toggles, imageHandlingPrompt, imageStoredPrompt.
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

	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const target = vscode.ConfigurationTarget.Global;
	const keysToReset = [
		'experimental.stabilizeToolList',
		MCP_CONFIG_KEY,
		'mcp.zai-mcp-server.enabled',
		'mcp.web-search-prime.enabled',
		'mcp.web-reader.enabled',
		'mcp.zread.enabled',
		'imageHandlingPrompt',
		'imageStoredPrompt',
	];

	let cleared = 0;
	for (const key of keysToReset) {
		try {
			await config.update(key, undefined, target);
			cleared += 1;
		} catch (error) {
			logger.warn(`Failed to reset "${key}"`, error);
		}
	}

	// modelManagement uses its own reset helper (handles versioned shape).
	try {
		await resetModelManagementConfiguration(target);
		cleared += 1;
	} catch (error) {
		logger.warn('Failed to reset modelManagement', error);
	}

	void vscode.window.showInformationMessage(t('command.resetToDefaults.done', cleared));
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
