import vscode from 'vscode';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';

export async function registerProvider(context: vscode.ExtensionContext): Promise<GLMChatProvider> {
	const provider = new GLMChatProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('glm-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('glm-copilot.queryUsage', () => provider.queryUsage()),
		vscode.commands.registerCommand('glm-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('glm-copilot.manageModels', () => provider.manageModels()),
		vscode.commands.registerCommand('glm-copilot.setVisionModel', () => provider.setVisionModel()),
		vscode.lm.registerLanguageModelChatProvider('glm', provider),
	);

	// Copilot Chat can serve cached model info without configurationSchema.
	// Activate it first so this refresh reaches a live listener and re-queries the provider.
	await activateCopilotChat();
	// The provider and commands are already registered above, so a failure here
	// (e.g. no active Chat view, transient API error) must not negate activation.
	try {
		provider.refreshModelPicker();
	} catch (error) {
		logger.warn('Model picker refresh failed; will retry on next chat interaction', error);
	}

	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
