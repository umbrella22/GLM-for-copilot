import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';
import { registerActionUrls } from './actions';
import { seedChatLanguageModelDefaults } from './chat-language-models';
import { registerCommands } from './commands';
import { initializeDiagnostics } from './diagnostics';
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
