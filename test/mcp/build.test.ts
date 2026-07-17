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
		// Version is derived from command+args so VS Code can detect config edits.
		expect(stdio.version).toBe('node:server.js,--port');
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
		expect(http.version).toBe('https://example.com/mcp');
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
