import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCredentialChannel } from '../../src/auth';
import { API_KEY_SECRETS } from '../../src/consts';
import { GLMChatProvider } from '../../src/provider';
import type { UsageCostEstimate } from '../../src/provider/pricing/usage';
import type { UsageStatus } from '../../src/provider/usage-status';
import type { CredentialChannel } from '../../src/types';
import {
	__clearConfigurationValues,
	__getLastStatusBarItem,
	__resetCommandState,
	__setConfigurationValue,
	__setQuickPickSelectionLabel,
	MarkdownString,
} from '../support/vscode.mock';

interface TestProviderInternals {
	usageStatus: UsageStatus;
	refreshUsageStatus(force?: boolean): Promise<void>;
}

const contexts: vscode.ExtensionContext[] = [];

describe('provider credential and usage integration', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
	});

	afterEach(() => {
		for (const context of contexts.splice(0)) {
			for (const disposable of context.subscriptions) disposable.dispose();
		}
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('preserves remaining PAYG session totals after clearing another credential channel', async () => {
		__setConfigurationValue('glm-copilot.endpoint', 'international-standard');
		const { context, secrets } = createContext({
			'international-standard': 'international-key',
			'china-standard': 'china-key',
		});
		const provider = new GLMChatProvider(context);
		const internals = provider as unknown as TestProviderInternals;
		await internals.refreshUsageStatus(true);
		internals.usageStatus.reportBalanceCost('international-standard', createCostEstimate(0.01));
		__setQuickPickSelectionLabel(formatCredentialChannel('china-standard'));

		await provider.clearApiKey();
		await internals.refreshUsageStatus(true);

		expect(secrets.has(API_KEY_SECRETS['china-standard'])).toBe(false);
		const item = __getLastStatusBarItem();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.visible).toBe(true);
		expect(item.text).toBe('$(credit-card) GLM $0.010');
		expect((item.tooltip as MarkdownString).value).toContain('$0.010');
	});

	it('clears a stale Coding Plan quota when a manual refresh has no token limit', async () => {
		__setConfigurationValue('glm-copilot.endpoint', 'china-coding');
		const { context } = createContext({ 'china-coding': 'coding-key' });
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response(JSON.stringify({ data: { limits: [] } }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
				),
			),
		);
		const provider = new GLMChatProvider(context);
		const internals = provider as unknown as TestProviderInternals;
		await internals.refreshUsageStatus(true);
		internals.usageStatus.reportQuota('china-coding', {
			fiveHours: { percentage: 42 },
		});

		await provider.queryUsage();

		const item = __getLastStatusBarItem();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.text).toBe('$(pulse) GLM Coding Plan');
		expect((item.tooltip as MarkdownString).value).toContain(
			'Waiting for Coding Plan usage to refresh.',
		);
	});
});

function createContext(initialKeys: Partial<Record<CredentialChannel, string>>): {
	context: vscode.ExtensionContext;
	secrets: Map<string, string>;
} {
	const secrets = new Map(
		Object.entries(initialKeys).map(([channel, value]) => [
			API_KEY_SECRETS[channel as CredentialChannel],
			value,
		]),
	);
	const secretChanges = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
	const globalValues = new Map<string, unknown>();
	const context = {
		subscriptions: [],
		globalStorageUri: vscode.Uri.file('/tmp/glm-provider-test'),
		globalState: {
			get<T>(key: string): T | undefined {
				return globalValues.get(key) as T | undefined;
			},
			update(key: string, value: unknown): Promise<void> {
				globalValues.set(key, value);
				return Promise.resolve();
			},
		},
		secrets: {
			get(key: string): Promise<string | undefined> {
				return Promise.resolve(secrets.get(key));
			},
			store(key: string, value: string): Promise<void> {
				secrets.set(key, value);
				return Promise.resolve();
			},
			delete(key: string): Promise<void> {
				secrets.delete(key);
				return Promise.resolve();
			},
			onDidChange: secretChanges.event,
		},
	} as unknown as vscode.ExtensionContext;
	contexts.push(context);
	return { context, secrets };
}

function createCostEstimate(totalCost: number): UsageCostEstimate {
	return {
		currency: 'USD',
		modelName: 'GLM Test',
		pricing: {
			cacheHitInput: 0.2,
			cacheMissInput: 1,
			output: 2,
		},
		promptTokens: 100,
		cachedPromptTokens: 20,
		uncachedPromptTokens: 80,
		completionTokens: 10,
		inputCost: totalCost / 2,
		cachedInputCost: totalCost / 10,
		outputCost: (totalCost * 2) / 5,
		totalCost,
	};
}
