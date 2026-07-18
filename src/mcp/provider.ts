import vscode from 'vscode';
import type { AuthManager } from '../auth';
import { logger } from '../logger';
import { buildServerDefinitions, type BuiltServer } from './build';
import { MCP_PROVIDER_ID } from './consts';
import { readUserMcpServers } from './config';
import { mergeMcpServers, pickEnabledServers } from './merge';
import { resolveServerDefinition } from './resolve';
import { getActiveWorkspaceFolderResource } from '../workspace';

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

	/**
	 * Built server cache, keyed by definition LABEL (a stable string) for
	 * resolve lookup.
	 *
	 * [FORK] Previously keyed by the definition object reference via WeakMap.
	 * That is fragile: if VS Code ever passes back a different object instance
	 * at resolve time (e.g. after serializing the definition across a process
	 * boundary, or internally cloning it), the WeakMap lookup silently misses
	 * and the server starts WITHOUT credential injection — built-in GLM MCP
	 * servers then fail at tool-call time with missing-key errors that are
	 * hard to diagnose. Using the label string as the join key makes lookup
	 * immune to object identity changes, because `buildServerDefinitions`
	 * already guarantees label uniqueness within a collection (collisions are
	 * disambiguated by appending the stable config id).
	 */
	private readonly builtByLabel = new Map<string, BuiltServer>();

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

			// Rebuild the label -> built index each time provide is called, so
			// stale entries from a previous config (e.g. a removed server) do
			// not leak. Labels are unique within a collection by construction.
			this.builtByLabel.clear();
			for (const item of built) {
				this.builtByLabel.set(item.definition.label, item);
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
		const built = this.builtByLabel.get(server.label);
		if (!built) {
			// Unknown label — let VS Code start it as-is.
			return server;
		}
		try {
			// [FORK] The MCP resolve API does not pass a resource, so use the
			// active workspace folder. This lets multi-root setups resolve the
			// right credential channel per server (see resolveServerDefinition).
			const resource = getActiveWorkspaceFolderResource();
			return await resolveServerDefinition(built, this.authManager, token, resource);
		} catch (error) {
			logger.error(`Failed to resolve MCP server "${built.id}"`, error);
			return undefined;
		}
	}
}

export { MCP_PROVIDER_ID };
