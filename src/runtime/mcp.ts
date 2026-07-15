import vscode from 'vscode';
import { logger } from '../logger';
import { GlmMcpServerProvider, MCP_PROVIDER_ID } from '../mcp';
import type { AuthManager } from '../auth';

/**
 * Register the GLM MCP server definition provider.
 *
 * This is the MCP counterpart to `./provider.ts` (which registers the
 * language model chat provider). The two data flows are intentionally kept
 * in separate files so model-provider errors can never block MCP startup
 * and vice versa.
 *
 * Server management is done entirely through VS Code's native settings UI:
 *   - 4 built-in servers each have a boolean checkbox setting (enable/disable)
 *   - Advanced config (custom servers, URL overrides) is edited via the
 *     `glm-copilot.mcp.servers` object setting ("Edit in settings.json")
 * Reset is provided by VS Code's native per-setting gear menu.
 *
 * Failures are logged + shown to the user but never re-thrown, so a transient
 * MCP API change does not break model chat activation.
 *
 * @returns The provider instance (or `undefined` if registration failed).
 */
export function registerMcp(
	context: vscode.ExtensionContext,
	authManager: AuthManager,
): GlmMcpServerProvider | undefined {
	try {
		const provider = new GlmMcpServerProvider(authManager);

		context.subscriptions.push(
			// Register the MCP server definition provider. Must match the
			// `contributes.mcpServerDefinitionProviders` id in package.json.
			vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider),

			// Refresh on configuration changes:
			//   - glm-copilot.mcp.servers (advanced config: custom servers, overrides)
			//   - glm-copilot.mcp.<id>.enabled (built-in server checkboxes)
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration('glm-copilot.mcp.servers') ||
					e.affectsConfiguration('glm-copilot.mcp')
				) {
					provider.notifyChanged();
				}
			}),
		);

		logger.info(`MCP provider registered id=${MCP_PROVIDER_ID}`);
		return provider;
	} catch (error) {
		logger.error('Failed to register MCP provider', error);
		void vscode.window.showErrorMessage(
			'GLM MCP provider failed to activate. See logs for details.',
		);
		return undefined;
	}
}
