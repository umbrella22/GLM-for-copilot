import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';
import { registerActionUrls } from './actions';
import { seedChatLanguageModelDefaults } from './chat-language-models';
import { registerCommands } from './commands';
import { initializeDiagnostics } from './diagnostics';
import { initImageStore } from '../provider/vision/image-store';
import { registerMcp } from './mcp';
import { registerProvider } from './provider';
import { showWelcomeIfNeeded } from './welcome';

let activeProvider: GLMChatProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await initializeDiagnostics(context);
	await seedChatLanguageModelDefaults(context);
	registerCommands(context);
	registerActionUrls(context);

	try {
		const provider = await registerProvider(context);
		activeProvider = provider;

		// [FORK] Initialize the image store used by MCP vision mode to persist
		// user-sent images to disk, so MCP vision tools can read them by path.
		await initImageStore(context.globalStorageUri);

		// [FORK] Register the MCP server definition provider. Done in a separate
		// try/catch so a failure here never blocks model chat activation —
		// users still get GLM models even if MCP registration breaks.
		try {
			registerMcp(context, provider.authManager);
		} catch (mcpError) {
			logger.warn('MCP provider registration failed; model chat still available', mcpError);
		}

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn(t('extension.welcomeFailed'), error);
		});

		logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
	} catch (error) {
		activeProvider = undefined;
		logger.error('Failed to activate GLM extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
	}
}

export async function deactivate(): Promise<void> {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (error) {
		logger.warn(t('extension.deactivateFailed'), error);
	} finally {
		activeProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}
