import vscode from 'vscode';
import { DEFAULT_AUTH_ENV_KEY } from './consts';
import type { McpServerConfig, McpServerConfigMap } from './types';

/**
 * Pairing of a VS Code MCP server definition with the originating config.
 *
 * The definition is what gets returned from `provideMcpServerDefinitions`
 * (without secrets); the config is kept around so `resolveMcpServerDefinition`
 * can re-read auth hints when injecting keys.
 */
export interface BuiltServer {
	readonly id: string;
	readonly config: McpServerConfig;
	readonly definition: vscode.McpServerDefinition;
}

/**
 * Build VS Code MCP server definitions from the merged config map.
 *
 * The returned definitions intentionally carry NO secrets (no API key in env
 * or headers). Keys are injected later by `resolveMcpServerDefinition`,
 * because `provideMcpServerDefinitions` is called eagerly on every chat
 * message submission and must stay cheap / non-interactive.
 *
 * Invalid configs (e.g. stdio without command, http without URL) are skipped.
 */
export function buildServerDefinitions(map: Readonly<McpServerConfigMap>): BuiltServer[] {
	const result: BuiltServer[] = [];
	// [FORK] De-duplicate labels within this collection. VS Code 1.116 resolves
	// a server definition by `find(server => server.label === label)`, so two
	// different config ids sharing a label would cause the second server to be
	// resolved against the first one's URL/command/auth. To stay safe while
	// keeping labels readable, the first occurrence keeps its label and any
	// later collision gets ` (<id>)` appended.
	const seenLabels = new Set<string>();
	for (const [id, config] of Object.entries(map)) {
		const definition = buildOne(id, config, seenLabels);
		if (definition) {
			seenLabels.add(definition.label);
			result.push({ id, config, definition });
		}
	}
	return result;
}

function buildOne(
	id: string,
	config: McpServerConfig,
	seenLabels: ReadonlySet<string>,
): vscode.McpServerDefinition | undefined {
	const baseLabel = config.label ?? id;
	// [FORK] Disambiguate duplicate labels by appending the stable config id.
	// This keeps the first label readable and makes collisions explicit
	// instead of silently misrouting to the wrong server.
	const label = seenLabels.has(baseLabel) ? `${baseLabel} (${id})` : baseLabel;
	if (config.type === 'stdio') {
		const command = config.command?.trim();
		if (!command) {
			return undefined;
		}
		const args = config.args ?? [];
		// `version` set to a stable value derived from config so that VS Code
		// can detect when the server definition changed (e.g. command/args
		// edited via UI) and prompt a tool refresh.
		const version = `${config.command}:${args.join(',')}`;
		return new vscode.McpStdioServerDefinition(label, command, args, {}, version);
	}
	if (config.type === 'http') {
		const url = config.url?.trim();
		if (!url) {
			return undefined;
		}
		let uri: vscode.Uri;
		try {
			uri = vscode.Uri.parse(url, true);
		} catch {
			return undefined;
		}
		const version = url;
		return new vscode.McpHttpServerDefinition(label, uri, {}, version);
	}
	return undefined;
}

/**
 * Resolve which env variable name (stdio) the API key should be written to.
 * Falls back to the default `Z_AI_API_KEY`.
 */
export function resolveAuthEnvKey(config: McpServerConfig): string {
	return config.authEnvKey ?? DEFAULT_AUTH_ENV_KEY;
}

/**
 * Whether this server wants the API key injected at resolve time.
 *
 * [FORK] This is an explicit opt-in: the key is injected ONLY when
 * `config.injectApiKey === true`. User-defined servers default to no
 * injection (the field is `undefined`), so BYOK credentials never leak to
 * third-party processes or URLs without the user explicitly requesting it.
 * Built-in GLM official servers set `injectApiKey: true` in `builtin.ts`.
 *
 * The transport type (stdio vs http) only affects HOW the key is injected
 * (env var vs Authorization header), not WHETHER it is injected.
 */
export function wantsApiKeyInjection(config: McpServerConfig): boolean {
	return config.injectApiKey === true;
}
