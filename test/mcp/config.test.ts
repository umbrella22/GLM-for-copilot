import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { buildServerDefinitions } from '../../src/mcp/build';
import { readUserMcpServers } from '../../src/mcp/config';
import { mergeMcpServers, pickEnabledServers } from '../../src/mcp/merge';
import {
	__clearConfigurationValues,
	__setConfigurationDefaultValue,
	__setConfigurationValue,
} from '../support/vscode.mock';

describe('readUserMcpServers — explicit configuration boundary', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('does not mistake recursively merged manifest defaults for explicit credential consent', () => {
		__setConfigurationDefaultValue('glm-copilot.mcp.servers', {
			'web-reader': {
				type: 'http',
				label: 'Web Reader',
				url: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
				injectApiKey: true,
				credentialChannel: 'china-coding',
			},
		});
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'web-reader': { url: 'https://proxy.example.com/reader' },
		});

		const effective = vscode.workspace
			.getConfiguration('glm-copilot')
			.get<Record<string, Record<string, unknown>>>('mcp.servers');
		expect(effective?.['web-reader']).toMatchObject({
			url: 'https://proxy.example.com/reader',
			injectApiKey: true,
			credentialChannel: 'china-coding',
		});

		const explicit = readUserMcpServers();
		expect(explicit['web-reader']).toEqual({ url: 'https://proxy.example.com/reader' });
		expect(explicit['web-reader']?.injectApiKey).toBeUndefined();
		expect(explicit['web-reader']?.credentialChannel).toBeUndefined();
	});

	it('preserves an own __proto__ server id without changing the result prototype', () => {
		const configured = JSON.parse(
			'{"__proto__":{"type":"http","label":"Prototype Server","url":"https://example.com/mcp"}}',
		) as Record<string, unknown>;
		__setConfigurationValue('glm-copilot.mcp.servers', configured);

		const result = readUserMcpServers();
		expect(Object.getPrototypeOf(result)).toBeNull();
		expect(Object.hasOwn(result, '__proto__')).toBe(true);
		expect(result['__proto__']).toMatchObject({
			type: 'http',
			label: 'Prototype Server',
			url: 'https://example.com/mcp',
		});

		const merged = mergeMcpServers(result);
		const enabled = pickEnabledServers(merged);
		expect(Object.getPrototypeOf(merged)).toBeNull();
		expect(Object.getPrototypeOf(enabled)).toBeNull();
		expect(Object.hasOwn(merged, '__proto__')).toBe(true);
		expect(Object.hasOwn(enabled, '__proto__')).toBe(true);
		expect(buildServerDefinitions(enabled)).toEqual([
			expect.objectContaining({
				id: '__proto__',
				definition: expect.objectContaining({ label: 'Prototype Server' }),
			}),
		]);
	});

	it('returns an empty map for malformed non-object settings', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', null);
		expect(readUserMcpServers()).toEqual(Object.create(null));
	});
});

/**
 * [FORK] PR #15 Finding 3: sanitize must distinguish built-in partial
 * overrides from standalone user definitions. Previously the single strict
 * sanitizer required type+label on every entry, silently dropping legitimate
 * partial built-in overrides (e.g. just `{ "url": "..." }`) and the env/cwd/
 * headers fields VS Code actually supports.
 */
describe('readUserMcpServers — built-in partial overrides (PR #15 F3)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('keeps a built-in http override that specifies ONLY a url', () => {
		// The headline bug: user wanted to point web-reader at a proxy but the
		// old sanitizer dropped this entry for lacking type+label.
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'web-reader': { url: 'https://proxy.example.com/reader' },
		});
		const result = readUserMcpServers();
		expect(result['web-reader']).toBeDefined();
		expect(result['web-reader']?.url).toBe('https://proxy.example.com/reader');
	});

	it('keeps a built-in stdio override that specifies ONLY args', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'zai-mcp-server': { args: ['-y', '@z_ai/mcp-server@0.9.9'] },
		});
		const result = readUserMcpServers();
		expect(result['zai-mcp-server']?.args).toEqual(['-y', '@z_ai/mcp-server@0.9.9']);
	});

	it('keeps a built-in override that specifies ONLY env (stdio)', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'zai-mcp-server': { env: { NODE_ENV: 'production', DEBUG: '1' } },
		});
		const result = readUserMcpServers();
		expect(result['zai-mcp-server']?.env).toEqual({ NODE_ENV: 'production', DEBUG: '1' });
	});

	it('keeps a built-in override that specifies ONLY headers (http)', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'web-reader': { headers: { 'X-Custom': 'value' } },
		});
		const result = readUserMcpServers();
		expect(result['web-reader']?.headers).toEqual({ 'X-Custom': 'value' });
	});

	it('keeps a built-in override that specifies ONLY cwd (stdio)', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'zai-mcp-server': { cwd: '/custom/work/dir' },
		});
		const result = readUserMcpServers();
		expect(result['zai-mcp-server']?.cwd).toBe('/custom/work/dir');
	});

	it('drops a built-in override whose env is not a flat string map', () => {
		// env values must be strings; nested objects / numbers are rejected.
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'zai-mcp-server': { env: { BAD: { nested: true }, GOOD: 'ok' } },
		});
		const result = readUserMcpServers();
		expect(result['zai-mcp-server']?.env).toEqual({ GOOD: 'ok' });
	});
});

describe('readUserMcpServers — standalone user servers (PR #15 F3)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	afterEach(() => {
		__clearConfigurationValues();
	});

	it('keeps a complete standalone stdio server with env/cwd', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'my-server': {
				type: 'stdio',
				label: 'My Server',
				command: 'node',
				args: ['server.js'],
				cwd: '/srv',
				env: { NODE_ENV: 'production' },
			},
		});
		const result = readUserMcpServers();
		expect(result['my-server']).toBeDefined();
		expect(result['my-server']?.command).toBe('node');
		expect(result['my-server']?.cwd).toBe('/srv');
		expect(result['my-server']?.env).toEqual({ NODE_ENV: 'production' });
	});

	it('keeps a complete standalone http server with headers', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			'my-http': {
				type: 'http',
				label: 'My HTTP',
				url: 'https://api.example.com/mcp',
				headers: { Authorization: 'Bearer static-token' },
			},
		});
		const result = readUserMcpServers();
		expect(result['my-http']?.headers).toEqual({ Authorization: 'Bearer static-token' });
	});

	it('drops a standalone server missing type', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			bad: { label: 'No Type', url: 'https://x' },
		});
		const result = readUserMcpServers();
		expect(result.bad).toBeUndefined();
	});

	it('drops a standalone server missing label', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			bad: { type: 'http', url: 'https://x' },
		});
		const result = readUserMcpServers();
		expect(result.bad).toBeUndefined();
	});

	it('drops a standalone stdio server missing command', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			bad: { type: 'stdio', label: 'No Cmd' },
		});
		const result = readUserMcpServers();
		expect(result.bad).toBeUndefined();
	});

	it('drops a standalone http server missing url', () => {
		__setConfigurationValue('glm-copilot.mcp.servers', {
			bad: { type: 'http', label: 'No URL' },
		});
		const result = readUserMcpServers();
		expect(result.bad).toBeUndefined();
	});
});
