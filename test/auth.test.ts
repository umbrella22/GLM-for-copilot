import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthManager, migrateLegacyApiKey } from '../src/auth';
import { API_KEY_SECRET, API_KEY_SECRETS } from '../src/consts';
import {
	__clearConfigurationValues,
	__getConfigurationValueAtScope,
	__resetCommandState,
	__setActiveTextEditorUri,
	__setConfigurationUpdateFailure,
	__setConfigurationValue,
	__setConfigurationValueAtScope,
	__setWorkspaceFolders,
	ConfigurationTarget,
} from './support/vscode.mock';

class MemorySecretStorage {
	readonly values = new Map<string, string>();
	readonly storeFailures = new Set<string>();
	readonly deleteFailures = new Set<string>();

	get(key: string): Promise<string | undefined> {
		return Promise.resolve(this.values.get(key));
	}

	store(key: string, value: string): Promise<void> {
		if (this.storeFailures.has(key)) {
			return Promise.reject(new Error(`Secret store failed: ${key}`));
		}
		this.values.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		if (this.deleteFailures.has(key)) {
			return Promise.reject(new Error(`Secret delete failed: ${key}`));
		}
		this.values.delete(key);
		return Promise.resolve();
	}
}

function createContext(secrets: MemorySecretStorage): vscode.ExtensionContext {
	return { secrets } as unknown as vscode.ExtensionContext;
}

describe('channel API key storage', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
	});

	it('keeps credentials isolated by billing channel', async () => {
		const secrets = new MemorySecretStorage();
		const auth = new AuthManager(createContext(secrets));

		await auth.setApiKey('china-coding', ' coding-key ');
		await auth.setApiKey('china-standard', 'standard-key');

		expect(await auth.getApiKey('china-coding')).toBe('coding-key');
		expect(await auth.getApiKey('china-standard')).toBe('standard-key');
		expect(await auth.getApiKey('international-coding')).toBeUndefined();
		await auth.deleteApiKey('china-coding');
		expect(await auth.getApiKey('china-coding')).toBeUndefined();
		expect(await auth.getApiKey('china-standard')).toBe('standard-key');
	});

	it('uses legacy credentials only for the resource default channel', async () => {
		const folder = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.modelManagement',
			{ version: 1, defaultConnection: { endpoint: 'international-standard' } },
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'folder-settings-key',
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		const secrets = new MemorySecretStorage();
		const auth = new AuthManager(createContext(secrets));

		expect(await auth.getApiKey('international-standard', folder)).toBe('folder-settings-key');
		expect(await auth.hasApiKey('international-standard', folder)).toBe(true);
		expect(await auth.getApiKey('china-coding', folder)).toBeUndefined();

		secrets.values.set(API_KEY_SECRETS['international-standard'], '   ');
		expect(await auth.getApiKey('international-standard', folder)).toBe('folder-settings-key');
		secrets.values.set(API_KEY_SECRETS['international-standard'], 'dedicated-key');
		expect(await auth.getApiKey('international-standard', folder)).toBe('dedicated-key');
	});

	it('migrates the legacy secret to the current default credential channel', async () => {
		const secrets = new MemorySecretStorage();
		secrets.values.set(API_KEY_SECRET, 'legacy-key');
		__setConfigurationValue('glm-copilot.endpoint', 'international-standard');

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.get(API_KEY_SECRETS['international-standard'])).toBe('legacy-key');
		expect(secrets.values.has(API_KEY_SECRET)).toBe(false);
	});

	it('migrates and clears the legacy settings API key', async () => {
		const secrets = new MemorySecretStorage();
		__setConfigurationValue('glm-copilot.apiKey', 'settings-key');

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.get(API_KEY_SECRETS['china-coding'])).toBe('settings-key');
		expect(await new AuthManager(createContext(secrets)).getApiKey('china-coding')).toBe(
			'settings-key',
		);
		expect(
			__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Global),
		).toBeUndefined();
	});

	it('clears only settings scopes that contain the migrated key', async () => {
		const folder = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([folder]);
		__setActiveTextEditorUri(vscode.Uri.file('/workspace/app/file.ts'));
		__setConfigurationValueAtScope('glm-copilot.apiKey', 'global-key', ConfigurationTarget.Global);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'workspace-key',
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'folder-key',
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		const secrets = new MemorySecretStorage();

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.get(API_KEY_SECRETS['china-coding'])).toBe('folder-key');
		expect(__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Global)).toBe(
			'global-key',
		);
		expect(
			__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Workspace),
		).toBe('workspace-key');
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.apiKey',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toBeUndefined();
	});

	it('clears only the effective settings source when duplicate values exist', async () => {
		const folder = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([folder]);
		__setActiveTextEditorUri(vscode.Uri.file('/workspace/app/file.ts'));
		__setConfigurationValueAtScope('glm-copilot.apiKey', 'shared-key', ConfigurationTarget.Global);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'shared-key',
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		const secrets = new MemorySecretStorage();

		await migrateLegacyApiKey(createContext(secrets));

		expect(__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Global)).toBe(
			'shared-key',
		);
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.apiKey',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toBeUndefined();
	});

	it('clears visible legacy fallback credentials for the resource default channel', async () => {
		const folder = vscode.Uri.file('/workspace/app');
		__setWorkspaceFolders([folder]);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'legacy-settings-key',
			ConfigurationTarget.WorkspaceFolder,
			folder,
		);
		const secrets = new MemorySecretStorage();
		secrets.values.set(API_KEY_SECRET, 'legacy-secret');
		secrets.values.set(API_KEY_SECRETS['china-coding'], 'dedicated-key');
		const auth = new AuthManager(createContext(secrets));

		await auth.deleteApiKey('china-coding', folder);

		expect(await auth.getApiKey('china-coding', folder)).toBeUndefined();
		expect(secrets.values.has(API_KEY_SECRET)).toBe(false);
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.apiKey',
				ConfigurationTarget.WorkspaceFolder,
				folder,
			),
		).toBeUndefined();
	});

	it('clears every visible legacy settings source without touching sibling folders', async () => {
		const app = vscode.Uri.file('/workspace/app');
		const docs = vscode.Uri.file('/workspace/docs');
		__setWorkspaceFolders([app, docs]);
		__setConfigurationValueAtScope('glm-copilot.apiKey', 'global-key', ConfigurationTarget.Global);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'workspace-key',
			ConfigurationTarget.Workspace,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'app-key',
			ConfigurationTarget.WorkspaceFolder,
			app,
		);
		__setConfigurationValueAtScope(
			'glm-copilot.apiKey',
			'docs-key',
			ConfigurationTarget.WorkspaceFolder,
			docs,
		);
		const secrets = new MemorySecretStorage();
		secrets.values.set(API_KEY_SECRET, 'legacy-secret');
		secrets.values.set(API_KEY_SECRETS['china-coding'], 'dedicated-key');
		const auth = new AuthManager(createContext(secrets));

		await auth.deleteApiKey('china-coding', app);

		expect(await auth.getApiKey('china-coding', app)).toBeUndefined();
		expect(
			__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Global),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Workspace),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.apiKey',
				ConfigurationTarget.WorkspaceFolder,
				app,
			),
		).toBeUndefined();
		expect(
			__getConfigurationValueAtScope(
				'glm-copilot.apiKey',
				ConfigurationTarget.WorkspaceFolder,
				docs,
			),
		).toBe('docs-key');
		expect(secrets.values.has(API_KEY_SECRET)).toBe(false);
	});

	it('preserves both values when a dedicated channel already has a different key', async () => {
		const secrets = new MemorySecretStorage();
		secrets.values.set(API_KEY_SECRET, 'legacy-key');
		secrets.values.set(API_KEY_SECRETS['china-coding'], 'dedicated-key');

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.get(API_KEY_SECRET)).toBe('legacy-key');
		expect(secrets.values.get(API_KEY_SECRETS['china-coding'])).toBe('dedicated-key');
	});

	it('preserves legacy fallback credentials when the channel secret store fails', async () => {
		const secrets = new MemorySecretStorage();
		secrets.values.set(API_KEY_SECRET, 'legacy-key');
		secrets.storeFailures.add(API_KEY_SECRETS['china-coding']);

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.has(API_KEY_SECRETS['china-coding'])).toBe(false);
		expect(secrets.values.get(API_KEY_SECRET)).toBe('legacy-key');
		expect(await new AuthManager(createContext(secrets)).getApiKey('china-coding')).toBe(
			'legacy-key',
		);
	});

	it('keeps the migrated channel active when legacy secret deletion fails', async () => {
		const secrets = new MemorySecretStorage();
		secrets.values.set(API_KEY_SECRET, 'legacy-key');
		secrets.deleteFailures.add(API_KEY_SECRET);

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.get(API_KEY_SECRETS['china-coding'])).toBe('legacy-key');
		expect(secrets.values.get(API_KEY_SECRET)).toBe('legacy-key');
		expect(await new AuthManager(createContext(secrets)).getApiKey('china-coding')).toBe(
			'legacy-key',
		);
	});

	it('keeps the migrated channel active when settings cleanup fails', async () => {
		const secrets = new MemorySecretStorage();
		__setConfigurationValue('glm-copilot.apiKey', 'settings-key');
		__setConfigurationUpdateFailure('glm-copilot.apiKey', ConfigurationTarget.Global);

		await migrateLegacyApiKey(createContext(secrets));

		expect(secrets.values.get(API_KEY_SECRETS['china-coding'])).toBe('settings-key');
		expect(__getConfigurationValueAtScope('glm-copilot.apiKey', ConfigurationTarget.Global)).toBe(
			'settings-key',
		);
		expect(await new AuthManager(createContext(secrets)).getApiKey('china-coding')).toBe(
			'settings-key',
		);
	});
});
