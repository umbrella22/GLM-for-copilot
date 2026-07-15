import vscode from 'vscode';
import type { AuthManager } from '../auth';
import { logger } from '../logger';
import { buildServerDefinitions, type BuiltServer } from './build';
import { MCP_PROVIDER_ID } from './consts';
import { readUserMcpServers } from './config';
import { mergeMcpServers, pickEnabledServers } from './merge';
import { resolveServerDefinition } from './resolve';

/**
 * VS Code MCP server definition provider.
 *
 * Registered via `lm.registerMcpServerDefinitionProvider` during extension
 * activation. Exposes GLM official (built-in) MCP servers plus any
 * user-defined ones from `glm-copilot.mcp.servers`.
 *
 * Two-method contract:
 *   - `provideMcpServerDefinitions`: called eagerly on every chat message
 *     submission. MUST be fast and non-interactive — no SecretStorage reads,
 *     no UI prompts. Returns the server list without secrets.
 *   - `resolveMcpServerDefinition`: called lazily when Copilot wants to use
 *     a tool from a specific server. MAY read secrets / prompt the user, and
 *     is where the API key is injected.
 */
export class GlmMcpServerProvider implements vscode.McpServerDefinitionProvider {
	private readonly authManager: AuthManager;
	private readonly onChangeEmitter = new vscode.EventEmitter<void>();

	/** Built server cache, keyed by definition reference for resolve lookup. */
	private builtByDefinition = new WeakMap<vscode.McpServerDefinition, BuiltServer>();

	readonly onDidChangeMcpServerDefinitions = this.onChangeEmitter.event;

	constructor(authManager: AuthManager) {
		this.authManager = authManager;
	}

	/**
	 * Fire the change event so VS Code re-queries `provideMcpServerDefinitions`.
	 * Called by the UI layer after add/remove/edit/reset operations.
	 */
	notifyChanged(): void {
		this.onChangeEmitter.fire();
	}

	/** @inheritdoc */
	async provideMcpServerDefinitions(
		_token: vscode.CancellationToken,
	): Promise<vscode.McpServerDefinition[]> {
		try {
			const userConfig = readUserMcpServers();
			const merged = mergeMcpServers(userConfig);
			const enabled = pickEnabledServers(merged);
			const built = buildServerDefinitions(enabled);

			// Index for O(1) lookup in resolveMcpServerDefinition.
			for (const item of built) {
				this.builtByDefinition.set(item.definition, item);
			}
			return built.map((item) => item.definition);
		} catch (error) {
			logger.error('Failed to provide MCP server definitions', error);
			return [];
		}
	}

	/** @inheritdoc */
	async resolveMcpServerDefinition(
		server: vscode.McpServerDefinition,
		token: vscode.CancellationToken,
	): Promise<vscode.McpServerDefinition | undefined> {
		const built = this.builtByDefinition.get(server);
		if (!built) {
			// Unknown definition — let VS Code start it as-is.
			return server;
		}
		try {
			return await resolveServerDefinition(built, this.authManager, token);
		} catch (error) {
			logger.error(`Failed to resolve MCP server "${built.id}"`, error);
			return undefined;
		}
	}
}

export { MCP_PROVIDER_ID };
