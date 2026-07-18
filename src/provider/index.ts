import vscode from 'vscode';
import { AuthManager, CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import {
	getStabilizeToolListEnabled,
	listProviderModels,
	resolveDefaultConnection,
	resolveModelConnection,
} from '../config';
import { API_KEY_SECRETS, CONFIG_SECTION } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { ModelManagerPanel } from '../manager/panel';
import type { CredentialChannel, ResolvedModelConnection } from '../types';
import { getActiveWorkspaceFolderResource } from '../workspace';
import { createCacheDiagnosticsRecorder, dumpProviderInput } from './debug';
import {
	getModelConfigurationResource,
	toChatInfo,
	type ModelPickerChatInformation,
} from './models';
import { getPricingCurrencyForBaseUrl } from './pricing/currency';
import { prepareChatRequest } from './request';
import { classifyProviderRequest } from './routing';
import { resolveConversationSegment } from './segment';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { processToolFlow } from './tools/flow';
import { queryGLMTokenQuotaUsage, type GLMTokenQuotaUsage } from './usage';
import { UsageStatus } from './usage-status';
import { createVisionService } from './vision';

const USAGE_REFRESH_INTERVAL_MS = 60_000;

/**
 * GLM Chat Provider — implements vscode.LanguageModelChatProvider so
 * GLM models appear directly in the Copilot Chat model picker.
 */
export class GLMChatProvider implements vscode.LanguageModelChatProvider<ModelPickerChatInformation> {
	/** [FORK] Exposed so the MCP module can reuse the same API key (BYOK). */
	readonly authManager: AuthManager;
	private readonly globalStorageUri: vscode.Uri;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly cacheDiagnostics = createCacheDiagnosticsRecorder();

	/** Vision proxy: internal bridge + VS Code LM fallback. */
	private readonly vision: ReturnType<typeof createVisionService>;
	private readonly usageStatus = new UsageStatus();
	private readonly modelManager: ModelManagerPanel;
	private readonly usageRefreshPromises = new Map<
		CredentialChannel,
		{ revision: number; promise: Promise<GLMTokenQuotaUsage | undefined> }
	>();
	private readonly lastUsageQuotas = new Map<CredentialChannel, GLMTokenQuotaUsage | undefined>();
	private readonly lastUsageRefreshAt = new Map<CredentialChannel, number>();
	private usageStatusRevision = 0;
	private activeConfigurationResourceKey = getActiveWorkspaceFolderResource()?.toString();

	/**
	 * Adaptive chars-per-token ratio, calibrated from actual usage data.
	 * Updated via exponential moving average each time the API reports real token counts.
	 */
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);
		this.globalStorageUri = context.globalStorageUri;
		this.vision = createVisionService(context, this.authManager);
		this.modelManager = new ModelManagerPanel(context, {
			onDidChange: () => {
				this.vision.reset();
				this.refreshModelPicker();
				this.reloadUsageStatus();
			},
		});

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			this.usageStatus,
			this.modelManager,
			vscode.window.onDidChangeActiveTextEditor(() =>
				this.handleActiveConfigurationResourceChange(),
			),
			vscode.workspace.onDidChangeWorkspaceFolders(() =>
				this.handleActiveConfigurationResourceChange(),
			),
			// Settings-based fallback API key + base URL changes.
			vscode.workspace.onDidChangeConfiguration((e) => {
				const affectsUsageEndpoint =
					e.affectsConfiguration(`${CONFIG_SECTION}.apiKey`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.modelManagement`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.baseUrl`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.endpoint`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.modelEndpointOverrides`);
				if (
					affectsUsageEndpoint ||
					e.affectsConfiguration(`${CONFIG_SECTION}.customModels`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.modelIdOverrides`)
				) {
					this.refreshModelPicker();
				}
				if (affectsUsageEndpoint) {
					this.reloadUsageStatus();
				}
			}),
			// Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
			// When another window sets/clears the API key, refresh this window's
			// model picker so the warning state stays in sync.
			context.secrets.onDidChange((e) => {
				if (Object.values(API_KEY_SECRETS).includes(e.key)) {
					this.refreshModelPicker();
					this.reloadUsageStatus();
				}
			}),
		);

		void this.refreshUsageStatus();
	}

	// ---- Public commands ----

	async configureApiKey(): Promise<void> {
		const channel = await this.pickCredentialChannel('set');
		if (!channel) {
			return;
		}
		const saved = await this.authManager.promptForApiKey(channel);
		if (saved) {
			this.refreshModelPicker();
			this.reloadUsageStatus();
		}
	}

	async clearApiKey(): Promise<void> {
		const channel = await this.pickCredentialChannel('clear');
		if (!channel) {
			return;
		}
		await this.authManager.deleteApiKey(channel, getActiveWorkspaceFolderResource());
		this.refreshModelPicker();
		this.reloadUsageStatus();
		vscode.window.showInformationMessage(
			t('auth.removedForChannel', formatCredentialChannel(channel)),
		);
	}

	async queryUsage(): Promise<void> {
		const usageConnections = await this.collectActiveUsageConnections();
		const codingConnections = [...usageConnections.values()].filter(
			(entry) => entry.connection.apiMode === 'coding-plan',
		);
		if (codingConnections.length === 0) {
			void vscode.window.showWarningMessage(t('usage.notConfigured'));
			return;
		}

		const usageStatusRevision = this.usageStatusRevision;
		const results = await Promise.allSettled(
			codingConnections.map(async ({ connection, apiKey }) => {
				const quota = await this.loadUsageQuota(connection, apiKey, true, usageStatusRevision);
				if (usageStatusRevision === this.usageStatusRevision) {
					if (quota) {
						this.usageStatus.reportQuota(connection.credentialChannel, quota);
					} else {
						this.usageStatus.clearQuota(connection.credentialChannel);
					}
				}
			}),
		);
		if (usageStatusRevision !== this.usageStatusRevision) {
			return;
		}
		const failures = results.filter((result) => result.status === 'rejected');
		if (failures.length === 0) {
			void vscode.window.showInformationMessage(t('usage.querySucceeded'));
		} else if (failures.length < results.length) {
			void vscode.window.showWarningMessage(t('usage.queryPartiallyFailed', failures.length));
		} else {
			const error = failures[0].reason;
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(t('usage.queryFailed', message));
		}
	}

	async hasApiKey(): Promise<boolean> {
		const configurationResource = getActiveWorkspaceFolderResource();
		return this.authManager.hasApiKey(
			resolveDefaultConnection(configurationResource).credentialChannel,
			configurationResource,
		);
	}

	private async pickCredentialChannel(
		action: 'set' | 'clear',
	): Promise<CredentialChannel | undefined> {
		const configurationResource = getActiveWorkspaceFolderResource();
		const defaultChannel = resolveDefaultConnection(configurationResource).credentialChannel;
		const items = await Promise.all(
			CREDENTIAL_CHANNELS.map(async (channel) => {
				const details: string[] = [];
				if (channel === defaultChannel) {
					details.push(t('auth.channel.default'));
				}
				if (await this.authManager.hasApiKey(channel, configurationResource)) {
					details.push(t('auth.channel.configured'));
				}
				return {
					label: formatCredentialChannel(channel),
					description: details.join(' · '),
					channel,
				};
			}),
		);
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: t(`auth.selectChannel.${action}`),
			ignoreFocusOut: true,
		});
		return selected?.channel;
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
		this.modelManager.open('vision');
	}

	manageModels(): void {
		this.modelManager.open('models');
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<ModelPickerChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		const configurationResource = getActiveWorkspaceFolderResource();
		return Promise.all(
			listProviderModels(configurationResource).map(async (model) => {
				try {
					const connection = resolveModelConnection(model.id, configurationResource);
					const hasKey = await this.authManager.hasApiKey(
						connection.credentialChannel,
						configurationResource,
					);
					return toChatInfo(
						model,
						hasKey,
						connection.pricingCurrency ?? getPricingCurrencyForBaseUrl(connection.baseUrl),
						undefined,
						configurationResource,
					);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return toChatInfo(
						model,
						false,
						undefined,
						t('model.connectionInvalid', message),
						configurationResource,
					);
				}
			}),
		);
	}

	async provideLanguageModelChatResponse(
		modelInfo: ModelPickerChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const configurationResource =
			getModelConfigurationResource(modelInfo) ?? getActiveWorkspaceFolderResource();
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
			configurationResource,
			modelInfo,
			segment,
			messages: toolFlow.messages,
			options,
			token,
			cacheDiagnostics: this.cacheDiagnostics,
			getVisionDescriber: () => this.vision.get(configurationResource),
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
						onUsageCost: (estimate) =>
							this.usageStatus.reportBalanceCost(prepared.connection.credentialChannel, estimate),
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

	private reloadUsageStatus(): void {
		this.usageStatusRevision += 1;
		this.usageRefreshPromises.clear();
		this.lastUsageQuotas.clear();
		this.lastUsageRefreshAt.clear();
		this.usageStatus.resetConnections();
		void this.refreshUsageStatus(true);
	}

	private handleActiveConfigurationResourceChange(): void {
		const nextResourceKey = getActiveWorkspaceFolderResource()?.toString();
		if (nextResourceKey === this.activeConfigurationResourceKey) {
			return;
		}
		this.activeConfigurationResourceKey = nextResourceKey;
		this.refreshModelPicker();
		this.reloadUsageStatus();
	}

	private async refreshUsageStatus(force = false): Promise<void> {
		const usageStatusRevision = this.usageStatusRevision;
		const configurationResource = getActiveWorkspaceFolderResource();
		const usageConnections = await this.collectActiveUsageConnections(configurationResource);
		if (usageStatusRevision !== this.usageStatusRevision) {
			return;
		}
		this.usageStatus.setActiveChannels(
			resolveDefaultConnection(configurationResource).credentialChannel,
			[...usageConnections.keys()],
		);

		await Promise.all(
			[...usageConnections.values()].map(async ({ connection, apiKey }) => {
				if (connection.apiMode === 'standard') {
					this.usageStatus.showBalanceBilling(connection.credentialChannel);
					return;
				}
				try {
					const quota = await this.loadUsageQuota(connection, apiKey, force, usageStatusRevision);
					if (usageStatusRevision !== this.usageStatusRevision) {
						return;
					}
					if (quota) {
						this.usageStatus.reportQuota(connection.credentialChannel, quota);
					} else {
						this.usageStatus.clearQuota(connection.credentialChannel);
					}
				} catch (error) {
					logger.warn(
						`Failed to refresh GLM Coding Plan usage status; credentialChannel=${connection.credentialChannel}`,
						error,
					);
				}
			}),
		);
	}

	private loadUsageQuota(
		connection: ResolvedModelConnection,
		apiKey: string,
		force: boolean,
		usageStatusRevision: number,
	): Promise<GLMTokenQuotaUsage | undefined> {
		const now = Date.now();
		const channel = connection.credentialChannel;
		if (
			!force &&
			(this.lastUsageRefreshAt.get(channel) ?? 0) > 0 &&
			now - (this.lastUsageRefreshAt.get(channel) ?? 0) < USAGE_REFRESH_INTERVAL_MS
		) {
			return Promise.resolve(this.lastUsageQuotas.get(channel));
		}
		const inFlight = this.usageRefreshPromises.get(channel);
		if (inFlight && inFlight.revision === usageStatusRevision) {
			return inFlight.promise;
		}

		const refresh = queryGLMTokenQuotaUsage(connection.baseUrl, apiKey).then((quota) => {
			if (usageStatusRevision === this.usageStatusRevision) {
				this.lastUsageQuotas.set(channel, quota);
				this.lastUsageRefreshAt.set(channel, Date.now());
			}
			return quota;
		});
		const trackedRefresh = refresh.finally(() => {
			if (this.usageRefreshPromises.get(channel)?.promise === trackedRefresh) {
				this.usageRefreshPromises.delete(channel);
			}
		});
		this.usageRefreshPromises.set(channel, {
			revision: usageStatusRevision,
			promise: trackedRefresh,
		});
		return trackedRefresh;
	}

	private async collectActiveUsageConnections(
		configurationResource = getActiveWorkspaceFolderResource(),
	): Promise<Map<CredentialChannel, { connection: ResolvedModelConnection; apiKey: string }>> {
		const candidates: ResolvedModelConnection[] = [resolveDefaultConnection(configurationResource)];
		for (const model of listProviderModels(configurationResource)) {
			try {
				candidates.push(resolveModelConnection(model.id, configurationResource));
			} catch {
				// Invalid model routes are surfaced in the model picker/request path.
			}
		}

		const connections = new Map<
			CredentialChannel,
			{ connection: ResolvedModelConnection; apiKey: string }
		>();
		for (const connection of candidates) {
			if (!connection.apiMode || connections.has(connection.credentialChannel)) {
				continue;
			}
			const apiKey = await this.authManager.getApiKey(
				connection.credentialChannel,
				configurationResource,
			);
			if (apiKey) {
				connections.set(connection.credentialChannel, { connection, apiKey });
			}
		}
		return connections;
	}
}

function joinInitialResponseNotices(...notices: (string | undefined)[]): string | undefined {
	const joined = notices.filter((notice) => notice && notice.trim().length > 0).join('\n');
	return joined || undefined;
}
