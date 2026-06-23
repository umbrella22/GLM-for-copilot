import vscode from 'vscode';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from '../consts';
import { GLMChatProvider } from '../provider';

export async function showWelcomeIfNeeded(
	context: vscode.ExtensionContext,
	provider: GLMChatProvider,
): Promise<void> {
	if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
		return;
	}
	if (await provider.hasApiKey()) {
		await context.globalState.update(WELCOME_SHOWN_KEY, true);
		return;
	}

	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
	await context.globalState.update(WELCOME_SHOWN_KEY, true);
}
