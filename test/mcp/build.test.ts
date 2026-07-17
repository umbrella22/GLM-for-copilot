import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { BUILTIN_MCP_SERVERS } from '../../src/mcp/builtin';
import {
	buildServerDefinitions,
	resolveAuthEnvKey,
	wantsApiKeyInjection,
} from '../../src/mcp/build';
import { DEFAULT_AUTH_ENV_KEY } from '../../src/mcp/consts';
import type { McpServerConfig, McpServerConfigMap } from '../../src/mcp/types';

// Minimal stdio config helper. `injectApiKey`/`credentialChannel` defaults to
// undefined (no injection) to mirror how user-defined servers look.
function stdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
	return {
		type: 'stdio',
		label: 'test-stdio',
		command: 'npx',
		args: ['-y', 'some-pkg'],
		...overrides,
	};
}

function httpConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
	return {
		type: 'http',
		label: 'test-http',
		url: 'https://example.com/mcp',
		...overrides,
	};
}

describe('buildServerDefinitions', () => {
	it('builds a stdio definition with label/command/args and a derived version', () => {
		const map: McpServerConfigMap = {
			srv: stdioConfig({ label: 'My Server', command: 'node', args: ['server.js', '--port'] }),
		};
		const built = buildServerDefinitions(map);
		expect(built).toHaveLength(1);
		const def = built[0]?.definition;
		expect(def).toBeInstanceOf(vscode.McpStdioServerDefinition);
		const stdio = def as vscode.McpStdioServerDefinition;
		expect(stdio.label).toBe('My Server');
		expect(stdio.command).toBe('node');
		expect(stdio.args).toEqual(['server.js', '--port']);
		// Version is derived from command+args+env+cwd so VS Code can detect any
		// config edit. With empty env and no cwd the suffix is `{}:`.
		expect(stdio.version).toBe('node:server.js,--port:{}:');
	});

	it('builds an http definition with label/uri and a url-derived version', () => {
		const map: McpServerConfigMap = {
			srv: httpConfig({ label: 'Remote', url: 'https://example.com/mcp' }),
		};
		const built = buildServerDefinitions(map);
		expect(built).toHaveLength(1);
		const def = built[0]?.definition;
		expect(def).toBeInstanceOf(vscode.McpHttpServerDefinition);
		const http = def as vscode.McpHttpServerDefinition;
		expect(http.label).toBe('Remote');
		// Version is derived from url+headers; with empty headers the suffix is `:{}`.
		expect(http.version).toBe('https://example.com/mcp:{}');
	});

	it('uses empty args array when args is omitted on stdio', () => {
		const map: McpServerConfigMap = {
			srv: { type: 'stdio', label: 'NoArgs', command: 'bin' },
		};
		const built = buildServerDefinitions(map);
		expect(built).toHaveLength(1);
		const def = built[0]?.definition;
		expect(def).toBeInstanceOf(vscode.McpStdioServerDefinition);
		expect((def as vscode.McpStdioServerDefinition).args).toEqual([]);
	});

	it('falls back to config id as label when label is omitted', () => {
		const map: McpServerConfigMap = {
			'my-id': { type: 'stdio', command: 'bin' },
		};
		const built = buildServerDefinitions(map);
		expect(built[0]?.definition.label).toBe('my-id');
	});

	it('skips stdio configs with blank command', () => {
		const map: McpServerConfigMap = {
			empty: { type: 'stdio', label: 'Empty', command: '   ' },
			ok: stdioConfig({ label: 'OK' }),
		};
		const built = buildServerDefinitions(map);
		expect(built.map((b) => b.id)).toEqual(['ok']);
	});

	it('skips stdio configs with missing command', () => {
		const map: McpServerConfigMap = {
			missing: { type: 'stdio', label: 'Missing' },
		};
		expect(buildServerDefinitions(map)).toHaveLength(0);
	});

	it('skips http configs with blank url', () => {
		const map: McpServerConfigMap = {
			empty: { type: 'http', label: 'Empty', url: '   ' },
		};
		expect(buildServerDefinitions(map)).toHaveLength(0);
	});

	it('skips http configs with missing url', () => {
		const map: McpServerConfigMap = {
			missing: { type: 'http', label: 'Missing' },
		};
		expect(buildServerDefinitions(map)).toHaveLength(0);
	});

	describe('label de-duplication (PR #14 review #6)', () => {
		it('keeps the first label and disambiguates the second by appending (id)', () => {
			const map: McpServerConfigMap = {
				first: stdioConfig({ label: 'Same Label', command: 'first' }),
				second: httpConfig({ label: 'Same Label', url: 'https://second.example.com' }),
			};
			const built = buildServerDefinitions(map);
			expect(built).toHaveLength(2);
			expect(built[0]?.definition.label).toBe('Same Label');
			// Second occurrence keeps the readable base + stable config id suffix.
			expect(built[1]?.definition.label).toBe('Same Label (second)');
		});

		it('does not append suffix when labels are unique', () => {
			const map: McpServerConfigMap = {
				a: stdioConfig({ label: 'Alpha' }),
				b: httpConfig({ label: 'Beta' }),
			};
			const built = buildServerDefinitions(map);
			expect(built.map((b) => b.definition.label).sort()).toEqual(['Alpha', 'Beta']);
		});

		it('disambiguates across more than two collisions using each unique id', () => {
			const map: McpServerConfigMap = {
				a: stdioConfig({ label: 'Dup', command: 'a' }),
				b: stdioConfig({ label: 'Dup', command: 'b' }),
				c: stdioConfig({ label: 'Dup', command: 'c' }),
			};
			const built = buildServerDefinitions(map);
			expect(built.map((b) => b.definition.label)).toEqual(['Dup', 'Dup (b)', 'Dup (c)']);
		});

		it('keeps the original config id and full config on every BuiltServer entry', () => {
			const map: McpServerConfigMap = {
				first: stdioConfig({ label: 'Same', command: 'first' }),
				second: stdioConfig({ label: 'Same', command: 'second' }),
			};
			const built = buildServerDefinitions(map);
			expect(built[0]?.id).toBe('first');
			expect(built[1]?.id).toBe('second');
			expect(built[0]?.config.command).toBe('first');
			expect(built[1]?.config.command).toBe('second');
		});

		// [FORK] PR #15 Finding 5: the earlier single-shot disambiguation did
		// not re-check the generated suffix for collisions. This is the exact
		// counter-example from the review.
		it('disambiguates a second-order collision where the generated suffix matches a literal label', () => {
			// id `a` label "X"            -> label "X"
			// id `c` label "X (b)"        -> label "X (b)" (literal, no collision yet)
			// id `b` label "X"            -> first try "X (b)" -> COLLIDES with c's literal label
			//                             -> second try "X (b-1)" -> unique
			// Ordering matters: a and c are processed before b so seenLabels
			// already contains "X (b)" when b is disambiguated.
			const map: McpServerConfigMap = {
				a: httpConfig({ label: 'X', url: 'https://a.example.com' }),
				c: httpConfig({ label: 'X (b)', url: 'https://c.example.com' }),
				b: httpConfig({ label: 'X', url: 'https://b.example.com' }),
			};
			const built = buildServerDefinitions(map);
			const labels = built.map((entry) => entry.definition.label);
			// All three must be distinct (the bug produced a duplicate "X (b)").
			expect(new Set(labels).size).toBe(3);
			expect(labels).toContain('X');
			expect(labels).toContain('X (b)');
			expect(labels).toContain('X (b-1)');
		});

		it('keeps extending the suffix until unique across many collisions', () => {
			// Two servers with the SAME id suffix would both need (b) -> (b-1)
			// etc., but ids are unique keys so that cannot happen. Instead this
			// case exercises: a literal "X (b)" label collides with the
			// generated suffix for id `b`, forcing b to (b-1); a third id `c`
			// server with label "X" gets (c) which is unique on first try.
			const map: McpServerConfigMap = {
				a: httpConfig({ label: 'X', url: 'https://a' }),
				literal: httpConfig({ label: 'X (b)', url: 'https://lit' }),
				b: httpConfig({ label: 'X', url: 'https://b' }),
				c: httpConfig({ label: 'X', url: 'https://c' }),
			};
			const built = buildServerDefinitions(map);
			const labels = built.map((entry) => entry.definition.label);
			expect(new Set(labels).size).toBe(labels.length);
			// b's generated "X (b)" collides with literal -> "X (b-1)";
			// c's generated "X (c)" is unique immediately.
			expect(labels).toEqual(['X', 'X (b)', 'X (b-1)', 'X (c)']);
		});

		it('forces repeated -N extension when two servers share the same id-suffix root', () => {
			// Construct a scenario where the loop must advance N more than once:
			// pre-register literal labels that block every earlier candidate.
			// id `b` wants "X"; literal labels occupy "X (b)" and "X (b-1)".
			const map: McpServerConfigMap = {
				a: httpConfig({ label: 'X', url: 'https://a' }),
				lit1: httpConfig({ label: 'X (b)', url: 'https://lit1' }),
				lit2: httpConfig({ label: 'X (b-1)', url: 'https://lit2' }),
				b: httpConfig({ label: 'X', url: 'https://b' }),
			};
			const built = buildServerDefinitions(map);
			const labels = built.map((entry) => entry.definition.label);
			expect(new Set(labels).size).toBe(labels.length);
			// b: "X (b)" taken -> "X (b-1)" taken -> "X (b-2)" unique.
			expect(labels).toContain('X (b-2)');
		});
	});

	describe('built-in servers sanity check', () => {
		// Guards against regressions in BUILTIN_MCP_SERVERS: every built-in
		// server must build successfully (valid command/url, unique labels).
		it('builds all built-in servers without dropping any', () => {
			const built = buildServerDefinitions(BUILTIN_MCP_SERVERS);
			expect(built).toHaveLength(Object.keys(BUILTIN_MCP_SERVERS).length);
			// All labels unique after disambiguation.
			const labels = built.map((b) => b.definition.label);
			expect(new Set(labels).size).toBe(labels.length);
		});

		it('classifies built-in servers by the expected transport type', () => {
			const built = buildServerDefinitions(BUILTIN_MCP_SERVERS);
			const byId = new Map(built.map((b) => [b.id, b.definition]));
			expect(byId.get('zai-mcp-server')).toBeInstanceOf(vscode.McpStdioServerDefinition);
			expect(byId.get('web-search-prime')).toBeInstanceOf(vscode.McpHttpServerDefinition);
			expect(byId.get('web-reader')).toBeInstanceOf(vscode.McpHttpServerDefinition);
			expect(byId.get('zread')).toBeInstanceOf(vscode.McpHttpServerDefinition);
		});
	});

	describe('env / cwd / headers forwarding (PR #15 Finding 3)', () => {
		it('forwards user-provided env into the stdio definition env', () => {
			const map: McpServerConfigMap = {
				srv: stdioConfig({ env: { NODE_ENV: 'production', DEBUG: '1' } }),
			};
			const built = buildServerDefinitions(map);
			const def = built[0]?.definition as vscode.McpStdioServerDefinition;
			expect(def.env).toEqual({ NODE_ENV: 'production', DEBUG: '1' });
		});

		it('passes an empty env object when env is omitted (still injectable later)', () => {
			const map: McpServerConfigMap = { srv: stdioConfig() };
			const built = buildServerDefinitions(map);
			const def = built[0]?.definition as vscode.McpStdioServerDefinition;
			expect(def.env).toEqual({});
		});

		it('forwards user-provided cwd as a Uri into the stdio definition', () => {
			const map: McpServerConfigMap = {
				srv: stdioConfig({ cwd: '/srv/app' }),
			};
			const built = buildServerDefinitions(map);
			const def = built[0]?.definition as vscode.McpStdioServerDefinition;
			expect(def.cwd).toBeDefined();
			expect(def.cwd?.fsPath).toContain('srv');
		});

		it('omits cwd when cwd is not configured', () => {
			const map: McpServerConfigMap = { srv: stdioConfig() };
			const built = buildServerDefinitions(map);
			const def = built[0]?.definition as vscode.McpStdioServerDefinition;
			expect(def.cwd).toBeUndefined();
		});

		it('forwards user-provided headers into the http definition', () => {
			const map: McpServerConfigMap = {
				srv: httpConfig({ headers: { 'X-Custom': 'val', Accept: 'application/json' } }),
			};
			const built = buildServerDefinitions(map);
			const def = built[0]?.definition as vscode.McpHttpServerDefinition;
			expect(def.headers).toEqual({ 'X-Custom': 'val', Accept: 'application/json' });
		});

		it('passes an empty headers object when headers is omitted', () => {
			const map: McpServerConfigMap = { srv: httpConfig() };
			const built = buildServerDefinitions(map);
			const def = built[0]?.definition as vscode.McpHttpServerDefinition;
			expect(def.headers).toEqual({});
		});

		it('includes env in the version so env edits trigger a tool refresh', () => {
			const v1 = buildServerDefinitions({
				srv: stdioConfig({ env: { A: '1' } }),
			})[0]?.definition.version;
			const v2 = buildServerDefinitions({
				srv: stdioConfig({ env: { A: '2' } }),
			})[0]?.definition.version;
			expect(v1).not.toBe(v2);
		});

		it('includes headers in the version so header edits trigger a refresh', () => {
			const v1 = buildServerDefinitions({
				srv: httpConfig({ headers: { H: '1' } }),
			})[0]?.definition.version;
			const v2 = buildServerDefinitions({
				srv: httpConfig({ headers: { H: '2' } }),
			})[0]?.definition.version;
			expect(v1).not.toBe(v2);
		});

		it('produces a stable version for equal env maps regardless of key order', () => {
			const v1 = buildServerDefinitions({
				srv: stdioConfig({ env: { A: '1', B: '2' } }),
			})[0]?.definition.version;
			const v2 = buildServerDefinitions({
				srv: stdioConfig({ env: { B: '2', A: '1' } }),
			})[0]?.definition.version;
			expect(v1).toBe(v2);
		});
	});
});

describe('resolveAuthEnvKey', () => {
	it('returns the default env key when authEnvKey is omitted', () => {
		expect(resolveAuthEnvKey(stdioConfig())).toBe(DEFAULT_AUTH_ENV_KEY);
	});

	it('returns the default env key when authEnvKey is undefined', () => {
		expect(
			resolveAuthEnvKey({ type: 'stdio', label: 'x', command: 'c', authEnvKey: undefined }),
		).toBe(DEFAULT_AUTH_ENV_KEY);
	});

	it('returns the configured authEnvKey when set', () => {
		expect(resolveAuthEnvKey(stdioConfig({ authEnvKey: 'ANTHROPIC_API_KEY' }))).toBe(
			'ANTHROPIC_API_KEY',
		);
	});
});

describe('wantsApiKeyInjection (PR #14 review #2)', () => {
	it('returns false when injectApiKey is omitted (user-defined default)', () => {
		expect(wantsApiKeyInjection(stdioConfig())).toBe(false);
	});

	it('returns false when injectApiKey is explicitly false', () => {
		expect(wantsApiKeyInjection(stdioConfig({ injectApiKey: false }))).toBe(false);
	});

	it('returns true ONLY when injectApiKey is strictly true', () => {
		expect(wantsApiKeyInjection(stdioConfig({ injectApiKey: true }))).toBe(true);
	});

	it('returns false for truthy non-boolean values (strict opt-in)', () => {
		// Guards against accidental truthy values like 'yes' / 1 sneaking in.
		expect(wantsApiKeyInjection(stdioConfig({ injectApiKey: 'yes' as unknown as boolean }))).toBe(
			false,
		);
		expect(wantsApiKeyInjection(stdioConfig({ injectApiKey: 1 as unknown as boolean }))).toBe(
			false,
		);
	});

	it('independent of transport type: http without injectApiKey does not opt in', () => {
		expect(wantsApiKeyInjection(httpConfig())).toBe(false);
	});

	it('all built-in servers explicitly opt in to key injection', () => {
		for (const [id, config] of Object.entries(BUILTIN_MCP_SERVERS)) {
			expect(config.injectApiKey, `built-in server "${id}" must set injectApiKey: true`).toBe(true);
		}
	});
});
