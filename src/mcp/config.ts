import vscode from 'vscode';
import { CONFIG_SECTION } from '../consts';
import { BUILTIN_MCP_ENABLED_KEYS, MCP_CONFIG_KEY } from './consts';
import { isBuiltinMcpServer } from './builtin';
import { createMcpServerMap, type McpServerConfig, type RawUserMcpServerMap } from './types';
import type { CredentialChannel } from '../types';

/**
 * Read the raw user-facing MCP server configuration from settings.
 *
 * This setting is application-scoped, so only the explicit global value is a
 * user override. `get()` must not be used here: VS Code recursively merges
 * object defaults into effective values, which would make a manifest default
 * such as `injectApiKey: true` indistinguishable from fresh user consent.
 *
 * Returns an empty map when nothing is configured, never `undefined`, so
 * callers can safely iterate.
 *
 * [FORK] PR #15 Finding 3: two sanitize paths are now distinguished by id.
 * A built-in id may carry a PARTIAL override (only `url`, or only `env`,
 * etc.) — such entries are kept loose so field-level merge in `./merge` can
 * apply them onto the built-in base. A user-defined id must be a complete
 * standalone definition (type + label + command/url). Previously the single
 * sanitizer required type+label on every entry, silently dropping every
 * legitimate built-in partial override.
 */
export function readUserMcpServers(): RawUserMcpServerMap {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.inspect<unknown>(MCP_CONFIG_KEY)?.globalValue;
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
	servers: RawUserMcpServerMap,
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
 *
 * [FORK] PR #15 Finding 3: dispatch by id so built-in partial overrides
 * (e.g. only `{ "url": "..." }`) survive, while user-defined ids still must
 * carry a complete standalone definition.
 */
function sanitizeServerMap(input: unknown): RawUserMcpServerMap {
	const result = createMcpServerMap<Partial<McpServerConfig>>();
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return result;
	}
	for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
		if (!id || typeof id !== 'string') {
			continue;
		}
		const sanitized = isBuiltinMcpServer(id)
			? sanitizeBuiltinOverride(raw)
			: sanitizeStandaloneServer(raw);
		if (sanitized) {
			result[id] = sanitized;
		}
	}
	return result;
}

/**
 * [FORK] Sanitize a PARTIAL override for a built-in server id.
 *
 * Built-in servers ship a complete definition in code; the user only needs
 * to write the fields they want to override (e.g. just `url`, or just `env`).
 * So we do NOT require `type`/`label`/`command`/`url` here — whatever the
 * user wrote is validated field-by-field and the built-in base fills the
 * gaps at merge time. This fixes PR #15 Finding 3: previously the single
 * strict sanitizer dropped every partial built-in override that lacked
 * type+label, silently losing the user's `url`/`env`/`headers` edits.
 *
 * Returns `undefined` only when the input is not a non-empty object.
 */
function sanitizeBuiltinOverride(raw: unknown): Partial<McpServerConfig> | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const result: Partial<McpServerConfig> = {};

	// type: optional for an override, but if present must be valid.
	if (obj.type === 'stdio' || obj.type === 'http') {
		result.type = obj.type;
	}
	if (typeof obj.label === 'string' && obj.label.trim().length > 0) {
		result.label = obj.label;
	}
	if (typeof obj.detail === 'string') {
		result.detail = obj.detail;
	}
	if (typeof obj.enabled === 'boolean') {
		// Ignored at merge time (checkbox wins), but kept for round-trip fidelity.
		result.enabled = obj.enabled;
	}
	if (typeof obj.command === 'string' && obj.command.trim().length > 0) {
		result.command = obj.command;
	}
	if (Array.isArray(obj.args)) {
		result.args = obj.args.filter((a): a is string => typeof a === 'string');
	}
	if (typeof obj.cwd === 'string' && obj.cwd.trim().length > 0) {
		result.cwd = obj.cwd;
	}
	const env = sanitizeStringRecord(obj.env);
	if (env) {
		result.env = env;
	}
	if (typeof obj.url === 'string' && obj.url.trim().length > 0) {
		result.url = obj.url;
	}
	const headers = sanitizeStringRecord(obj.headers);
	if (headers) {
		result.headers = headers;
	}
	if (typeof obj.injectApiKey === 'boolean') {
		result.injectApiKey = obj.injectApiKey;
	}
	if (typeof obj.authEnvKey === 'string' && obj.authEnvKey.trim().length > 0) {
		result.authEnvKey = obj.authEnvKey;
	}
	if (isCredentialChannel(obj.credentialChannel)) {
		result.credentialChannel = obj.credentialChannel;
	}
	return result;
}

/**
 * [FORK] Sanitize a COMPLETE standalone (user-defined) server definition.
 *
 * Requires `type` + `label` (+ `command` for stdio, + `url` for http) so the
 * entry is self-sufficient — it has no built-in base to inherit from.
 * Returns `undefined` when mandatory fields are missing, so invalid entries
 * are dropped with a clear contract (build layer never sees them).
 */
function sanitizeStandaloneServer(raw: unknown): McpServerConfig | undefined {
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
		// [FORK] PR #15 F3: stdio requires a non-blank command (no launch target
		// otherwise). Return undefined so the invalid entry is dropped with a
		// clear contract instead of building an unusable definition.
		if (typeof obj.command !== 'string' || !obj.command.trim()) {
			return undefined;
		}
		config.command = obj.command;
		if (Array.isArray(obj.args)) {
			config.args = obj.args.filter((a): a is string => typeof a === 'string');
		}
		if (typeof obj.authEnvKey === 'string' && obj.authEnvKey.trim()) {
			config.authEnvKey = obj.authEnvKey;
		}
		// [FORK] PR #15 F3: forward cwd/env that VS Code's stdio definition
		// actually supports, instead of silently dropping them.
		if (typeof obj.cwd === 'string' && obj.cwd.trim()) {
			config.cwd = obj.cwd;
		}
		const env = sanitizeStringRecord(obj.env);
		if (env) {
			config.env = env;
		}
	} else {
		// [FORK] PR #15 F3: http requires a non-blank url (no endpoint otherwise).
		if (typeof obj.url !== 'string' || !obj.url.trim()) {
			return undefined;
		}
		config.url = obj.url;
		// [FORK] PR #15 F3: forward headers that VS Code's http definition
		// actually supports, instead of silently dropping them.
		const headers = sanitizeStringRecord(obj.headers);
		if (headers) {
			config.headers = headers;
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

/**
 * [FORK] Coerce an unknown value into a `Record<string, string>` or return
 * `undefined` when it is not a non-empty object of string-valued entries.
 * Used for stdio `env` and http `headers` — both must be flat string maps,
 * never nested objects or non-string values.
 */
function sanitizeStringRecord(raw: unknown): Record<string, string> | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const result = Object.create(null) as Record<string, string>;
	for (const [key, value] of Object.entries(obj)) {
		if (typeof key === 'string' && typeof value === 'string') {
			result[key] = value;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
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
	// them with the application-level settings checkboxes. This avoids sending
	// BYOK keys to MCP services without
	// explicit consent on install/upgrade.
	const value = config.get<boolean>(settingKey, false);
	return value;
}
