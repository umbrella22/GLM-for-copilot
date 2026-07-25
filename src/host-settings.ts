import vscode from 'vscode';

export type ByokUtilityModelDefault = 'none' | 'mainAgent' | 'copilot' | 'unknown';

export interface ByokUtilitySettings {
	defaultMode: ByokUtilityModelDefault;
	utilityModelConfigured: boolean;
	utilitySmallModelConfigured: boolean;
}

/**
 * Read VS Code's host-owned BYOK utility settings without changing them.
 * Older VS Code versions do not expose `chat.byokUtilityModelDefault`; those
 * versions must remain silent rather than being treated as an opt-in to any
 * utility model.
 */
export function getByokUtilitySettings(resource?: vscode.Uri): ByokUtilitySettings {
	const config = vscode.workspace.getConfiguration('chat', resource);
	return {
		defaultMode: normalizeByokUtilityModelDefault(config.get<unknown>('byokUtilityModelDefault')),
		utilityModelConfigured: hasExplicitConfiguredModel(config, 'utilityModel'),
		utilitySmallModelConfigured: hasExplicitConfiguredModel(config, 'utilitySmallModel'),
	};
}

export function normalizeByokUtilityModelDefault(value: unknown): ByokUtilityModelDefault {
	if (value === 'none' || value === 'mainAgent' || value === 'copilot') {
		return value;
	}
	return 'unknown';
}

function hasExplicitConfiguredModel(config: vscode.WorkspaceConfiguration, key: string): boolean {
	const inspected = config.inspect<unknown>(key);
	return Boolean(
		inspected &&
		[inspected.globalValue, inspected.workspaceValue, inspected.workspaceFolderValue].some(
			(value) => hasConfiguredModel(value),
		),
	);
}

function hasConfiguredModel(value: unknown): boolean {
	return typeof value === 'string' && value.trim().length > 0;
}
