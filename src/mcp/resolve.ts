import vscode from 'vscode';
import type { AuthManager } from '../auth';
import { logger } from '../logger';
import { resolveAuthEnvKey, wantsApiKeyInjection } from './build';
import type { BuiltServer } from './build';

/**
 * Inject the GLM API key into a server definition before VS Code starts it.
 *
 * Called by VS Code lazily — only when Copilot actually wants to invoke a
 * tool from this server. At this point interactive work (reading from
 * SecretStorage, prompting the user) is allowed, unlike
 * `provideMcpServerDefinitions`.
 *
 * Injection rules:
 *   - stdio: write the key into `env[<authEnvKey>]` (default `Z_AI_API_KEY`).
 *   - http:  write `Authorization: Bearer <key>` into headers (unless
 *            `authScheme === 'none'`).
 *
 * Returns `undefined` to tell VS Code "don't start this server" when no key
 * is available — this is the API contract for skipping a server at resolve
 * time. The user will see a friendly error in the chat instead of a silent
 * failure.
 */
export async function resolveServerDefinition(
	built: BuiltServer,
	authManager: AuthManager,
	token: vscode.CancellationToken,
): Promise<vscode.McpServerDefinition | undefined> {
	const { definition, config } = built;

	if (!wantsApiKeyInjection(config)) {
		// Public server (authScheme === 'none'): nothing to inject.
		return definition;
	}

	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		logger.warn(
			`MCP server "${built.id}" requires an API key but none is configured; skipping start.`,
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
