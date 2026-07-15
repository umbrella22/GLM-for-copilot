import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelManagerPanel } from '../../src/manager/panel';
import {
	ConfigurationTarget,
	__clearConfigurationValues,
	__emitWebviewMessage,
	__getConfigurationValueAtScope,
	__getLastWebviewPanel,
	__resetCommandState,
	__setConfigurationUpdateFailure,
} from '../support/vscode.mock';

class MemorySecrets {
	private readonly values = new Map<string, string>();
	private changeListener: ((event: { key: string }) => unknown) | undefined;
	private readFailure: Error | undefined;

	async get(key: string): Promise<string | undefined> {
		if (this.readFailure) throw this.readFailure;
		return this.values.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		this.values.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}

	onDidChange(listener: (event: { key: string }) => unknown): vscode.Disposable {
		this.changeListener = listener;
		return {
			dispose: () => {
				if (this.changeListener === listener) this.changeListener = undefined;
			},
		};
	}

	failReadsWith(error: Error): void {
		this.readFailure = error;
	}

	emitDidChange(key: string): void {
		this.changeListener?.({ key });
	}
}

class MemoryMemento {
	private readonly values = new Map<string, unknown>();

	get<T>(key: string): T | undefined {
		return this.values.get(key) as T | undefined;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) this.values.delete(key);
		else this.values.set(key, value);
	}
}

function createContext(secrets = new MemorySecrets()): vscode.ExtensionContext {
	return {
		subscriptions: [],
		secrets,
		globalState: new MemoryMemento(),
	} as unknown as vscode.ExtensionContext;
}

describe('model manager panel', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
	});

	it('renders the unified manager without exposing saved secret values', async () => {
		const context = createContext();
		await context.secrets.store('glm-copilot.apiKey.china-coding', 'super-secret-key');
		const manager = new ModelManagerPanel(context, { onDidChange() {} });

		manager.open();

		await vi.waitFor(() => {
			expect(__getLastWebviewPanel()?.webview.html).toContain('GLM Models &amp; Connections');
		});
		expect(__getLastWebviewPanel()?.webview.html).not.toContain('super-secret-key');
	});

	it('writes connection changes through the canonical configuration', async () => {
		const manager = new ModelManagerPanel(createContext(), {
			onDidChange() {},
		});
		manager.open('connections');

		await __emitWebviewMessage({
			type: 'saveConnection',
			value: {
				revision: 0,
				scope: 'global',
				endpoint: 'international-standard',
				usesCustomBaseUrl: false,
			},
		});

		await vi.waitFor(() => {
			expect(
				__getConfigurationValueAtScope('glm-copilot.modelManagement', ConfigurationTarget.Global),
			).toEqual({
				version: 1,
				defaultConnection: { endpoint: 'international-standard', baseUrl: '' },
			});
		});
	});

	it('reports a failed save without replacing the Webview state', async () => {
		const manager = new ModelManagerPanel(createContext(), {
			onDidChange() {},
		});
		manager.open('connections');
		await vi.waitFor(() => expect(__getLastWebviewPanel()?.webview.html).not.toBe(''));
		const messages = __getLastWebviewPanel()?.webview.postedMessages ?? [];
		messages.length = 0;
		__setConfigurationUpdateFailure(
			'glm-copilot.modelManagement',
			ConfigurationTarget.Global,
			'write failed',
		);

		await __emitWebviewMessage({
			type: 'saveConnection',
			value: {
				revision: 0,
				scope: 'global',
				endpoint: 'china-standard',
				usesCustomBaseUrl: false,
			},
		});

		await vi.waitFor(() => {
			expect(messages.at(-1)).toEqual({
				type: 'status',
				value: { label: 'write failed', tone: 'error' },
			});
		});
		expect(messages.some((message) => (message as { type?: string }).type === 'state')).toBe(false);
	});

	it('reports an external refresh failure as an error status', async () => {
		const secrets = new MemorySecrets();
		const manager = new ModelManagerPanel(createContext(secrets), {
			onDidChange() {},
		});
		manager.open();
		await vi.waitFor(() => expect(__getLastWebviewPanel()?.webview.html).not.toBe(''));
		const messages = __getLastWebviewPanel()?.webview.postedMessages ?? [];
		messages.length = 0;
		secrets.failReadsWith(new Error('secret read failed'));

		secrets.emitDidChange('glm-copilot.apiKey.china-coding');

		await vi.waitFor(() => {
			expect(messages.at(-1)).toEqual({
				type: 'status',
				value: { label: 'secret read failed', tone: 'error' },
			});
		});
		expect(messages.some((message) => (message as { type?: string }).type === 'state')).toBe(false);
	});

	it('maps invalid Vision Proxy JSON syntax to the object validation error', async () => {
		const manager = new ModelManagerPanel(createContext(), {
			onDidChange() {},
		});
		manager.open('vision');
		await vi.waitFor(() => expect(__getLastWebviewPanel()?.webview.html).not.toBe(''));
		const messages = __getLastWebviewPanel()?.webview.postedMessages ?? [];
		messages.length = 0;

		await __emitWebviewMessage({
			type: 'saveVision',
			value: {
				source: 'api-endpoint',
				endpoint: {
					url: 'https://example.com/v1/chat/completions',
					endpointType: 'openai-chat-completions',
					modelId: 'vision-model',
					replacementHeadersJson: '{',
					extraBodyJson: '{}',
				},
			},
		});

		await vi.waitFor(() => {
			expect(messages.at(-1)).toEqual({
				type: 'status',
				value: { label: 'Enter a valid JSON object.', tone: 'error' },
			});
		});
		expect(messages.some((message) => (message as { type?: string }).type === 'state')).toBe(false);
	});

	it('returns Vision Proxy test results incrementally', async () => {
		const manager = new ModelManagerPanel(createContext(), {
			onDidChange() {},
		});
		manager.open('vision');
		await vi.waitFor(() => expect(__getLastWebviewPanel()?.webview.html).not.toBe(''));
		const messages = __getLastWebviewPanel()?.webview.postedMessages ?? [];
		messages.length = 0;

		await __emitWebviewMessage({
			type: 'testVision',
			value: { testId: 1, source: 'auto' },
		});

		await vi.waitFor(() => {
			expect(messages).toContainEqual(
				expect.objectContaining({
					type: 'visionTestResult',
					value: expect.objectContaining({ testId: 1 }),
				}),
			);
		});
		expect(messages.some((message) => (message as { type?: string }).type === 'state')).toBe(false);
	});
});
