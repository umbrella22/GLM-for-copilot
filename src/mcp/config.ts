import vscode from 'vscode';
import { CONFIG_SECTION } from '../consts';
import { BUILTIN_MCP_ENABLED_KEYS, MCP_CONFIG_KEY } from './consts';
import type { McpServerConfig, McpServerConfigMap } from './types';
import type { CredentialChannel } from '../types';

/**
 * Read the raw user-facing MCP server configuration from settings.
 *
 * VS Code's object-type configuration uses *whole-value override* semantics:
 * if the user sets `glm-copilot.mcp.servers`, their value replaces the
 * `default` entirely — there is no automatic deep merge. Callers that need
 * the merged view (built-in + user overrides) should use `./merge` instead.
 *
 * Returns an empty map when nothing is configured, never `undefined`, so
 * callers can safely iterate.
 */
export function readUserMcpServers(): McpServerConfigMap {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<Record<string, unknown>>(MCP_CONFIG_KEY, {});
	return sanitizeServerMap(value);
}

/**
 * Write the full MCP server map back to settings.
 *
 * Used by the graphical add/remove/edit flows. Because VS Code stores the
 * object as a single value, every mutation must:
 *   1. read the current merged view (built-in + user),
 *   2. apply the change,
 *   3. write the *user-overridable* portion back.
 *
 * Built-in servers are NOT persisted unless the user actually customized them,
 * so that built-in updates in future extension versions still take effect.
 *
 * @param servers The complete user-overridable server map to persist.
 * @param target  Settings scope to write to.
 */
export async function writeUserMcpServers(
	servers: McpServerConfigMap,
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	await config.update(MCP_CONFIG_KEY, servers, target);
}

/**
 * Reset MCP server configuration to defaults.
 *
 * Passing `undefined` clears the user value at the given scope, which makes
 * VS Code fall back to the `default` declared in package.json (empty map),
 * effectively reverting to "built-in only".
 */
export async function resetUserMcpServers(
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	await config.update(MCP_CONFIG_KEY, undefined, target);
}

/**
 * Defensive sanitizer. Users can paste arbitrary JSON into settings.json, so
 * every field must be validated before it reaches the provider/build layer.
 */
function sanitizeServerMap(input: Record<string, unknown>): McpServerConfigMap {
	const result: McpServerConfigMap = {};
	for (const [id, raw] of Object.entries(input)) {
		if (!id || typeof id !== 'string') {
			continue;
		}
		const sanitized = sanitizeServerConfig(raw);
		if (sanitized) {
			result[id] = sanitized;
		}
	}
	return result;
}

function sanitizeServerConfig(raw: unknown): McpServerConfig | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const type = obj.type === 'stdio' ? 'stdio' : obj.type === 'http' ? 'http' : undefined;
	if (!type) {
		return undefined;
	}
	const label = typeof obj.label === 'string' ? obj.label : undefined;
	if (!label) {
		// Without a label the server cannot be displayed; reject it.
		return undefined;
	}
	const config: McpServerConfig = { type, label };

	if (typeof obj.detail === 'string') {
		config.detail = obj.detail;
	}
	if (typeof obj.enabled === 'boolean') {
		config.enabled = obj.enabled;
	}
	if (type === 'stdio') {
		if (typeof obj.command === 'string' && obj.command.trim()) {
			config.command = obj.command;
		}
		if (Array.isArray(obj.args)) {
			config.args = obj.args.filter((a): a is string => typeof a === 'string');
		}
		if (typeof obj.authEnvKey === 'string' && obj.authEnvKey.trim()) {
			config.authEnvKey = obj.authEnvKey;
		}
	} else {
		if (typeof obj.url === 'string' && obj.url.trim()) {
			config.url = obj.url;
		}
	}
	// [FORK] Shared auth-injection fields apply to both stdio and http.
	if (typeof obj.injectApiKey === 'boolean') {
		config.injectApiKey = obj.injectApiKey;
	}
	if (isCredentialChannel(obj.credentialChannel)) {
		config.credentialChannel = obj.credentialChannel;
	}
	return config;
}

/** [FORK] Type guard for the four supported credential channels. */
function isCredentialChannel(value: unknown): value is CredentialChannel {
	return (
		value === 'china-coding' ||
		value === 'china-standard' ||
		value === 'international-coding' ||
		value === 'international-standard'
	);
}

/**
 * Read the enable/disable checkbox value for a built-in server.
 *
 * Built-in servers have dedicated boolean settings (`glm-copilot.mcp.<id>.enabled`)
 * so VS Code renders a native checkbox in the settings UI. This is the
 * AUTHORITATIVE source of enabled state for built-in servers — the `enabled`
 * field inside `glm-copilot.mcp.servers` is IGNORED for built-in ids to
 * avoid two conflicting sources of truth.
 *
 * @param id A built-in server id (must be one of BUILTIN_MCP_ENABLED_KEYS).
 * @returns `false` by default when unset (built-in servers are opt-in),
 *          otherwise the configured value.
 */
export function readBuiltinServerEnabled(id: string): boolean {
	const settingKey = BUILTIN_MCP_ENABLED_KEYS[id as keyof typeof BUILTIN_MCP_ENABLED_KEYS];
	if (!settingKey) {
		// Not a built-in id — caller should check the object config instead.
		return true;
	}
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	// [FORK] Default to false: built-in MCP servers are opt-in. Users enable
	// them via "GLM: Apply Recommended Setup for Coding Plan" or the settings
	// checkboxes. This avoids sending BYOK keys to MCP services without
	// explicit consent on install/upgrade.
	const value = config.get<boolean>(settingKey, false);
	return value;
}
