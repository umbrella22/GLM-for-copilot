import { BUILTIN_MCP_SERVERS, isBuiltinMcpServer } from './builtin';
import { readBuiltinServerEnabled } from './config';
import type { McpServerConfig, McpServerConfigMap } from './types';

/**
 * Deep-merge the built-in server map with user overrides, and resolve the
 * authoritative `enabled` state per server.
 *
 * Enabled-state rules (two sources, deliberately split to match the UI):
 *   - Built-in server: authoritative source is the dedicated boolean setting
 *     `glm-copilot.mcp.<id>.enabled` (native checkbox in VS Code settings UI).
 *     The `enabled` field inside `glm-copilot.mcp.servers` is IGNORED for
 *     built-in ids to avoid conflicting controls.
 *   - User-defined server (id not built-in): authoritative source is the
 *     `enabled` field inside its `glm-copilot.mcp.servers[id]` object,
 *     because custom servers have no dedicated checkbox.
 *
 * Field-level merge (regardless of enabled source):
 *   - Built-in server: user's non-enabled fields override the built-in fields
 *     one by one. Missing fields keep their built-in value.
 *   - User-defined server: used as-is (must satisfy minimal validity).
 *
 * This function is pure except for reading VS Code settings (built-in
 * checkboxes). Used by `provideMcpServerDefinitions` to compute the live list.
 */
export function mergeMcpServers(
	userConfig: Readonly<McpServerConfigMap>,
): McpServerConfigMap {
	const merged: McpServerConfigMap = {};

	// 1. Built-in servers: field-level override + checkbox-driven enabled.
	for (const [id, builtin] of Object.entries(BUILTIN_MCP_SERVERS)) {
		const userOverride = userConfig[id];
		// Strip any `enabled` from the user override so the checkbox wins.
		const { enabled: _ignoredUserEnabled, ...userFields } = userOverride ?? {};
		const enabled = readBuiltinServerEnabled(id);
		merged[id] = { ...(userOverride ? { ...builtin, ...userFields } : { ...builtin }), enabled };
	}

	// 2. User-defined servers: must be self-contained and valid.
	for (const [id, user] of Object.entries(userConfig)) {
		if (isBuiltinMcpServer(id)) {
			continue;
		}
		if (isValidStandaloneServer(user)) {
			merged[id] = { ...user };
		}
	}

	return merged;
}

/**
 * Return only the enabled servers, suitable for handing to Copilot.
 */
export function pickEnabledServers(map: Readonly<McpServerConfigMap>): McpServerConfigMap {
	const result: McpServerConfigMap = {};
	for (const [id, config] of Object.entries(map)) {
		if (config.enabled !== false) {
			result[id] = config;
		}
	}
	return result;
}

/**
 * Minimal validity check for a standalone (user-defined) server config.
 * Built-in servers are always considered valid because they ship from code.
 */
function isValidStandaloneServer(config: McpServerConfig): boolean {
	if (!config.label) {
		return false;
	}
	if (config.type === 'stdio') {
		return typeof config.command === 'string' && config.command.trim().length > 0;
	}
	return typeof config.url === 'string' && config.url.trim().length > 0;
}
