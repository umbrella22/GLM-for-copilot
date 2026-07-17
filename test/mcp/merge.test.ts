import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_MCP_SERVERS } from '../../src/mcp/builtin';
import { mergeMcpServers, pickEnabledServers } from '../../src/mcp/merge';
import type { McpServerConfig, McpServerConfigMap } from '../../src/mcp/types';
import { __clearConfigurationValues, __setConfigurationValue } from '../support/vscode.mock';

// Helpers ----------------------------------------------------------------

function userStdio(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
	return {
		type: 'stdio',
		label: 'Custom Stdio',
		command: 'node',
		args: ['server.js'],
		...overrides,
	};
}

function userHttp(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
	return {
		type: 'http',
		label: 'Custom HTTP',
		url: 'https://custom.example.com/mcp',
		...overrides,
	};
}

/** Toggle a built-in server's checkbox (the authoritative enabled source). */
function setBuiltinEnabled(id: keyof typeof BUILTIN_MCP_SERVERS, value: boolean): void {
	const key = `glm-copilot.mcp.${id}.enabled`;
	__setConfigurationValue(key, value);
}

// -----------------------------------------------------------------------

describe('mergeMcpServers — built-in servers', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('includes every built-in server with enabled=false when no checkboxes are set', () => {
		// All checkboxes default to false (opt-in) per readBuiltinServerEnabled.
		const merged = mergeMcpServers({});
		expect(Object.keys(merged).sort()).toEqual(Object.keys(BUILTIN_MCP_SERVERS).sort());
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			expect(merged[id]?.enabled, `built-in "${id}" should default to disabled`).toBe(false);
		}
	});

	it('reflects the checkbox value when a built-in server is enabled', () => {
		setBuiltinEnabled('zread', true);
		const merged = mergeMcpServers({});
		expect(merged.zread?.enabled).toBe(true);
		// Other built-ins stay disabled.
		expect(merged['zai-mcp-server']?.enabled).toBe(false);
	});

	it('IGNORES the enabled field in user overrides for built-in ids (checkbox wins)', () => {
		// User tries to enable zai via the servers object; this must be ignored
		// because the checkbox is the authoritative source for built-in servers.
		const userConfig: McpServerConfigMap = {
			'zai-mcp-server': { ...userStdio(), enabled: true },
		};
		const merged = mergeMcpServers(userConfig);
		// Checkbox is unset -> false, regardless of the user's enabled: true.
		expect(merged['zai-mcp-server']?.enabled).toBe(false);
	});

	it('merges user field overrides onto the built-in base, field by field', () => {
		// User overrides only the URL of web-reader; built-in defaults for other
		// fields (label, detail, credentialChannel, injectApiKey) must survive.
		const original = BUILTIN_MCP_SERVERS['web-reader'];
		const userConfig: McpServerConfigMap = {
			'web-reader': { type: 'http', label: 'Web Reader', url: 'https://proxy.example.com' },
		};
		const merged = mergeMcpServers(userConfig);
		expect(merged['web-reader']?.url).toBe('https://proxy.example.com');
		// Built-in fields preserved (not clobbered by the partial override).
		expect(merged['web-reader']?.detail).toBe(original.detail);
		expect(merged['web-reader']?.credentialChannel).toBe(original.credentialChannel);
		expect(merged['web-reader']?.injectApiKey).toBe(original.injectApiKey);
	});

	it('keeps built-in servers intact when the user config has no override for them', () => {
		const merged = mergeMcpServers({});
		// Full built-in shape is preserved (all first-party fields present).
		expect(merged['zai-mcp-server']).toMatchObject({
			type: 'stdio',
			injectApiKey: true,
			credentialChannel: 'china-coding',
		});
		expect(merged['web-search-prime']).toMatchObject({
			type: 'http',
			injectApiKey: true,
			credentialChannel: 'china-coding',
		});
	});
});

describe('mergeMcpServers — user-defined servers', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('includes a valid user-defined stdio server', () => {
		const userConfig: McpServerConfigMap = { 'my-stdio': userStdio() };
		const merged = mergeMcpServers(userConfig);
		expect(merged['my-stdio']).toBeDefined();
		expect(merged['my-stdio']?.command).toBe('node');
	});

	it('includes a valid user-defined http server', () => {
		const userConfig: McpServerConfigMap = { 'my-http': userHttp() };
		const merged = mergeMcpServers(userConfig);
		expect(merged['my-http']?.url).toBe('https://custom.example.com/mcp');
	});

	it('drops a user-defined stdio server with blank command', () => {
		const userConfig: McpServerConfigMap = {
			bad: userStdio({ command: '   ' }),
		};
		expect(mergeMcpServers(userConfig).bad).toBeUndefined();
	});

	it('drops a user-defined stdio server with missing command', () => {
		const userConfig: McpServerConfigMap = {
			bad: { type: 'stdio', label: 'No Command' },
		};
		expect(mergeMcpServers(userConfig).bad).toBeUndefined();
	});

	it('drops a user-defined http server with blank url', () => {
		const userConfig: McpServerConfigMap = { bad: userHttp({ url: '   ' }) };
		expect(mergeMcpServers(userConfig).bad).toBeUndefined();
	});

	it('drops a user-defined http server with missing url', () => {
		const userConfig: McpServerConfigMap = { bad: { type: 'http', label: 'No URL' } };
		expect(mergeMcpServers(userConfig).bad).toBeUndefined();
	});

	it('drops a user-defined server with no label', () => {
		// label is required for user-defined servers (label undefined falls back
		// to id only at build time; merge requires a real label).
		const userConfig: McpServerConfigMap = {
			bad: { type: 'stdio', command: 'c' } as McpServerConfig,
		};
		expect(mergeMcpServers(userConfig).bad).toBeUndefined();
	});

	it('respects the user-set enabled field for user-defined servers', () => {
		// Custom servers have no checkbox; their own enabled field is authoritative.
		const userConfig: McpServerConfigMap = {
			off: { ...userStdio(), enabled: false },
			on: { ...userStdio(), enabled: true },
			unset: userStdio(), // omitted -> defaults to enabled (undefined !== false)
		};
		const merged = mergeMcpServers(userConfig);
		expect(merged.off?.enabled).toBe(false);
		expect(merged.on?.enabled).toBe(true);
		expect(merged.unset?.enabled).toBeUndefined();
	});

	it('does not let a user-defined server shadow a built-in id', () => {
		// A user entry whose id matches a built-in is treated as an override,
		// not a new server. The built-in shape (with checkbox-enabled) wins.
		const userConfig: McpServerConfigMap = {
			zread: { type: 'http', label: 'Fake Zread', url: 'https://evil.example.com' },
		};
		const merged = mergeMcpServers(userConfig);
		// Built-in URL is overridden by the user's URL (field-level merge),
		// but injectApiKey/credentialChannel from the built-in are preserved.
		expect(merged.zread?.url).toBe('https://evil.example.com');
		expect(merged.zread?.injectApiKey).toBe(true);
		expect(merged.zread?.credentialChannel).toBe('china-coding');
		// And it is NOT added as a separate user-defined entry.
		expect(Object.keys(merged).filter((id) => id === 'zread')).toHaveLength(1);
	});
});

describe('pickEnabledServers', () => {
	it('keeps servers with enabled !== false', () => {
		const map: McpServerConfigMap = {
			a: { ...userStdio(), enabled: true },
			b: userStdio(), // enabled undefined
			c: { ...userStdio(), enabled: false },
		};
		const picked = pickEnabledServers(map);
		expect(Object.keys(picked).sort()).toEqual(['a', 'b']);
	});

	it('returns an empty map when all servers are disabled', () => {
		const map: McpServerConfigMap = {
			a: { ...userStdio(), enabled: false },
			b: { ...userHttp(), enabled: false },
		};
		expect(pickEnabledServers(map)).toEqual({});
	});

	it('returns an empty map for empty input', () => {
		expect(pickEnabledServers({})).toEqual({});
	});

	it('keeps all servers when none set enabled to false', () => {
		const map: McpServerConfigMap = {
			a: { ...userStdio(), enabled: true },
			b: userStdio(),
		};
		expect(Object.keys(pickEnabledServers(map)).sort()).toEqual(['a', 'b']);
	});

	it('preserves full config on picked servers (no field stripping)', () => {
		const original: McpServerConfig = { ...userStdio(), enabled: true, detail: 'desc' };
		const picked = pickEnabledServers({ srv: original });
		expect(picked.srv).toEqual(original);
	});
});

describe('mergeMcpServers + pickEnabledServers integration', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('only enabled built-ins + valid user servers reach the picked set', () => {
		setBuiltinEnabled('web-search-prime', true);
		const userConfig: McpServerConfigMap = {
			valid: userStdio(),
			disabledByUser: { ...userHttp(), enabled: false },
			invalid: userStdio({ command: '' }), // dropped at merge time
		};
		const merged = mergeMcpServers(userConfig);
		const picked = pickEnabledServers(merged);
		const ids = Object.keys(picked).sort();
		// web-search-prime enabled via checkbox; zai/web-reader/zread disabled;
		// 'valid' included; 'disabledByUser' filtered out; 'invalid' never merged.
		expect(ids).toContain('web-search-prime');
		expect(ids).not.toContain('zai-mcp-server');
		expect(ids).not.toContain('web-reader');
		expect(ids).not.toContain('zread');
		expect(ids).toContain('valid');
		expect(ids).not.toContain('disabledByUser');
		expect(ids).not.toContain('invalid');
	});
});
