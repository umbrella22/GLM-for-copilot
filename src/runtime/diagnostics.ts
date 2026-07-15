import vscode from 'vscode';
import { migrateLegacyApiKey } from '../auth';
import {
	getDebugMode,
	migrateLegacyDebugSetting,
	migrateLegacyEndpointSettings,
	migrateLegacyModelManagementSettings,
} from '../config';
import { CONFIG_SECTION } from '../consts';
import { logger } from '../logger';

export async function initializeDiagnostics(context: vscode.ExtensionContext): Promise<void> {
	try {
		await migrateLegacyDebugSetting();
	} catch (error) {
		logger.warn('Failed to migrate legacy debug setting', error);
	}

	try {
		await migrateLegacyEndpointSettings();
	} catch (error) {
		logger.warn('Failed to migrate legacy endpoint settings', error);
	}
	try {
		await migrateLegacyModelManagementSettings();
	} catch (error) {
		logger.warn('Failed to migrate legacy model management settings', error);
	}

	try {
		await migrateLegacyApiKey(context);
	} catch (error) {
		logger.warn('Failed to migrate legacy API key', error);
	}

	logger.info(
		`Activating extension version=${context.extension.packageJSON.version}` +
			` vscode=${vscode.version}` +
			` extensionKind=${context.extension.extensionKind}` +
			` remoteName=${vscode.env.remoteName ?? 'none'}` +
			` uiKind=${vscode.env.uiKind}` +
			` platform=${process.platform}` +
			` arch=${process.arch}` +
			` debugMode=${getDebugMode()}`,
	);

	let currentDebugMode = getDebugMode();
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(`${CONFIG_SECTION}.debugMode`)) {
				const previous = currentDebugMode;
				currentDebugMode = getDebugMode();
				logger.info(`debugMode changed: ${previous} -> ${currentDebugMode}`);
			}
		}),
	);
}
