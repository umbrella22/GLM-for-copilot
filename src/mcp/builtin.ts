import {
	DEFAULT_AUTH_ENV_KEY,
	GLM_OFFICIAL_MCP_ENDPOINTS,
	GLM_OFFICIAL_MCP_STDIO,
} from './consts';
import type { McpServerConfig, McpServerConfigMap } from './types';

/**
 * Built-in GLM official MCP servers, shipped with the extension.
 *
 * These serve two purposes:
 *   1. Provide an out-of-the-box default set aligned with the official
 *      GLM Coding Plan, so users get search / web-reader / zread / vision
 *      tools without any configuration.
 *   2. Act as the "base layer" that user configuration is deep-merged onto
 *      (see `./merge`), so users can override individual fields (e.g. disable
 *      a server, point a URL at a proxy) without redefining the whole set.
 *
 * IDs are stable and must never change between versions — they are the join
 * key between built-in and user overrides.
 */
export const BUILTIN_MCP_SERVERS: Readonly<McpServerConfigMap> = {
	'zai-mcp-server': {
		type: 'stdio',
		label: 'ZAI MCP Server',
		detail: 'GLM 官方聚合 MCP，含视觉识别等能力 (Official GLM aggregated MCP, includes vision)',
		enabled: true,
		command: GLM_OFFICIAL_MCP_STDIO.command,
		args: [...GLM_OFFICIAL_MCP_STDIO.args],
		authEnvKey: DEFAULT_AUTH_ENV_KEY,
	},
	'web-search-prime': {
		type: 'http',
		label: 'Web Search Prime',
		detail: 'GLM 官方网页搜索 (Official GLM web search)',
		enabled: true,
		url: GLM_OFFICIAL_MCP_ENDPOINTS.webSearchPrime,
		authScheme: 'bearer',
	},
	'web-reader': {
		type: 'http',
		label: 'Web Reader',
		detail: 'GLM 官方网页内容抓取 (Official GLM web reader)',
		enabled: true,
		url: GLM_OFFICIAL_MCP_ENDPOINTS.webReader,
		authScheme: 'bearer',
	},
	zread: {
		type: 'http',
		label: 'Zread',
		detail: 'GLM 官方深度阅读 (Official GLM zread)',
		enabled: true,
		url: GLM_OFFICIAL_MCP_ENDPOINTS.zread,
		authScheme: 'bearer',
	},
};

/** IDs of all built-in servers. Used to distinguish user-defined servers. */
export const BUILTIN_MCP_IDS = new Set<string>(Object.keys(BUILTIN_MCP_SERVERS));

/** Returns true if `id` refers to a built-in server. */
export function isBuiltinMcpServer(id: string): boolean {
	return BUILTIN_MCP_IDS.has(id);
}
