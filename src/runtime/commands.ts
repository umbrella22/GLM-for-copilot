import vscode from 'vscode';
import { CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import { resolveDefaultConnection } from '../config';
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
