import vscode from 'vscode';
import { AuthManager } from '../auth';
import { API_KEY_SECRETS, CONFIG_SECTION } from '../consts';
import { resolveCredentialChannelApiKeyUrl } from '../endpoint';
import { t } from '../i18n';
import { logger } from '../logger';
import { VISION_PROXY_API_KEY_SECRET } from '../provider/vision/sources/endpoint/config';
import type { VisionProxyConfig } from '../provider/vision/types';
import { getActiveWorkspaceFolderResource } from '../workspace';
import {
	buildModelManagerState,
	createManagedModel,
	deleteManagedModel,
	resetManagedModel,
	saveManagedConnection,
	saveManagedModel,
} from './state';
import {
	getModelManagerHtml,
	isManagerWebviewMessage,
	type ManagerPanelState,
	type ManagerScopeId,
	type ManagerStatus,
	type ManagerViewId,
	type ManagerVisionEndpointType,
	type ManagerVisionState,
	type ManagerWebviewMessage,
} from './ui';
import {
	ManagerVisionController,
	type ManagerVisionPayload,
	type ManagerVisionTestView,
} from './vision';

export interface ModelManagerPanelOptions {
	onDidChange: () => void;
}

export class ModelManagerPanel implements vscode.Disposable {
	private readonly auth: AuthManager;
	private readonly vision: ManagerVisionController;
	private panel: vscode.WebviewPanel | undefined;
	private activeView: ManagerViewId = 'models';
	private selectedScope: ManagerScopeId = 'global';
	private revision = 0;
	private busy = false;
	private status: ManagerStatus | undefined;
	private visionTest: ManagerVisionState['test'] = { status: 'idle' };
	private resource: vscode.Uri | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly options: ModelManagerPanelOptions,
	) {
		this.auth = new AuthManager(context);
		this.vision = new ManagerVisionController(context, () => this.notifyChanged());
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration(`${CONFIG_SECTION}.modelManagement`) ||
					event.affectsConfiguration(`${CONFIG_SECTION}.visionModel`)
				) {
					void this.refreshFromExternalChange();
				}
			}),
			context.secrets.onDidChange((event) => {
				if (
					Object.values(API_KEY_SECRETS).includes(event.key) ||
					event.key === VISION_PROXY_API_KEY_SECRET
				) {
					void this.refreshFromExternalChange();
				}
			}),
		);
	}

	open(view: ManagerViewId = 'models'): void {
		this.activeView = view;
		this.resource = getActiveWorkspaceFolderResource();
		if (this.selectedScope === 'workspace-folder' && !this.resource) {
			this.selectedScope = vscode.workspace.workspaceFolders?.length ? 'workspace' : 'global';
		}
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.Active);
			void this.postState();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'glmModelManager',
			t('manager.title'),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: false,
			},
		);
		this.panel = panel;
		panel.onDidDispose(() => {
			this.panel = undefined;
		});
		panel.webview.onDidReceiveMessage((message: unknown) => {
			void this.handleMessage(message);
		});
		void this.renderInitial();
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	private async renderInitial(): Promise<void> {
		if (!this.panel) return;
		try {
			this.panel.webview.html = getModelManagerHtml(this.panel.webview, await this.createState());
		} catch (error) {
			logger.warn('Failed to render GLM model manager', error);
			this.status = toErrorStatus(error);
			await this.postState();
		}
	}

	private async handleMessage(message: unknown): Promise<void> {
		if (!isManagerWebviewMessage(message)) return;
		try {
			switch (message.type) {
				case 'ready':
					await this.postState();
					return;
				case 'setView':
					this.activeView = normalizeView(message.value?.view);
					await this.postState();
					return;
				case 'setScope':
					this.selectedScope = this.normalizeScope(message.value?.scope);
					await this.postState();
					return;
				case 'refresh':
					this.resource = getActiveWorkspaceFolderResource();
					this.revision += 1;
					this.status = undefined;
					await this.postState();
					return;
				case 'setCredentialKey':
					await this.setCredentialKey(message.value?.channel);
					return;
				case 'clearCredentialKey':
					await this.clearCredentialKey(message.value?.channel);
					return;
				case 'openCredentialKeyUrl':
					await this.openCredentialKeyUrl(message.value?.channel);
					return;
				case 'clearVisionApiKey':
					await this.runMutation(async () => this.vision.clearApiKey());
					return;
				case 'showLogs':
					this.vision.showLogs();
					return;
				case 'testVision':
					await this.testVision(message);
					return;
				case 'saveVision':
					await this.runMutation(async () => {
						await this.vision.save(await this.toVisionPayload(message.value));
						this.visionTest = { status: 'idle' };
					});
					return;
				case 'saveModel':
					this.assertCurrentRevision(message.value?.revision);
					await this.runMutation(() =>
						saveManagedModel(
							this.normalizeScope(message.value?.scope),
							this.resource,
							message.value?.modelId,
							message.value?.draft,
						),
					);
					return;
				case 'resetModel':
					this.assertCurrentRevision(message.value?.revision);
					await this.runMutation(() =>
						resetManagedModel(
							this.normalizeScope(message.value?.scope),
							this.resource,
							message.value?.modelId,
						),
					);
					return;
				case 'createModel':
					this.assertCurrentRevision(message.value?.revision);
					await this.runMutation(() =>
						createManagedModel(
							this.normalizeScope(message.value?.scope),
							this.resource,
							message.value?.id,
							message.value?.draft,
						),
					);
					return;
				case 'deleteModel':
					this.assertCurrentRevision(message.value?.revision);
					await this.confirmDeleteModel(message);
					return;
				case 'saveConnection':
					this.assertCurrentRevision(message.value?.revision);
					await this.runMutation(() =>
						saveManagedConnection(
							this.normalizeScope(message.value?.scope),
							this.resource,
							message.value?.endpoint,
							Boolean(message.value?.usesCustomBaseUrl),
							message.value?.customBaseUrl,
						),
					);
			}
		} catch (error) {
			logger.warn(`Model manager action failed: ${message.type}`, error);
			this.busy = false;
			this.status = toErrorStatus(error);
			if (this.status.label === t('manager.error.staleRevision')) {
				await this.postState();
			} else {
				await this.postStatus(this.status);
			}
		}
	}

	private async confirmDeleteModel(
		message: Extract<ManagerWebviewMessage, { type: 'deleteModel' }>,
	): Promise<void> {
		const confirmation = t('manager.action.confirmDelete');
		const selected = await vscode.window.showWarningMessage(
			t('manager.confirm.deleteModel', message.value.modelId),
			{ modal: true },
			confirmation,
		);
		if (selected !== confirmation) return;
		await this.runMutation(() =>
			deleteManagedModel(
				this.normalizeScope(message.value.scope),
				this.resource,
				message.value.modelId,
			),
		);
	}

	private async setCredentialKey(channelValue: unknown): Promise<void> {
		const channel = normalizeCredentialChannel(channelValue);
		const value = await vscode.window.showInputBox({
			prompt: t('auth.promptForChannel', t(`auth.channel.${channel}`)),
			placeHolder: t('auth.placeholder'),
			password: true,
			ignoreFocusOut: true,
			validateInput: (input) => (input.trim() ? undefined : t('auth.emptyValidation')),
		});
		if (!value) return;
		await this.runMutation(() => this.auth.setApiKey(channel, value));
	}

	private async clearCredentialKey(channelValue: unknown): Promise<void> {
		const channel = normalizeCredentialChannel(channelValue);
		const confirmation = t('manager.action.confirmClear');
		const selected = await vscode.window.showWarningMessage(
			t('manager.confirm.clearKey', t(`auth.channel.${channel}`)),
			{ modal: true },
			confirmation,
		);
		if (selected !== confirmation) return;
		await this.runMutation(() => this.auth.deleteApiKey(channel, this.resource));
	}

	private async openCredentialKeyUrl(channelValue: unknown): Promise<void> {
		const channel = normalizeCredentialChannel(channelValue);
		await vscode.env.openExternal(vscode.Uri.parse(resolveCredentialChannelApiKeyUrl(channel)));
	}

	private async testVision(
		message: Extract<ManagerWebviewMessage, { type: 'testVision' }>,
	): Promise<void> {
		const testId = message.value?.testId;
		if (typeof testId !== 'number' || !Number.isSafeInteger(testId) || testId <= 0) {
			throw new Error(t('manager.error.invalidNumber'));
		}
		let testState: ManagerVisionState['test'] & { testId: number } = {
			testId,
			status: 'running',
			message: t('vision.panel.status.testing'),
		};
		this.visionTest = testState;
		this.busy = true;
		try {
			const result = await this.vision.test(await this.toVisionPayload(message.value));
			testState = { testId, ...toVisionTestState(result) };
			this.visionTest = testState;
			this.status = result.ok
				? { label: result.message, tone: 'success' }
				: { label: result.message, tone: 'error' };
		} catch (error) {
			testState = {
				testId,
				status: 'error',
				message: error instanceof Error ? error.message : String(error),
			};
			this.visionTest = testState;
			throw error;
		} finally {
			this.busy = false;
			if (this.panel) {
				await safePostMessage(this.panel, {
					type: 'visionTestResult',
					value: testState,
				});
			}
			if (this.status) await this.postStatus(this.status);
		}
	}

	private async toVisionPayload(value: {
		source?: unknown;
		lmModelKey?: unknown;
		endpoint?: {
			url?: unknown;
			endpointType?: unknown;
			modelId?: unknown;
			replacementHeadersJson?: unknown;
			extraBodyJson?: unknown;
			apiKey?: unknown;
		};
	}): Promise<ManagerVisionPayload> {
		if (value.source !== 'api-endpoint') {
			return { source: value.source, lmModelKey: value.lmModelKey };
		}
		const endpoint = value.endpoint ?? {};
		const current = await this.vision.getState();
		const headers = parseOptionalObject(endpoint.replacementHeadersJson) ?? current.config?.headers;
		const extraBody = parseOptionalObject(endpoint.extraBodyJson);
		return {
			source: 'api-endpoint',
			apiKey: endpoint.apiKey,
			config: {
				...toVisionEndpointType(endpoint.endpointType),
				url: endpoint.url,
				modelId: endpoint.modelId,
				headers,
				extraBody,
				updatedAt: Date.now(),
			},
		};
	}

	private async runMutation(action: () => Promise<void>): Promise<void> {
		this.busy = true;
		this.status = undefined;
		let succeeded = false;
		try {
			await action();
			this.revision += 1;
			this.status = { label: t('manager.status.saved'), tone: 'success' };
			this.notifyChanged();
			succeeded = true;
		} finally {
			this.busy = false;
			if (succeeded) await this.postState();
		}
	}

	private notifyChanged(): void {
		this.options.onDidChange();
	}

	private assertCurrentRevision(value: unknown): void {
		if (typeof value !== 'number' || value !== this.revision) {
			throw new Error(t('manager.error.staleRevision'));
		}
	}

	private normalizeScope(value: unknown): ManagerScopeId {
		if (value === 'global') return value;
		if (
			value === 'workspace' &&
			(vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length)
		) {
			return value;
		}
		if (value === 'workspace-folder' && this.resource) return value;
		return 'global';
	}

	private async createState(): Promise<ManagerPanelState> {
		return buildModelManagerState({
			auth: this.auth,
			scope: this.selectedScope,
			resource: this.resource,
			revision: this.revision,
			activeView: this.activeView,
			vision: await this.createVisionState(),
			status: this.status,
			busy: this.busy,
		});
	}

	private async createVisionState(): Promise<ManagerVisionState> {
		const state = await this.vision.getState();
		const config = state.config;
		return {
			source: state.source,
			summaryTitle: getVisionSummaryTitle(state.source, config, state.hasApiKey),
			summaryDetail: getVisionSummaryDetail(state.source, config, state.hasApiKey),
			lmModels: state.lmModels.map((model) => ({
				key: model.key,
				label: model.label,
				description: model.description,
				...(model.costDescription ? { costDescription: model.costDescription } : {}),
			})),
			selectedLmModelKey: state.selectedLmModelKey,
			endpoint: {
				url: config?.url ?? '',
				endpointType: config ? fromVisionEndpointType(config) : undefined,
				modelId: config?.modelId ?? '',
				hasApiKey: state.hasApiKey,
				hasCustomHeaders: Boolean(config?.headers && Object.keys(config.headers).length > 0),
				customHeaderNames: Object.keys(config?.headers ?? {}),
				extraBodyJson: config?.extraBody ? JSON.stringify(config.extraBody, null, 2) : '',
			},
			test: this.visionTest,
		};
	}

	private async postState(): Promise<void> {
		if (!this.panel) return;
		const state = await this.createState();
		await safePostMessage(this.panel, { type: 'state', value: state });
	}

	private async postStatus(status: ManagerStatus): Promise<void> {
		if (!this.panel) return;
		await safePostMessage(this.panel, { type: 'status', value: status });
	}

	private async refreshFromExternalChange(): Promise<void> {
		if (!this.panel) return;
		this.revision += 1;
		this.status = undefined;
		try {
			await this.postState();
		} catch (error) {
			logger.warn('Failed to refresh GLM model manager after an external change', error);
			this.status = toErrorStatus(error);
			await this.postStatus(this.status);
		}
	}
}

function normalizeView(value: unknown): ManagerViewId {
	return value === 'connections' || value === 'vision' ? value : 'models';
}

function normalizeCredentialChannel(value: unknown): keyof typeof API_KEY_SECRETS {
	if (typeof value === 'string' && value in API_KEY_SECRETS) {
		return value as keyof typeof API_KEY_SECRETS;
	}
	throw new Error(t('manager.error.invalidCredential'));
}

function parseOptionalObject(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== 'string' || !value.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		throw new Error(t('manager.error.invalidJsonObject'));
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(t('manager.error.invalidJsonObject'));
	}
	return parsed as Record<string, unknown>;
}

function toVisionEndpointType(
	value: unknown,
): Pick<VisionProxyConfig, 'providerFamily' | 'apiType'> {
	if (value === 'anthropic-messages') {
		return { providerFamily: 'anthropic-compatible', apiType: 'messages' };
	}
	if (value === 'openai-responses') {
		return { providerFamily: 'openai-compatible', apiType: 'responses' };
	}
	if (value === 'openai-chat-completions') {
		return { providerFamily: 'openai-compatible', apiType: 'chat-completions' };
	}
	throw new Error(t('manager.error.invalidEndpointType'));
}

function fromVisionEndpointType(config: VisionProxyConfig): ManagerVisionEndpointType {
	if (config.providerFamily === 'anthropic-compatible') return 'anthropic-messages';
	return config.apiType === 'responses' ? 'openai-responses' : 'openai-chat-completions';
}

function toVisionTestState(result: ManagerVisionTestView): ManagerVisionState['test'] {
	return {
		status: result.ok ? 'success' : 'error',
		message: result.message,
		...(result.imageDataUrl ? { imageDataUrl: result.imageDataUrl } : {}),
		...(result.response ? { response: result.response } : {}),
	};
}

function getVisionSummaryTitle(
	source: 'auto' | 'vscode-lm' | 'api-endpoint',
	config: VisionProxyConfig | undefined,
	hasApiKey: boolean,
): string {
	if (source === 'auto') return t('vision.panel.summary.auto.title');
	if (source === 'vscode-lm') return t('vision.panel.summary.vscodeLm.title');
	if (!config) return t('vision.panel.summary.apiNotConfigured.title');
	return hasApiKey
		? t('vision.panel.summary.apiEndpoint.title')
		: t('vision.panel.summary.apiNotConfigured.title');
}

function getVisionSummaryDetail(
	source: 'auto' | 'vscode-lm' | 'api-endpoint',
	config: VisionProxyConfig | undefined,
	hasApiKey: boolean,
): string {
	if (source === 'auto') return t('vision.panel.summary.auto.detail');
	if (source === 'vscode-lm') return t('manager.vision.vscodeDetail');
	if (!config) return t('vision.panel.summary.apiNotConfigured.detail');
	return `${config.modelId} · ${config.url} · ${
		hasApiKey ? t('manager.key.configured') : t('manager.key.missing')
	}`;
}

function toErrorStatus(error: unknown): ManagerStatus {
	return {
		label: error instanceof Error ? error.message : String(error),
		tone: 'error',
	};
}

function safePostMessage(panel: vscode.WebviewPanel, payload: unknown): Thenable<boolean> {
	return panel.webview.postMessage(payload).then(
		(value) => value,
		() => false,
	);
}
