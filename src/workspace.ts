import vscode from 'vscode';

/**
 * Resolve the workspace-folder resource that should own resource-scoped model
 * configuration. A single-root workspace remains deterministic even when the
 * chat view has focus and VS Code does not expose an active text editor.
 */
export function getActiveWorkspaceFolderResource(): vscode.Uri | undefined {
	const activeResource = vscode.window.activeTextEditor?.document.uri;
	if (activeResource) {
		const folder = vscode.workspace.getWorkspaceFolder(activeResource);
		if (folder) {
			return folder.uri;
		}
	}

	const folders = vscode.workspace.workspaceFolders;
	return folders?.length === 1 ? folders[0].uri : undefined;
}
