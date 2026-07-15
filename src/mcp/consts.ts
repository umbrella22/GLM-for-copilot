/**
 * Compile-time constants for the MCP module.
 *
 * No runtime settings reads here — those live in `./config`.
 */

/** Configuration section + key prefix shared with the rest of the extension. */
export const MCP_CONFIG_KEY = 'mcp.servers';

/**
 * Provider id registered via `lm.registerMcpServerDefinitionProvider`.
 * Must match the `contributes.mcpServerDefinitionProviders` entry in package.json.
 */
export const MCP_PROVIDER_ID = 'glm-copilot.mcp-servers';

/**
 * Boolean settings keys for the 4 built-in server enable/disable checkboxes.
 * Each renders as an independent checkbox in the VS Code settings UI
 * (@ext:ikaros.glm-for-vscode-copilot). Custom servers defined in
 * `glm-copilot.mcp.servers` do NOT have a checkbox — their `enabled` field
 * is read from the object directly.
 */
export const BUILTIN_MCP_ENABLED_KEYS = {
	'zai-mcp-server': 'mcp.zai-mcp-server.enabled',
	'web-search-prime': 'mcp.web-search-prime.enabled',
	'web-reader': 'mcp.web-reader.enabled',
	zread: 'mcp.zread.enabled',
} as const;

/** Default env variable name for GLM API key injection on stdio servers. */
export const DEFAULT_AUTH_ENV_KEY = 'Z_AI_API_KEY';

/** GLM official MCP HTTP endpoints. */
export const GLM_OFFICIAL_MCP_ENDPOINTS = {
	webSearchPrime: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
	webReader: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
	zread: 'https://open.bigmodel.cn/api/mcp/zread/mcp',
} as const;

/** GLM official stdio MCP server package. */
export const GLM_OFFICIAL_MCP_STDIO = {
	command: 'npx',
	args: ['-y', '@z_ai/mcp-server'],
} as const;
