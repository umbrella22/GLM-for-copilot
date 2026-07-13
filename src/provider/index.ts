import vscode from 'vscode';
import { AuthManager } from '../auth';
import { getBaseUrl, getStabilizeToolListEnabled, listProviderModels } from '../config';
import { API_KEY_SECRET, CONFIG_SECTION } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { createCacheDiagnosticsRecorder, dumpProviderInput } from './debug';
import { toChatInfo } from './models';
import { getPricingCurrencyForBaseUrl } from './pricing/currency';
import { prepareChatRequest } from './request';
import { classifyProviderRequest } from './routing';
import { resolveConversationSegment } from './segment';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { processToolFlow } from './tools/flow';
import {
	queryGLMTokenQuotaUsage,
	supportsGLMBalanceUsage,
	supportsGLMPlanUsage,
	type GLMTokenQuotaUsage,
} from './usage';
import { UsageStatus } from './usage-status';
import { createVisionService } from './vision';

const USAGE_REFRESH_INTERVAL_MS = 60_000;

/**
 * GLM Chat Provider — implements vscode.LanguageModelChatProvider so
 * GLM models appear directly in the Copilot Chat model picker.
 */
export class GLMChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly globalStorageUri: vscode.Uri;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly cacheDiagnostics = createCacheDiagnosticsRecorder();

	/** Vision proxy: internal bridge + VS Code LM fallback. */
	private readonly vision: ReturnType<typeof createVisionService>;
	private readonly usageStatus = new UsageStatus();
	private usageRefreshPromise: Promise<GLMTokenQuotaUsage | undefined> | undefined;
	private usageRefreshRevision = -1;
	private lastUsageQuota: GLMTokenQuotaUsage | undefined;
	private lastUsageRefreshAt = 0;
	private usageStatusRevision = 0;

	/**
	 * Adaptive chars-per-token ratio, calibrated from actual usage data.
	 * Updated via exponential moving average each time the API reports real token counts.
	 */
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);
		this.globalStorageUri = context.globalStorageUri;
		this.vision = createVisionService(context, this.authManager);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			this.usageStatus,
			// Settings-based fallback API key + base URL changes.
			vscode.workspace.onDidChangeConfiguration((e) => {
				const affectsUsageEndpoint =
					e.affectsConfiguration(`${CONFIG_SECTION}.apiKey`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.baseUrl`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.endpoint`);
				if (
					affectsUsageEndpoint ||
					e.affectsConfiguration(`${CONFIG_SECTION}.customModels`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.modelIdOverrides`)
				) {
					this.refreshModelPicker();
				}
				if (affectsUsageEndpoint) {
					this.invalidateUsageStatus();
				}
			}),
			// Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
			// When another window sets/clears the API key, refresh this window's
			// model picker so the warning state stays in sync.
			context.secrets.onDidChange((e) => {
				if (e.key === API_KEY_SECRET) {
					this.refreshModelPicker();
					this.invalidateUsageStatus();
				}
			}),
		);

		void this.refreshUsageStatus();
	}

	// ---- Public commands ----

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.refreshModelPicker();
			this.invalidateUsageStatus();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.refreshModelPicker();
		this.invalidateUsageStatus(false);
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async queryUsage(): Promise<void> {
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			void vscode.window.showWarningMessage(t('usage.notConfigured'));
			return;
		}

		const baseUrl = getBaseUrl();
		if (!supportsGLMPlanUsage(baseUrl)) {
			void vscode.window.showWarningMessage(t('usage.unsupportedBaseUrl'));
			return;
		}

		const usageStatusRevision = this.usageStatusRevision;
		try {
			const quota = await this.loadUsageQuota(baseUrl, apiKey, true, usageStatusRevision);
			if (usageStatusRevision !== this.usageStatusRevision) {
				return;
			}
			if (quota) {
				this.usageStatus.reportQuota(quota);
			} else {
				this.usageStatus.hide();
			}
			void vscode.window.showInformationMessage(t('usage.querySucceeded'));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(t('usage.queryFailed', message));
		}
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	/** Force Copilot Chat to re-query model information (including configurationSchema). */
	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();

		// Force the host to re-pull `provideLanguageModelChatInformation` synchronously
		// before the extension unloads. With `isActive = false` we now return [],
		// which makes Copilot Chat drop GLM models from the picker immediately
		// instead of leaving stale entries behind after deactivate. The returned
		// model list itself is unused — we only call this for its side effect.
		try {
			await vscode.lm.selectChatModels({ vendor: 'glm' });
		} catch (error) {
			logger.warn('Failed to refresh GLM models during deactivate', error);
		}
	}

	async setVisionModel(): Promise<void> {
		await this.vision.openConfiguration();
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		const hasKey = await this.authManager.hasApiKey();
		const pricingCurrency = getPricingCurrencyForBaseUrl(getBaseUrl());
		return listProviderModels().map((model) => toChatInfo(model, hasKey, pricingCurrency));
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const segment = resolveConversationSegment(messages);
		const requestKind = classifyProviderRequest({
			messages,
			tools: options.tools,
		});

		dumpProviderInput({
			globalStorageUri: this.globalStorageUri,
			segment,
			modelInfo,
			messages,
			requestOptions: options,
			requestKind,
		});

		const toolFlow = processToolFlow({
			stabilizeToolList: getStabilizeToolListEnabled(),
			messages,
			tools: options.tools,
			progress,
			requestKind,
		});
		if (toolFlow.preflightHandled) {
			return;
		}

		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			globalStorageUri: this.globalStorageUri,
			modelInfo,
			segment,
			messages: toolFlow.messages,
			options,
			token,
			cacheDiagnostics: this.cacheDiagnostics,
			getVisionDescriber: () => this.vision.get(),
		});

		await streamChatCompletion({
			prepared,
			progress,
			token,
			initialResponseNotice: joinInitialResponseNotices(
				toolFlow.initialResponseNotice,
				prepared.initialResponseNotice,
			),
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
			...(prepared.apiMode === 'standard'
				? {
						onUsageCost: (estimate) => this.usageStatus.reportBalanceCost(estimate),
					}
				: {}),
		});

		void this.refreshUsageStatus();
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}

	private invalidateUsageStatus(refresh = true): void {
		this.usageStatusRevision += 1;
		this.lastUsageQuota = undefined;
		this.lastUsageRefreshAt = 0;
		this.usageStatus.reset();
		if (refresh) {
			void this.refreshUsageStatus(true);
		}
	}

	private async refreshUsageStatus(force = false): Promise<void> {
		const usageStatusRevision = this.usageStatusRevision;
		const apiKey = await this.authManager.getApiKey();
		if (usageStatusRevision !== this.usageStatusRevision) {
			return;
		}
		const baseUrl = getBaseUrl();
		if (!apiKey) {
			this.usageStatus.hide();
			return;
		}
		if (supportsGLMBalanceUsage(baseUrl)) {
			this.usageStatus.showBalanceBilling();
			return;
		}
		if (!supportsGLMPlanUsage(baseUrl)) {
			this.usageStatus.hide();
			return;
		}

		try {
			const quota = await this.loadUsageQuota(baseUrl, apiKey, force, usageStatusRevision);
			if (usageStatusRevision !== this.usageStatusRevision) {
				return;
			}
			if (quota) {
				this.usageStatus.reportQuota(quota);
			} else {
				this.usageStatus.hide();
			}
		} catch (error) {
			logger.warn('Failed to refresh GLM Coding Plan usage status', error);
		}
	}

	private loadUsageQuota(
		baseUrl: string,
		apiKey: string,
		force: boolean,
		usageStatusRevision: number,
	): Promise<GLMTokenQuotaUsage | undefined> {
		const now = Date.now();
		if (
			!force &&
			this.lastUsageRefreshAt > 0 &&
			now - this.lastUsageRefreshAt < USAGE_REFRESH_INTERVAL_MS
		) {
			return Promise.resolve(this.lastUsageQuota);
		}
		if (this.usageRefreshPromise && this.usageRefreshRevision === usageStatusRevision) {
			return this.usageRefreshPromise;
		}

		const refresh = queryGLMTokenQuotaUsage(baseUrl, apiKey).then((quota) => {
			if (usageStatusRevision === this.usageStatusRevision) {
				this.lastUsageQuota = quota;
				this.lastUsageRefreshAt = Date.now();
			}
			return quota;
		});
		const trackedRefresh = refresh.finally(() => {
			if (this.usageRefreshPromise === trackedRefresh) {
				this.usageRefreshPromise = undefined;
				this.usageRefreshRevision = -1;
			}
		});
		this.usageRefreshPromise = trackedRefresh;
		this.usageRefreshRevision = usageStatusRevision;
		return trackedRefresh;
	}
}

function joinInitialResponseNotices(...notices: (string | undefined)[]): string | undefined {
	const joined = notices.filter((notice) => notice && notice.trim().length > 0).join('\n');
	return joined || undefined;
}
