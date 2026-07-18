import { BUILTIN_MCP_SERVERS, isBuiltinMcpServer } from './builtin';
import { readBuiltinServerEnabled } from './config';
import {
	createMcpServerMap,
	type McpServerConfig,
	type McpServerConfigMap,
	type RawUserMcpServerMap,
} from './types';

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
 * [FORK] Trust-reset on target-address override (PR #15 Finding 1):
 *   Built-in servers carry `injectApiKey: true` + `credentialChannel` because
 *   they are first-party GLM endpoints on open.bigmodel.cn. When a user
 *   changes the launch identity of a built-in id (`type`, `command`, `args`,
 *   `cwd`, or `env` for stdio; `type`, `url`, or `headers` for http), that trust no longer
 *   applies. In particular, `npx` is only a launcher and `args` selects the
 *   package that receives the injected environment. The inherited
 *   auth settings are CLEARED by default so the GLM API key is never sent
 *   to an address the user did not explicitly opt into. The key is injected
 *   again only when the override itself re-declares `injectApiKey: true`,
 *   which the user must write explicitly to express fresh consent.
 *
 * This function is pure except for reading VS Code settings (built-in
 * checkboxes). Used by `provideMcpServerDefinitions` to compute the live list.
 */
export function mergeMcpServers(userConfig: Readonly<RawUserMcpServerMap>): McpServerConfigMap {
	const merged = createMcpServerMap<McpServerConfig>();

	// 1. Built-in servers: field-level override + checkbox-driven enabled.
	for (const [id, builtin] of Object.entries(BUILTIN_MCP_SERVERS)) {
		const userOverride = userConfig[id];
		// Strip any `enabled` from the user override so the checkbox wins.
		const { enabled: _ignoredUserEnabled, ...userFields } = userOverride ?? {};
		const enabled = readBuiltinServerEnabled(id);
		const mergedConfig = applyBuiltinOverride(builtin, userFields);
		merged[id] = { ...mergedConfig, enabled };
	}

	// 2. User-defined servers: must be self-contained and valid. The sanitize
	// layer (config.ts) already guarantees completeness for non-built-in ids;
	// isValidStandaloneServer is a defensive re-check in case a caller bypasses
	// sanitize (e.g. programmatic merge).
	for (const [id, user] of Object.entries(userConfig)) {
		if (isBuiltinMcpServer(id)) {
			continue;
		}
		if (isValidStandaloneServer(user)) {
			merged[id] = { ...user } as McpServerConfig;
		}
	}

	return merged;
}

/**
 * Return only the enabled servers, suitable for handing to Copilot.
 */
export function pickEnabledServers(map: Readonly<McpServerConfigMap>): McpServerConfigMap {
	const result = createMcpServerMap<McpServerConfig>();
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
function isValidStandaloneServer(config: Partial<McpServerConfig>): boolean {
	if (!config.label) {
		return false;
	}
	if (config.type === 'stdio') {
		return typeof config.command === 'string' && config.command.trim().length > 0;
	}
	if (config.type === 'http') {
		return typeof config.url === 'string' && config.url.trim().length > 0;
	}
	return false;
}

/**
 * [FORK] Apply a field-level user override onto a built-in server config,
 * enforcing the trust-reset rule from PR #15 Finding 1.
 *
 * A server's launch identity determines WHERE credentials are sent. For an
 * HTTP server this is its transport type and URL. For stdio it is the complete
 * executable context: transport type, command, args, cwd, and env. `args`
 * cannot be treated as harmless parameters: `npx`, `node`, and similar
 * launchers use them to select the package or script that receives the API key.
 * `cwd`, `PATH`, and `NODE_OPTIONS` can likewise change the executed code.
 * When that identity changes, inherited first-party trust (`injectApiKey` and
 * the endpoint-specific `credentialChannel`) is cleared. Only an explicit
 * `injectApiKey: true` in the same override expresses fresh consent.
 *
 * Returns the merged config WITHOUT the `enabled` field — the caller sets
 * `enabled` from the checkbox.
 */
function applyBuiltinOverride(
	builtin: Readonly<McpServerConfig>,
	userFields: Partial<Omit<McpServerConfig, 'enabled'>>,
): Omit<McpServerConfig, 'enabled'> {
	const merged: Omit<McpServerConfig, 'enabled'> = { ...builtin, ...userFields };

	const targetChanged = launchIdentityChanged(builtin, userFields);

	if (targetChanged) {
		// Fresh explicit opt-in is required to keep credentials flowing to the
		// new target. `userFields.injectApiKey === true` is the only value that
		// preserves injection; anything else (undefined / false) clears it.
		if (userFields.injectApiKey !== true) {
			delete merged.injectApiKey;
		}
		// credentialChannel has no "safe" default once the target is no longer
		// the official GLM endpoint — clear it so resolveServerCredentialChannel
		// falls back to the workspace's default connection channel (which at
		// least follows the user's configured region instead of a pinned one).
		if (userFields.credentialChannel === undefined) {
			delete merged.credentialChannel;
		}
	}

	return merged;
}

function launchIdentityChanged(
	builtin: Readonly<McpServerConfig>,
	override: Partial<Omit<McpServerConfig, 'enabled'>>,
): boolean {
	if (Object.hasOwn(override, 'type') && override.type !== builtin.type) {
		return true;
	}
	if (
		Object.hasOwn(override, 'command') &&
		normalizeOptionalString(override.command) !== normalizeOptionalString(builtin.command)
	) {
		return true;
	}
	if (Object.hasOwn(override, 'args') && !sameStringArray(override.args, builtin.args)) {
		return true;
	}
	if (
		Object.hasOwn(override, 'cwd') &&
		normalizeOptionalString(override.cwd) !== normalizeOptionalString(builtin.cwd)
	) {
		return true;
	}
	if (Object.hasOwn(override, 'env') && !sameStringRecord(override.env, builtin.env)) {
		return true;
	}
	if (
		Object.hasOwn(override, 'url') &&
		normalizeOptionalString(override.url) !== normalizeOptionalString(builtin.url)
	) {
		return true;
	}
	return Object.hasOwn(override, 'headers') && !sameStringRecord(override.headers, builtin.headers);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}

function sameStringArray(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right || left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function sameStringRecord(
	left: Readonly<Record<string, string>> | undefined,
	right: Readonly<Record<string, string>> | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
	);
}
