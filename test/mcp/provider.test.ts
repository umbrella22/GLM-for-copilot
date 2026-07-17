import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { AuthManager } from '../../src/auth';
import { GlmMcpServerProvider } from '../../src/mcp/provider';

// Stub resolveServerDefinition so tests can assert the provider's routing
// logic (label-based lookup) without standing up the full credential chain.
// The spy records what the provider passed through. Partial mock keeps the
// other exports (resolveServerCredentialChannel etc.) available.
const resolveServerDefinitionMock = vi.fn(
	async (
		built: { id: string; definition: vscode.McpServerDefinition },
		_authManager: AuthManager,
		_token: vscode.CancellationToken,
		_resource?: vscode.Uri,
	): Promise<vscode.McpServerDefinition | undefined> => built.definition,
);
vi.mock('../../src/mcp/resolve', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/mcp/resolve')>();
	return {
		...actual,
		resolveServerDefinition: (...args: unknown[]) => resolveServerDefinitionMock(...args),
	};
});

// Partial mock: only replace readUserMcpServers; keep all other config
// exports (readBuiltinServerEnabled etc.) from the real module, because
// mergeMcpServers depends on them at runtime.
const readUserMcpServersMock = vi.fn((): Record<string, unknown> => ({}));
vi.mock('../../src/mcp/config', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/mcp/config')>();
	return { ...actual, readUserMcpServers: () => readUserMcpServersMock() };
});

// getActiveWorkspaceFolderResource stub returns undefined by default.
const getActiveWorkspaceFolderResourceMock = vi.fn((): vscode.Uri | undefined => undefined);
vi.mock('../../src/workspace', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/workspace')>();
	return {
		...actual,
		getActiveWorkspaceFolderResource: () => getActiveWorkspaceFolderResourceMock(),
	};
});

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

function createAuthManager(): AuthManager {
	return { getApiKey: async () => 'test-key' } as unknown as AuthManager;
}

/** A stdio config object that survives readUserMcpServers round-trip. */
function stdioServer(label: string, command = 'node'): Record<string, unknown> {
	return { type: 'stdio', label, command, args: ['s.js'], injectApiKey: true };
}

describe('GlmMcpServerProvider — provideMcpServerDefinitions', () => {
	beforeEach(() => {
		readUserMcpServersMock.mockReset();
		readUserMcpServersMock.mockReturnValue({});
		resolveServerDefinitionMock.mockClear();
	});

	it('returns built definitions for the enabled user servers', async () => {
		readUserMcpServersMock.mockReturnValue({
			srv: stdioServer('My Server'),
		});
		const provider = new GlmMcpServerProvider(createAuthManager());
		const definitions = await provider.provideMcpServerDefinitions(token);
		expect(definitions).toHaveLength(1);
		expect(definitions[0]).toBeInstanceOf(vscode.McpStdioServerDefinition);
		expect(definitions[0]?.label).toBe('My Server');
	});

	it('returns an empty array (not throw) when there are no servers', async () => {
		readUserMcpServersMock.mockReturnValue({});
		const provider = new GlmMcpServerProvider(createAuthManager());
		const definitions = await provider.provideMcpServerDefinitions(token);
		expect(definitions).toEqual([]);
	});

	it('returns an empty array when readUserMcpServers throws', async () => {
		readUserMcpServersMock.mockImplementation(() => {
			throw new Error('settings read failed');
		});
		const provider = new GlmMcpServerProvider(createAuthManager());
		// Must not propagate the error; provide is called on every chat submit
		// and must stay non-fatal.
		const definitions = await provider.provideMcpServerDefinitions(token);
		expect(definitions).toEqual([]);
	});

	it('only exposes enabled servers (disabled ones are filtered out)', async () => {
		readUserMcpServersMock.mockReturnValue({
			on: stdioServer('On'),
			off: { ...stdioServer('Off'), enabled: false },
		});
		const provider = new GlmMcpServerProvider(createAuthManager());
		const definitions = await provider.provideMcpServerDefinitions(token);
		expect(definitions.map((d) => d.label)).toEqual(['On']);
	});
});

describe('GlmMcpServerProvider — resolveMcpServerDefinition label-keyed lookup', () => {
	beforeEach(() => {
		readUserMcpServersMock.mockReset();
		readUserMcpServersMock.mockReturnValue({});
		resolveServerDefinitionMock.mockClear();
		resolveServerDefinitionMock.mockImplementation(
			async (built: { definition: vscode.McpServerDefinition }) => built.definition,
		);
	});

	it('finds the built server by LABEL even when VS Code passes back a DIFFERENT object instance', async () => {
		// This is the regression guard for the WeakMap->label fix (commit
		// 55dea61). The old WeakMap keyed by object reference; if VS Code passed
		// back a cloned/re-serialized definition at resolve time, the lookup
		// silently missed and credential injection was skipped.
		readUserMcpServersMock.mockReturnValue({
			srv: stdioServer('Stable Label'),
		});
		const provider = new GlmMcpServerProvider(createAuthManager());
		await provider.provideMcpServerDefinitions(token);

		// Simulate VS Code handing back a brand-new object that merely shares
		// the label (no shared reference with the provide-time definition).
		const reSerialized = new vscode.McpStdioServerDefinition(
			'Stable Label',
			'will-be-replaced',
			[],
			{},
			'v2',
		);
		await provider.resolveMcpServerDefinition(reSerialized, token);

		// resolveServerDefinition MUST have been called — the label lookup hit.
		expect(resolveServerDefinitionMock).toHaveBeenCalledTimes(1);
		const [built] = resolveServerDefinitionMock.mock.calls[0]!;
		// And it resolved against the ORIGINAL built config (command 'node'),
		// not the re-serialized placeholder.
		expect((built as { config: { command: string } }).config.command).toBe('node');
	});

	it('passes the server unchanged when the label is unknown (not in the last provide)', async () => {
		readUserMcpServersMock.mockReturnValue({ srv: stdioServer('Known') });
		const provider = new GlmMcpServerProvider(createAuthManager());
		await provider.provideMcpServerDefinitions(token);

		const unknown = new vscode.McpStdioServerDefinition('Unknown', 'x', [], {}, 'v');
		const result = await provider.resolveMcpServerDefinition(unknown, token);
		// No matching built server -> returned as-is, resolveServerDefinition
		// not called.
		expect(result).toBe(unknown);
		expect(resolveServerDefinitionMock).not.toHaveBeenCalled();
	});

	it('rebuilds the label index on each provide (removed servers stop resolving)', async () => {
		// Provide with two servers, then provide again with only one; the
		// removed server's label must no longer resolve.
		readUserMcpServersMock.mockReturnValue({
			a: stdioServer('A'),
			b: stdioServer('B'),
		});
		const provider = new GlmMcpServerProvider(createAuthManager());
		await provider.provideMcpServerDefinitions(token);

		readUserMcpServersMock.mockReturnValue({ a: stdioServer('A') });
		await provider.provideMcpServerDefinitions(token);

		// 'B' was removed in the second provide; resolving it must now miss.
		const result = await provider.resolveMcpServerDefinition(
			new vscode.McpStdioServerDefinition('B', 'x', [], {}, 'v'),
			token,
		);
		expect(resolveServerDefinitionMock).not.toHaveBeenCalled();
		// Returned the input unchanged (unknown label path).
		expect(result).toBeDefined();
	});

	it('forwards the active workspace folder resource to resolveServerDefinition', async () => {
		const resource = vscode.Uri.file('/workspace/folder-x');
		getActiveWorkspaceFolderResourceMock.mockReturnValueOnce(resource);
		readUserMcpServersMock.mockReturnValue({ srv: stdioServer('Srv') });
		const provider = new GlmMcpServerProvider(createAuthManager());
		await provider.provideMcpServerDefinitions(token);

		await provider.resolveMcpServerDefinition(
			new vscode.McpStdioServerDefinition('Srv', 'x', [], {}, 'v'),
			token,
		);
		const callArgs = resolveServerDefinitionMock.mock.calls[0]!;
		// Args: (built, authManager, token, resource)
		expect(callArgs[3]).toBe(resource);
	});

	it('returns undefined when resolveServerDefinition throws (error contained)', async () => {
		readUserMcpServersMock.mockReturnValue({ srv: stdioServer('Srv') });
		resolveServerDefinitionMock.mockRejectedValueOnce(new Error('resolve boom'));
		const provider = new GlmMcpServerProvider(createAuthManager());
		await provider.provideMcpServerDefinitions(token);

		const result = await provider.resolveMcpServerDefinition(
			new vscode.McpStdioServerDefinition('Srv', 'x', [], {}, 'v'),
			token,
		);
		// Error contained: returns undefined (the 'skip this server' signal),
		// does not propagate.
		expect(result).toBeUndefined();
	});
});

describe('GlmMcpServerProvider — change notifications', () => {
	it('notifyChanged fires the onDidChangeMcpServerDefinitions event', () => {
		const provider = new GlmMcpServerProvider(createAuthManager());
		let fired = 0;
		const sub = provider.onDidChangeMcpServerDefinitions(() => {
			fired += 1;
		});
		provider.notifyChanged();
		expect(fired).toBe(1);
		provider.notifyChanged();
		expect(fired).toBe(2);
		sub.dispose();
		provider.notifyChanged();
		expect(fired).toBe(2);
	});
});
