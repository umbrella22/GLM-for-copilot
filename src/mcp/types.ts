/**
 * Shared types for the MCP (Model Context Protocol) server provider module.
 *
 * These types describe the user-facing configuration shape stored under
 * `glm-copilot.mcp.servers`. The actual VS Code runtime definitions
 * (`McpStdioServerDefinition` / `McpHttpServerDefinition`) are built from
 * these by `./build`.
 */

import type { CredentialChannel } from '../types';

/** MCP server transport type, mirroring the official `mcp.json` schema. */
export type McpServerType = 'stdio' | 'http';

/**
 * A single MCP server as configured by the user (or built-in).
 *
 * The shape intentionally matches VS Code's `.vscode/mcp.json` format so that
 * users can copy official GLM documentation examples verbatim.
 *
 * NOTE: This type never contains raw API keys. Keys are injected at runtime
 * by `./resolve` from the shared AuthManager, so secrets stay in
 * SecretStorage and never reach settings.json.
 */
export interface McpServerConfig {
	/** Transport type. */
	type: McpServerType;

	/**
	 * Human-readable display label shown in the model picker and panels.
	 *
	 * REQUIRED for user-defined (standalone) servers. Optional for built-in
	 * overrides — when omitted, the built-in label is kept (field-level merge).
	 */
	label?: string;

	/** Short description of what this server provides (tools / resources). */
	detail?: string;

	/** Whether this server is exposed to Copilot. Defaults to `true`. */
	enabled?: boolean;

	// ---- stdio-only fields ----

	/** Command to launch the local MCP server process. stdio only. */
	command?: string;

	/** Command-line arguments for `command`. stdio only. */
	args?: string[];

	/**
	 * Working directory to launch the stdio process in. stdio only.
	 * [FORK] PR #15 Finding 3: previously dropped by sanitizeServerConfig;
	 * now forwarded to the VS Code McpStdioServerDefinition.
	 */
	cwd?: string;

	/**
	 * Environment variables for the stdio process (excluding injected auth
	 * keys, which are merged in at resolve time). stdio only.
	 * [FORK] PR #15 Finding 3: previously dropped by sanitizeServerConfig;
	 * now forwarded to the VS Code McpStdioServerDefinition.
	 */
	env?: Record<string, string>;

	// ---- http-only fields ----

	/** HTTP endpoint URI of the remote MCP server. http only. */
	url?: string;

	/**
	 * Extra request headers for the http server (excluding the injected
	 * Authorization header, which is merged in at resolve time). http only.
	 * [FORK] PR #15 Finding 3: previously dropped by sanitizeServerConfig;
	 * now forwarded to the VS Code McpHttpServerDefinition.
	 */
	headers?: Record<string, string>;

	// ---- auth injection hints ----

	/**
	 * [FORK] Whether to inject the GLM API key into this server at resolve time.
	 *
	 * This is an explicit opt-in field: defaults to `false` (NO key injection)
	 * so user-defined servers never silently receive BYOK credentials. Built-in
	 * GLM official servers set this to `true` because they are first-party.
	 *
	 * For stdio servers, when `true`, the key is written into
	 * `env[<authEnvKey>]` (defaults to `Z_AI_API_KEY`).
	 * For http servers, when `true`, the key is written as
	 * `Authorization: Bearer <key>` into the request headers.
	 */
	injectApiKey?: boolean;

	/**
	 * For stdio servers: the env variable name into which the GLM API key
	 * should be injected at resolve time. Defaults to `Z_AI_API_KEY`.
	 * Third-party / international MCP services may read a different variable
	 * name (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); set this accordingly.
	 */
	authEnvKey?: string;

	/**
	 * [FORK] Which credential channel the API key should be read from.
	 *
	 * Built-in GLM official servers pin this to `'china-coding'` because their
	 * endpoints are hosted on open.bigmodel.cn. User-defined servers that omit
	 * this field fall back to the workspace's default connection channel, so
	 * international users can use their own configured channel automatically.
	 */
	credentialChannel?: CredentialChannel;
}

/** Map of server id → config, matching the `glm-copilot.mcp.servers` object shape. */
export type McpServerConfigMap = Record<string, McpServerConfig>;

/**
 * [FORK] PR #15 Finding 3: a user-provided entry in `glm-copilot.mcp.servers`
 * can be EITHER a complete standalone server definition (for a user-defined
 * id) OR a partial override (for a built-in id, e.g. just `{ "url": "..." }`).
 * `Partial<McpServerConfig>` captures both — standalone entries are a
 * superset of the partial shape. The merge layer fills gaps for built-in ids.
 */
export type RawUserMcpServerMap = Record<string, Partial<McpServerConfig>>;

/** Create an arbitrary-server-id dictionary without the legacy `__proto__` setter. */
export function createMcpServerMap<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}
