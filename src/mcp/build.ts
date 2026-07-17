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
	//
	// [FORK] PR #15 Finding 5: the earlier single-shot disambiguation only
	// checked whether `baseLabel` was taken, then appended `(id)` without
	// re-checking that the result was also unique. Counter-example:
	//   id `a` label "X", id `c` label "X (b)", id `b` label "X"
	// -> the third server's `X (b)` collides with the second one's literal
	// label, and VS Code's `find(label)` resolves both to whichever registered
	// first. Now we LOOP until the candidate is unique within this collection.
	const suffixId = sanitizeLabelSuffix(id);
	const label = disambiguateLabel(baseLabel, suffixId, seenLabels);
	if (config.type === 'stdio') {
		const command = config.command?.trim();
		if (!command) {
			return undefined;
		}
		const args = config.args ?? [];
		// [FORK] PR #15 Finding 3: forward user-provided env so stdio servers
		// actually receive it (previously buildOne always passed `{}`, silently
		// dropping the env field the user configured). The auth key is merged
		// into this same env at resolve time.
		const env: Record<string, string> = { ...config.env };
		// `version` is derived from every field that affects HOW the server runs
		// (command, args, env, cwd) so VS Code can detect any config edit and
		// prompt a tool refresh. Including env here means editing env also
		// triggers a refresh, which is the desired behavior.
		const version = `${config.command}:${args.join(',')}:${stableStringify(env)}:${config.cwd ?? ''}`;
		const definition = new vscode.McpStdioServerDefinition(label, command, args, env, version);
		// [FORK] PR #15 Finding 3: cwd is a Uri-typed instance property (NOT a
		// constructor parameter per the VS Code API), so assign it post-construction.
		// An empty/whitespace cwd is ignored so the process inherits the editor's.
		const cwd = config.cwd?.trim();
		if (cwd) {
			definition.cwd = vscode.Uri.file(cwd);
		}
		return definition;
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
		// [FORK] PR #15 Finding 3: forward user-provided headers so http servers
		// actually receive them. The Authorization header is merged in at
		// resolve time.
		const headers: Record<string, string> = { ...config.headers };
		const version = `${url}:${stableStringify(headers)}`;
		return new vscode.McpHttpServerDefinition(label, uri, headers, version);
	}
	return undefined;
}

/**
 * [FORK] Deterministic JSON-ish serialization for embedding a small object
 * into a version string. Keys are sorted so two logically-equal maps with
 * different insertion order produce the same version. Only used on env /
 * headers maps (flat string→string), never on nested structures.
 */
function stableStringify(record: Readonly<Record<string, string>>): string {
	const keys = Object.keys(record).sort();
	if (keys.length === 0) {
		return '{}';
	}
	return '{' + keys.map((k) => `${k}=${record[k]}`).join(',') + '}';
}

/**
 * [FORK] PR #15 Finding 5: produce a label that is unique within `seenLabels`.
 *
 * - If `baseLabel` is free, use it as-is (happy path, keeps labels readable).
 * - Otherwise append ` (<suffixId>)` where suffixId is the sanitized config id.
 * - If THAT is also taken (the counter-example from the review: a later server
 *   has a literal label of the form "X (b)" that collides with the generated
 *   suffix), keep appending `-<n>` until unique. The result is guaranteed
 *   unique by construction, so VS Code's label-based `find` always resolves
 *   to the intended server.
 */
function disambiguateLabel(
	baseLabel: string,
	suffixId: string,
	seenLabels: ReadonlySet<string>,
): string {
	if (!seenLabels.has(baseLabel)) {
		return baseLabel;
	}
	let candidate = `${baseLabel} (${suffixId})`;
	let attempt = 1;
	while (seenLabels.has(candidate)) {
		candidate = `${baseLabel} (${suffixId}-${attempt})`;
		attempt += 1;
	}
	return candidate;
}

/**
 * [FORK] Sanitize a config id for inclusion in a generated label suffix.
 * Strips characters that would be confusing or unsafe inside a parenthesized
 * label (whitespace, parens, control chars). Falls back to a stable placeholder
 * when nothing usable remains.
 */
function sanitizeLabelSuffix(id: string): string {
	const cleaned = id.replace(/[^a-zA-Z0-9_\-.]/g, '').trim();
	return cleaned.length > 0 ? cleaned : 'server';
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
