import vscode from 'vscode';
import { logger } from '../logger';
import { GLMChatProvider } from '../provider';

export function registerProvider(context: vscode.ExtensionContext): GLMChatProvider {
	const provider = new GLMChatProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('glm-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('glm-copilot.queryUsage', () => provider.queryUsage()),
		vscode.commands.registerCommand('glm-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('glm-copilot.manageModels', () => provider.manageModels()),
		vscode.commands.registerCommand('glm-copilot.setVisionModel', () => provider.setVisionModel()),
		vscode.lm.registerLanguageModelChatProvider('glm', provider),
	);

	// Make models discoverable without waiting for Copilot, which may itself be
	// waiting for BYOK providers during its own activation.
	try {
		provider.refreshModelPicker();
	} catch (error) {
		logger.warn('Model picker refresh failed; will retry after Copilot activates', error);
	}
	context.subscriptions.push(refreshModelsAfterCopilotActivation(provider));

	return provider;
}

function refreshModelsAfterCopilotActivation(provider: GLMChatProvider): vscode.Disposable {
	let disposed = false;

	// Copilot Chat can serve cached model info without configurationSchema, so
	// refresh again once it activates. Do not await that activation here:
	// Copilot Chat waits for BYOK providers while activating, so awaiting it
	// from registerProvider() can deadlock extension activation.
	Promise.resolve(vscode.extensions.getExtension('github.copilot-chat')?.activate())
		.then(() => {
			if (disposed) {
				return;
			}
			try {
				provider.refreshModelPicker();
			} catch (error) {
				logger.warn('Model picker refresh failed after Copilot activation', error);
			}
		})
		.catch((error) => {
			if (!disposed) {
				logger.warn(
					'Copilot Chat activation unavailable; model picker refresh may be delayed',
					error,
				);
			}
		});

	return {
		dispose: () => {
			disposed = true;
		},
	};
}
