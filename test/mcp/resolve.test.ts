import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { AuthManager } from '../../src/auth';
import type { CredentialChannel } from '../../src/types';
import type { BuiltServer } from '../../src/mcp/build';
import { resolveServerDefinition, resolveServerCredentialChannel } from '../../src/mcp/resolve';
import type { McpServerConfig } from '../../src/mcp/types';

// Mock resolveDefaultConnection so credential-channel resolution for
// user-defined servers can be tested without setting up the full
// modelManagement configuration chain. Each test sets the mock's return value
// to simulate a different workspace default connection.
const mockResolveDefaultConnection = vi.fn(
	(_resource?: vscode.Uri): { credentialChannel: CredentialChannel } => ({
		credentialChannel: 'china-coding',
	}),
);
vi.mock('../../src/config', () => ({
	resolveDefaultConnection: (...args: unknown[]) => mockResolveDefaultConnection(...args),
}));

// Minimal AuthManager stub: returns whatever the test configured for a given
// channel. Tests set per-channel keys to exercise the "key present" / "key
// absent" branches.
function createAuthManager(keys: Partial<Record<CredentialChannel, string>>): AuthManager {
	return {
		async getApiKey(channel: CredentialChannel): Promise<string | undefined> {
			return keys[channel];
		},
	} as unknown as AuthManager;
}

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
} as vscode.CancellationToken;

/** Build a stdio BuiltServer the way buildServerDefinitions would. */
function builtStdio(configOverrides: Partial<McpServerConfig> = {}, id = 'srv'): BuiltServer {
	const config: McpServerConfig = {
		type: 'stdio',
		label: 'Test Stdio',
		command: 'npx',
		args: ['-y', 'pkg'],
		...configOverrides,
	};
	const definition = new vscode.McpStdioServerDefinition(
		config.label,
		config.command!,
		config.args ?? [],
		{ EXISTING: 'preserved' },
		'v1',
	);
	return { id, config, definition };
}

/** Build an http BuiltServer the way buildServerDefinitions would. */
function builtHttp(configOverrides: Partial<McpServerConfig> = {}, id = 'srv'): BuiltServer {
	const config: McpServerConfig = {
		type: 'http',
		label: 'Test HTTP',
		url: 'https://example.com/mcp',
		...configOverrides,
	};
	const definition = new vscode.McpHttpServerDefinition(
		config.label,
		vscode.Uri.parse(config.url!),
		{ 'X-Existing': 'kept' },
		config.url,
	);
	return { id, config, definition };
}

describe('resolveServerCredentialChannel (PR #14 review #3)', () => {
	beforeEach(() => {
		mockResolveDefaultConnection.mockClear();
	});

	it('returns the explicit per-server channel when set', () => {
		const config = builtStdio({ credentialChannel: 'international-coding' }).config;
		expect(resolveServerCredentialChannel(config)).toBe('international-coding');
	});

	it('falls back to the workspace default channel when channel is omitted', () => {
		mockResolveDefaultConnection.mockReturnValueOnce({
			credentialChannel: 'international-standard',
		});
		const config = builtStdio().config; // no credentialChannel
		expect(resolveServerCredentialChannel(config)).toBe('international-standard');
	});

	it('falls back to china-coding when that is the workspace default', () => {
		mockResolveDefaultConnection.mockReturnValueOnce({ credentialChannel: 'china-coding' });
		const config = builtHttp().config;
		expect(resolveServerCredentialChannel(config)).toBe('china-coding');
	});

	it('forwards the resource to resolveDefaultConnection for multi-root correctness', () => {
		mockResolveDefaultConnection.mockReturnValueOnce({ credentialChannel: 'china-coding' });
		const resource = vscode.Uri.file('/workspace/folder-a');
		resolveServerCredentialChannel(builtStdio().config, resource);
		expect(mockResolveDefaultConnection).toHaveBeenCalledWith(resource);
	});

	it('does not call resolveDefaultConnection when an explicit channel is pinned', () => {
		const config = builtStdio({ credentialChannel: 'china-anthropic' }).config;
		resolveServerCredentialChannel(config);
		expect(mockResolveDefaultConnection).not.toHaveBeenCalled();
	});
});

describe('resolveServerDefinition — injection opt-in (PR #14 review #2)', () => {
	beforeEach(() => {
		mockResolveDefaultConnection.mockReset();
		mockResolveDefaultConnection.mockReturnValue({ credentialChannel: 'china-coding' });
	});

	it('returns the definition unchanged when injectApiKey is not set', async () => {
		const built = builtStdio(); // injectApiKey undefined
		const auth = createAuthManager({ 'china-coding': 'secret-key' });
		const result = await resolveServerDefinition(built, auth, token);
		expect(result).toBe(built.definition);
		// env untouched: no key injected
		expect((result as vscode.McpStdioServerDefinition).env).toEqual({ EXISTING: 'preserved' });
	});

	it('returns the definition unchanged when injectApiKey is explicitly false', async () => {
		const built = builtStdio({ injectApiKey: false });
		const auth = createAuthManager({ 'china-coding': 'secret-key' });
		const result = await resolveServerDefinition(built, auth, token);
		expect(result).toBe(built.definition);
		expect((result as vscode.McpStdioServerDefinition).env).toEqual({ EXISTING: 'preserved' });
	});

	it('does not touch http headers when injectApiKey is not set', async () => {
		const built = builtHttp(); // injectApiKey undefined
		const auth = createAuthManager({ 'china-coding': 'secret-key' });
		const result = await resolveServerDefinition(built, auth, token);
		expect((result as vscode.McpHttpServerDefinition).headers).toEqual({ 'X-Existing': 'kept' });
	});
});

describe('resolveServerDefinition — stdio key injection', () => {
	beforeEach(() => {
		mockResolveDefaultConnection.mockReset();
		mockResolveDefaultConnection.mockReturnValue({ credentialChannel: 'china-coding' });
	});

	it('injects the key into env[Z_AI_API_KEY] when opted in and key present', async () => {
		const built = builtStdio({ injectApiKey: true, credentialChannel: 'china-coding' });
		const auth = createAuthManager({ 'china-coding': 'my-secret' });
		const result = (await resolveServerDefinition(
			built,
			auth,
			token,
		)) as vscode.McpStdioServerDefinition;
		expect(result.env['Z_AI_API_KEY']).toBe('my-secret');
		// Existing env preserved
		expect(result.env.EXISTING).toBe('preserved');
	});

	it('uses a custom authEnvKey when configured', async () => {
		const built = builtStdio({
			injectApiKey: true,
			credentialChannel: 'china-coding',
			authEnvKey: 'ANTHROPIC_API_KEY',
		});
		const auth = createAuthManager({ 'china-coding': 'key123' });
		const result = (await resolveServerDefinition(
			built,
			auth,
			token,
		)) as vscode.McpStdioServerDefinition;
		expect(result.env['ANTHROPIC_API_KEY']).toBe('key123');
		// Default key NOT also written
		expect(result.env['Z_AI_API_KEY']).toBeUndefined();
	});

	it('returns undefined when opted in but no key is configured for the channel', async () => {
		const built = builtStdio({ injectApiKey: true, credentialChannel: 'china-coding' });
		const auth = createAuthManager({}); // no key for any channel
		const result = await resolveServerDefinition(built, auth, token);
		expect(result).toBeUndefined();
	});

	it('returns undefined when the key exists on a different channel than the one pinned', async () => {
		const built = builtStdio({ injectApiKey: true, credentialChannel: 'china-coding' });
		// Key exists for international-coding only — the pinned china-coding has none.
		const auth = createAuthManager({ 'international-coding': 'wrong-channel-key' });
		const result = await resolveServerDefinition(built, auth, token);
		expect(result).toBeUndefined();
	});
});

describe('resolveServerDefinition — http key injection', () => {
	beforeEach(() => {
		mockResolveDefaultConnection.mockReset();
		mockResolveDefaultConnection.mockReturnValue({ credentialChannel: 'china-coding' });
	});

	it('injects Authorization: Bearer header when opted in and key present', async () => {
		const built = builtHttp({ injectApiKey: true, credentialChannel: 'china-coding' });
		const auth = createAuthManager({ 'china-coding': 'bearer-token' });
		const result = (await resolveServerDefinition(
			built,
			auth,
			token,
		)) as vscode.McpHttpServerDefinition;
		expect(result.headers.Authorization).toBe('Bearer bearer-token');
		// Existing header preserved
		expect(result.headers['X-Existing']).toBe('kept');
	});

	it('returns undefined when opted in but no key is configured', async () => {
		const built = builtHttp({ injectApiKey: true, credentialChannel: 'china-coding' });
		const auth = createAuthManager({});
		const result = await resolveServerDefinition(built, auth, token);
		expect(result).toBeUndefined();
	});
});

describe('resolveServerDefinition — credential channel fallback (PR #14 review #3)', () => {
	it('reads the key from the workspace default channel when per-server channel is omitted', async () => {
		// Simulate an international user: workspace default is international-coding,
		// the key is stored under that channel, and the server does NOT pin a channel.
		mockResolveDefaultConnection.mockReturnValueOnce({
			credentialChannel: 'international-coding',
		});
		const built = builtStdio({ injectApiKey: true }); // no credentialChannel
		const auth = createAuthManager({ 'international-coding': 'intl-key' });
		const result = (await resolveServerDefinition(
			built,
			auth,
			token,
		)) as vscode.McpStdioServerDefinition;
		expect(result.env['Z_AI_API_KEY']).toBe('intl-key');
	});

	it('built-in-style pinned china-coding server ignores the workspace default channel', async () => {
		// Workspace is international, but a china-coding-pinned server should still
		// read from china-coding (this is the built-in GLM official server contract).
		mockResolveDefaultConnection.mockReturnValueOnce({
			credentialChannel: 'international-coding',
		});
		const built = builtStdio({ injectApiKey: true, credentialChannel: 'china-coding' });
		// Key exists for both channels; china-coding must win because it's pinned.
		const auth = createAuthManager({
			'china-coding': 'cn-key',
			'international-coding': 'intl-key',
		});
		const result = (await resolveServerDefinition(
			built,
			auth,
			token,
		)) as vscode.McpStdioServerDefinition;
		expect(result.env['Z_AI_API_KEY']).toBe('cn-key');
	});
});
