import vscode from 'vscode';
import type { AuthManager } from '../auth';
import { resolveDefaultConnection } from '../config';
import { logger } from '../logger';
import { resolveAuthEnvKey, wantsApiKeyInjection } from './build';
import type { BuiltServer } from './build';
import type { McpServerConfig } from './types';
import type { CredentialChannel } from '../types';

/**
 * Inject the GLM API key into a server definition before VS Code starts it.
 *
 * Called by VS Code lazily — only when Copilot actually wants to invoke a
 * tool from this server. At this point interactive work (reading from
 * SecretStorage, prompting the user) is allowed, unlike
 * `provideMcpServerDefinitions`.
 *
 * Injection rules ([FORK] opt-in via `injectApiKey: true`):
 *   - stdio: write the key into `env[<authEnvKey>]` (default `Z_AI_API_KEY`).
 *   - http:  write `Authorization: Bearer <key>` into headers.
 *
 * Returns `undefined` to tell VS Code "don't start this server" when no key
 * is available — this is the API contract for skipping a server at resolve
 * time. The user will see a friendly error in the chat instead of a silent
 * failure.
 *
 * Credential channel: resolved per server. Built-in GLM servers pin
 * `china-coding`; user-defined servers without an explicit channel fall back
 * to the workspace's default connection channel, so international users can
 * use their configured channel automatically.
 */
export async function resolveServerDefinition(
	built: BuiltServer,
	authManager: AuthManager,
	token: vscode.CancellationToken,
	resource?: vscode.Uri,
): Promise<vscode.McpServerDefinition | undefined> {
	const { definition, config } = built;

	if (!wantsApiKeyInjection(config)) {
		// Server did not opt in (injectApiKey !== true): no credential flow.
		return definition;
	}

	// [FORK] Resolve the credential channel per server. Built-in GLM official
	// servers pin 'china-coding' (their endpoints are on open.bigmodel.cn);
	// user-defined servers without an explicit channel fall back to the
	// workspace's default connection channel so international users are
	// supported automatically. `resource` makes workspace-scoped credentials
	// resolve correctly in multi-root setups.
	const channel = resolveServerCredentialChannel(config, resource);
	const apiKey = await authManager.getApiKey(channel, resource);
	if (!apiKey) {
		logger.warn(
			`MCP server "${built.id}" requires an API key but none is configured for channel "${channel}"; skipping start.`,
		);
		return undefined;
	}

	if (definition instanceof vscode.McpStdioServerDefinition) {
		const envKey = resolveAuthEnvKey(config);
		// `env` is mutable on the definition; preserve any user-provided env.
		definition.env = { ...definition.env, [envKey]: apiKey };
		return definition;
	}

	if (definition instanceof vscode.McpHttpServerDefinition) {
		definition.headers = {
			...definition.headers,
			Authorization: `Bearer ${apiKey}`,
		};
		return definition;
	}

	return definition;
}

/**
 * [FORK] Resolve which credential channel an MCP server's API key should be
 * read from.
 *
 * Resolution order:
 *   1. `config.credentialChannel` — explicit per-server pin (built-in GLM
 *      official servers use this to pin `china-coding`).
 *   2. The workspace's default connection channel — so user-defined servers
 *      automatically follow the user's configured region (international users
 *      get their international key without extra config).
 *
 * `resource` is forwarded to `resolveDefaultConnection` so multi-root
 * workspace folders resolve their own default channel correctly.
 */
export function resolveServerCredentialChannel(
	config: McpServerConfig,
	resource?: vscode.Uri,
): CredentialChannel {
	return config.credentialChannel ?? resolveDefaultConnection(resource).credentialChannel;
}
