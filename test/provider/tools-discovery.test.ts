import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { runToolDiscoveryRounds } from '../../src/provider/tool-discovery-stream';
import {
	activateToolNames,
	collectRecentToolNames,
	formatToolSearchResult,
	parseToolSearchArguments,
	searchToolCatalog,
	selectDiscoveryTools,
	shouldEnableToolDiscovery,
	TOOL_SEARCH_NAME,
	type ToolCatalogEntry,
} from '../../src/provider/tools/discovery';
import type { GLMMessage, GLMTool } from '../../src/types';

function tool(name: string, description: string): GLMTool {
	return {
		type: 'function',
		function: { name, description, parameters: { type: 'object', properties: {} } },
	};
}

function catalogEntry(name: string, description: string): ToolCatalogEntry {
	return { name, description };
}

function usagePart(prompt: number, completion: number): vscode.LanguageModelDataPart {
	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(
			JSON.stringify({
				prompt_tokens: prompt,
				completion_tokens: completion,
				total_tokens: prompt + completion,
				prompt_tokens_details: { cached_tokens: 0 },
			}),
		),
		'usage',
	);
}

describe('tool discovery planning', () => {
	it('enables only for oversized catalogs without a name collision', () => {
		const settings = { enabled: true, maxTools: 4 };
		expect(
			shouldEnableToolDiscovery({ ...settings, enabled: false }, [
				tool('a', ''),
				tool('b', ''),
				tool('c', ''),
				tool('d', ''),
				tool('e', ''),
			]),
		).toBe(false);
		expect(shouldEnableToolDiscovery(settings, [tool('a', ''), tool('b', '')])).toBe(false);
		expect(
			shouldEnableToolDiscovery(settings, [
				tool(TOOL_SEARCH_NAME, ''),
				tool('a', ''),
				tool('b', ''),
				tool('c', ''),
				tool('d', ''),
			]),
		).toBe(false);
		expect(
			shouldEnableToolDiscovery(settings, [
				tool('a', ''),
				tool('b', ''),
				tool('c', ''),
				tool('d', ''),
				tool('e', ''),
			]),
		).toBe(true);
	});

	it('selects activated, recent, then catalog-order tools under the budget', () => {
		const tools = ['t1', 't2', 't3', 't4', 't5', 't6'].map((name) => tool(name, ''));
		const selected = selectDiscoveryTools(tools, new Set(['t5', 't4']), new Set(['t6']), 4);

		expect(selected.map((item) => item.function.name)).toEqual([
			TOOL_SEARCH_NAME,
			't4',
			't5',
			't6',
		]);
	});

	it('evicts the oldest activated tools', () => {
		const activated = new Set(['a', 'b']);
		activateToolNames(activated, ['c'], 2);
		expect([...activated]).toEqual(['b', 'c']);
	});

	it('collects recent tool names newest first', () => {
		const messages: GLMMessage[] = [
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: '1', type: 'function', function: { name: 'old', arguments: '{}' } }],
			},
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: '2', type: 'function', function: { name: 'new', arguments: '{}' } }],
			},
		];

		expect([...collectRecentToolNames(messages)]).toEqual(['new', 'old']);
	});

	it('searches names and descriptions with pagination', () => {
		const catalog = [
			catalogEntry('screenshot', 'Capture the window'),
			catalogEntry('db_schema', 'Inspect database tables'),
			catalogEntry('alpha', 'Handles alpha tasks'),
		];

		const result = searchToolCatalog(catalog, { query: 'database', offset: 0, limit: 1 });
		expect(result.total).toBe(1);
		expect(result.hasMore).toBe(false);
		expect(result.tools.map((entry) => entry.name)).toEqual(['db_schema']);

		const paged = searchToolCatalog(catalog, { query: '', offset: 1, limit: 1 });
		expect(paged.total).toBe(3);
		expect(paged.hasMore).toBe(true);
		expect(paged.tools.map((entry) => entry.name)).toEqual(['db_schema']);
	});

	it('normalizes search arguments and formats the tool result', () => {
		expect(parseToolSearchArguments({ query: '  db  ', offset: -2, limit: 999 })).toEqual({
			query: 'db',
			offset: 0,
			limit: 20,
		});
		const result = searchToolCatalog([catalogEntry('db_schema', 'tables')], {
			query: 'db',
			offset: 0,
			limit: 10,
		});
		const formatted = JSON.parse(formatToolSearchResult(result)) as {
			total: number;
			tools: Array<{ name: string }>;
		};
		expect(formatted.total).toBe(1);
		expect(formatted.tools[0]?.name).toBe('db_schema');
	});
});

describe('tool discovery rounds', () => {
	it('consumes search calls, activates matches, and returns the final response', async () => {
		const tools = [
			tool('alpha_tool', 'handles alpha work'),
			tool('beta_tool', 'handles beta work'),
			tool('gamma_tool', 'handles gamma work'),
			tool('delta_tool', 'handles delta work'),
			tool('epsilon_tool', 'handles epsilon work'),
			tool('zeta_tool', 'handles zeta work'),
		];
		const activated = new Set<string>();
		const roundTools: string[][] = [];
		let round = 0;

		const result = await runToolDiscoveryRounds({
			messages: [{ role: 'user', content: 'find the alpha tool' }],
			tools,
			isThinkingModel: false,
			activated,
			maxTools: 3,
			runRound: async (_messages, selected) => {
				roundTools.push(selected.map((item) => item.function.name));
				round += 1;
				if (round === 1) {
					expect(selected.map((item) => item.function.name)).toEqual([
						TOOL_SEARCH_NAME,
						'alpha_tool',
						'beta_tool',
					]);
					return {
						parts: [
							new vscode.LanguageModelToolCallPart('search-1', TOOL_SEARCH_NAME, {
								query: 'alpha',
							}),
							usagePart(10, 1),
						],
					};
				}
				expect(selected.map((item) => item.function.name)).toContain('alpha_tool');
				return {
					parts: [new vscode.LanguageModelTextPart('done'), usagePart(20, 2)],
				};
			},
		});

		expect(round).toBe(2);
		expect(result.parts.some((part) => part instanceof vscode.LanguageModelTextPart)).toBe(true);
		expect([...activated]).toEqual(['alpha_tool']);
		const usage = result.parts.find(
			(part) => part instanceof vscode.LanguageModelDataPart && part.mimeType === 'usage',
		) as vscode.LanguageModelDataPart;
		const usageData = JSON.parse(new TextDecoder().decode(usage.data)) as {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
		};
		expect(usageData).toMatchObject({ prompt_tokens: 30, completion_tokens: 3, total_tokens: 33 });
	});

	it('fails after the search round limit', async () => {
		const tools = ['a', 'b', 'c', 'd', 'e'].map((name) => tool(name, ''));

		await expect(
			runToolDiscoveryRounds({
				messages: [{ role: 'user', content: 'loop' }],
				tools,
				isThinkingModel: false,
				activated: new Set(),
				maxTools: 2,
				runRound: async () => ({
					parts: [
						new vscode.LanguageModelToolCallPart('search', TOOL_SEARCH_NAME, {
							query: 'x',
						}),
					],
				}),
			}),
		).rejects.toThrow(/search rounds/);
	});
});
