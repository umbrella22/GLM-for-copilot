import type vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import {
	formatVisionProxyDisplayMessage,
	getVisionProxyErrorDisplayCode,
	isVisionProxyError,
} from '../provider/vision/protocols/errors';
import {
	VisionProxyConfigStore,
	normalizeVisionProxyConfig,
	normalizeVisionProxySource,
} from '../provider/vision/sources/endpoint/config';
import {
	testVisionProxyConnection,
	type VisionProxyTestResult,
} from '../provider/vision/sources/endpoint/test';
import {
	getConfiguredVisionModelKey,
	listVSCodeVisionModelOptions,
	pickPreferredVSCodeVisionModelKey,
	saveVSCodeVisionModelKey,
} from '../provider/vision/sources/vscode';
import { logVisionProxyTestFailed, showVisionLogs } from '../provider/vision/log';
import type {
	VisionLanguageModelOption,
	VisionProxyConfig,
	VisionProxySource,
} from '../provider/vision/types';

export interface ManagerVisionState {
	source: VisionProxySource;
	config?: VisionProxyConfig;
	hasApiKey: boolean;
	lmModels: VisionLanguageModelOption[];
	selectedLmModelKey?: string;
}

export interface ManagerVisionPayload {
	source?: unknown;
	config?: unknown;
	apiKey?: unknown;
	lmModelKey?: unknown;
}

export interface ManagerVisionTestView {
	ok: boolean;
	message: string;
	imageDataUrl?: string;
	response?: string;
}

export class ManagerVisionController {
	private readonly store: VisionProxyConfigStore;

	constructor(
		context: vscode.ExtensionContext,
		private readonly onDidChange: () => void,
	) {
		this.store = new VisionProxyConfigStore(context);
	}

	async getState(): Promise<ManagerVisionState> {
		const lmModels = await listVSCodeVisionModelOptions();
		const config = this.getConfig();
		return {
			source: this.getSource(config),
			config,
			hasApiKey: await this.store.hasApiKey(),
			lmModels,
			selectedLmModelKey: pickPreferredVSCodeVisionModelKey(
				lmModels,
				getConfiguredVisionModelKey(),
			),
		};
	}

	async save(value: ManagerVisionPayload): Promise<void> {
		const source = normalizeVisionProxySource(value.source) ?? 'auto';
		if (source === 'auto') {
			await this.store.saveSource(source);
		} else if (source === 'vscode-lm') {
			const modelKey = getRequiredString(value.lmModelKey, t('vision.panel.field.visionModel'));
			await saveVSCodeVisionModelKey(modelKey);
			await this.store.saveSource(source);
		} else {
			const config = normalizeVisionProxyConfig(value.config);
			await this.store.saveConfig(config);
			await this.store.saveSource(source);
			const apiKey = getOptionalString(value.apiKey);
			if (apiKey) {
				await this.store.setApiKey(apiKey);
			}
		}
		this.onDidChange();
	}

	async clearApiKey(): Promise<void> {
		await this.store.deleteApiKey();
		this.onDidChange();
	}

	async test(value: ManagerVisionPayload): Promise<ManagerVisionTestView> {
		const source = normalizeVisionProxySource(value.source) ?? 'auto';
		if (source === 'auto') {
			return { ok: true, message: t('vision.panel.status.autoSelected') };
		}
		if (source === 'vscode-lm') {
			return { ok: true, message: t('vision.panel.status.vscodeLmNoHttpTest') };
		}

		try {
			const config = normalizeVisionProxyConfig(value.config);
			const apiKey = getOptionalString(value.apiKey) || (await this.store.getApiKey());
			return formatTestResult(await testVisionProxyConnection(config, apiKey));
		} catch (error) {
			logVisionProxyTestFailed(error);
			return { ok: false, message: formatVisionError(error) };
		}
	}

	showLogs(): void {
		showVisionLogs();
	}

	private getConfig(): VisionProxyConfig | undefined {
		try {
			return this.store.getConfig();
		} catch (error) {
			logger.warn('Ignoring invalid saved vision proxy configuration in model manager', error);
			return undefined;
		}
	}

	private getSource(config: VisionProxyConfig | undefined): VisionProxySource {
		return this.store.getSource() ?? (config ? 'api-endpoint' : 'auto');
	}
}

function formatTestResult(result: VisionProxyTestResult): ManagerVisionTestView {
	if (!result.ok) {
		return {
			ok: false,
			message: formatVisionProxyDisplayMessage(
				result.errorCode ?? 'UNKNOWN',
				result.message ?? t('vision.proxy.error.testFailed'),
			),
		};
	}
	return {
		ok: true,
		message: t('vision.panel.status.testSucceeded'),
		...(result.imageDataUrl ? { imageDataUrl: result.imageDataUrl } : {}),
		...(result.response ? { response: result.response } : {}),
	};
}

function formatVisionError(error: unknown): string {
	if (isVisionProxyError(error)) {
		return formatVisionProxyDisplayMessage(getVisionProxyErrorDisplayCode(error), error.message);
	}
	return formatVisionProxyDisplayMessage(
		getVisionProxyErrorDisplayCode(error),
		error instanceof Error ? error.message : String(error),
	);
}

function getRequiredString(value: unknown, label: string): string {
	const normalized = getOptionalString(value);
	if (!normalized) {
		throw new Error(t('vision.panel.error.required', label));
	}
	return normalized;
}

function getOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
