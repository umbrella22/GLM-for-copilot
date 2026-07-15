/**
 * Shared types for the MCP (Model Context Protocol) server provider module.
 *
 * These types describe the user-facing configuration shape stored under
 * `glm-copilot.mcp.servers`. The actual VS Code runtime definitions
 * (`McpStdioServerDefinition` / `McpHttpServerDefinition`) are built from
 * these by `./build`.
 */

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

	/** Human-readable display label shown in the model picker and panels. */
	label: string;

	/** Short description of what this server provides (tools / resources). */
	detail?: string;

	/** Whether this server is exposed to Copilot. Defaults to `true`. */
	enabled?: boolean;

	// ---- stdio-only fields ----

	/** Command to launch the local MCP server process. stdio only. */
	command?: string;

	/** Command-line arguments for `command`. stdio only. */
	args?: string[];

	// ---- http-only fields ----

	/** HTTP endpoint URI of the remote MCP server. http only. */
	url?: string;

	// ---- auth injection hints ----

	/**
	 * For stdio servers: the env variable name into which the GLM API key
	 * should be injected at resolve time. Defaults to `Z_AI_API_KEY`.
	 */
	authEnvKey?: string;

	/**
	 * For http servers: when `authScheme` is `bearer`, the key is injected as
	 * `Authorization: Bearer <key>` into the request headers.
	 * Set to `none` to disable key injection (e.g. for public servers).
	 */
	authScheme?: 'bearer' | 'none';
}

/** Map of server id → config, matching the `glm-copilot.mcp.servers` object shape. */
export type McpServerConfigMap = Record<string, McpServerConfig>;
