import type { GLMMessage, GLMTool } from '../../types';

export const TOOL_SEARCH_NAME = 'glm_search_tools';
export const MAX_TOOL_DISCOVERY_ROUNDS = 4;
export const DEFAULT_TOOL_SEARCH_LIMIT = 10;
export const MAX_TOOL_SEARCH_LIMIT = 20;
const MAX_SEARCH_DESCRIPTION_CHARS = 300;

export interface ToolDiscoverySettings {
	enabled: boolean;
	maxTools: number;
}

export interface ToolCatalogEntry {
	name: string;
	description: string;
}

export interface ToolSearchRequest {
	query: string;
	offset: number;
	limit: number;
}

export interface ToolSearchResult {
	query: string;
	offset: number;
	limit: number;
	total: number;
	hasMore: boolean;
	tools: ToolCatalogEntry[];
}

/** Synthetic search tool injected only when discovery mode is active. */
export function createToolSearchTool(): GLMTool {
	return {
		type: 'function',
		function: {
			name: TOOL_SEARCH_NAME,
			description:
				'Search the hidden tool catalog. Some tools are not listed in this request to keep it small; call this function with short keywords to discover them. Matching tools become available in the next model round.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description:
							'Short keywords describing the tool or capability you need (for example "database schema" or "screenshot").',
					},
					offset: {
						type: 'number',
						description: 'Zero-based result offset for paging through matches.',
					},
					limit: {
						type: 'number',
						description: `Maximum results to return (1-${MAX_TOOL_SEARCH_LIMIT}, default ${DEFAULT_TOOL_SEARCH_LIMIT}).`,
					},
				},
				required: ['query'],
				additionalProperties: false,
			},
		},
	};
}

export function createToolDiscoveryInstruction(maxTools: number): string {
	return (
		'[Tool discovery]\n' +
		`At most ${maxTools} tool schemas are sent in one request, so some available tools may be hidden.\n` +
		`If you need a tool that is not listed, call \`${TOOL_SEARCH_NAME}\` with short keywords. ` +
		'Matching tools become available to you in the next model round.\n' +
		'Do not guess hidden tool names; search first.'
	);
}

export function shouldEnableToolDiscovery(
	settings: ToolDiscoverySettings,
	tools: readonly GLMTool[] | undefined,
): boolean {
	if (!settings.enabled || !tools || tools.length <= settings.maxTools) {
		return false;
	}
	// Never shadow a real host tool with the synthetic search function.
	return !tools.some((tool) => tool.function.name === TOOL_SEARCH_NAME);
}

export function collectCatalog(tools: readonly GLMTool[] | undefined): ToolCatalogEntry[] {
	return (tools ?? [])
		.filter((tool) => tool.function.name !== TOOL_SEARCH_NAME)
		.map((tool) => ({
			name: tool.function.name,
			description: tool.function.description?.trim() ?? '',
		}));
}

/** Collect tool names from the conversation, newest first. */
export function collectRecentToolNames(messages: readonly GLMMessage[]): Set<string> {
	const names = new Set<string>();
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const calls = messages[index].tool_calls ?? [];
		for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
			const name = calls[callIndex].function.name;
			if (name && name !== TOOL_SEARCH_NAME) {
				names.add(name);
			}
		}
	}
	return names;
}

/**
 * Select the tool schemas sent with a discovery request: activated tools,
 * then recently used tools, then catalog order up to the budget. The synthetic
 * search tool always occupies one slot.
 */
export function selectDiscoveryTools(
	tools: readonly GLMTool[],
	recent: ReadonlySet<string>,
	activated: ReadonlySet<string>,
	maxTools: number,
): GLMTool[] {
	const hostBudget = Math.max(0, maxTools - 1);
	const candidates = tools.filter((tool) => tool.function.name !== TOOL_SEARCH_NAME);
	const available = new Set(candidates.map((tool) => tool.function.name));
	const selected = new Set<string>();

	for (const name of activated) {
		if (selected.size >= hostBudget) {
			break;
		}
		if (available.has(name)) {
			selected.add(name);
		}
	}
	for (const name of recent) {
		if (selected.size >= hostBudget) {
			break;
		}
		if (available.has(name)) {
			selected.add(name);
		}
	}
	for (const tool of candidates) {
		if (selected.size >= hostBudget) {
			break;
		}
		selected.add(tool.function.name);
	}

	return [createToolSearchTool(), ...candidates.filter((tool) => selected.has(tool.function.name))];
}

/** Move newly discovered tools to the end of the LRU and evict old entries. */
export function activateToolNames(
	activated: Set<string>,
	names: readonly string[],
	budget: number,
): void {
	for (const name of names) {
		if (!name || name === TOOL_SEARCH_NAME) {
			continue;
		}
		activated.delete(name);
		activated.add(name);
	}
	while (activated.size > Math.max(0, budget)) {
		const oldest = activated.values().next().value;
		if (oldest === undefined) {
			break;
		}
		activated.delete(oldest);
	}
}

export function parseToolSearchArguments(input: unknown): ToolSearchRequest {
	const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
	return {
		query: typeof record.query === 'string' ? record.query.trim() : '',
		offset: normalizeInteger(record.offset, 0, 0, Number.MAX_SAFE_INTEGER),
		limit: normalizeInteger(record.limit, DEFAULT_TOOL_SEARCH_LIMIT, 1, MAX_TOOL_SEARCH_LIMIT),
	};
}

export function searchToolCatalog(
	catalog: readonly ToolCatalogEntry[],
	request: ToolSearchRequest,
): ToolSearchResult {
	const query = request.query.toLowerCase();
	const matches = query
		? catalog
				.map((entry) => ({ entry, score: scoreEntry(entry, query) }))
				.filter((match) => match.score > 0)
				.sort(
					(left, right) =>
						right.score - left.score || left.entry.name.localeCompare(right.entry.name),
				)
				.map((match) => match.entry)
		: [...catalog];
	const page = matches.slice(request.offset, request.offset + request.limit);
	return {
		query: request.query,
		offset: request.offset,
		limit: request.limit,
		total: matches.length,
		hasMore: request.offset + request.limit < matches.length,
		tools: page,
	};
}

export function formatToolSearchResult(result: ToolSearchResult): string {
	return JSON.stringify({
		query: result.query,
		offset: result.offset,
		limit: result.limit,
		total: result.total,
		hasMore: result.hasMore,
		tools: result.tools.map((tool) => ({
			name: tool.name,
			description: truncate(tool.description, MAX_SEARCH_DESCRIPTION_CHARS),
		})),
		note:
			result.total > 0
				? 'Matching tools are available in the next model round.'
				: 'No matching tools. Try different keywords or leave the query empty to browse the catalog.',
	});
}

function scoreEntry(entry: ToolCatalogEntry, query: string): number {
	const name = entry.name.toLowerCase();
	const description = entry.description.toLowerCase();
	const tokens = query.split(/\s+/).filter((token) => token.length > 0);
	let score = 0;
	if (name === query) {
		score += 1000;
	}
	if (name.startsWith(query)) {
		score += 500;
	}
	if (name.includes(query)) {
		score += 200;
	}
	if (description.includes(query)) {
		score += 100;
	}
	for (const token of tokens) {
		if (name.includes(token)) {
			score += 40;
		}
		if (description.includes(token)) {
			score += 10;
		}
	}
	return score;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncate(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}
