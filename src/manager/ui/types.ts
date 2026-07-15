export type ManagerViewId = 'models' | 'connections' | 'vision';

export type ManagerScopeId = 'global' | 'workspace' | 'workspace-folder';

export type ManagerStatusTone = 'info' | 'success' | 'warning' | 'error';

export type ManagerEndpointPreset =
	| 'china-coding'
	| 'china-standard'
	| 'china-anthropic'
	| 'international-coding'
	| 'international-standard'
	| 'international-anthropic';

export type ManagerModelEndpointRoute = 'default' | 'same-region-standard' | ManagerEndpointPreset;

export type ManagerCredentialChannel =
	| 'china-coding'
	| 'china-standard'
	| 'international-coding'
	| 'international-standard';

export type ManagerVisionMode = 'proxy' | 'native';

export type ManagerVisionProxySource = 'auto' | 'vscode-lm' | 'api-endpoint';

export type ManagerVisionEndpointType =
	| 'openai-chat-completions'
	| 'openai-responses'
	| 'anthropic-messages';

export interface ManagerScopeOption {
	id: ManagerScopeId;
	label: string;
	detail?: string;
}

export interface ManagerSelectOption<T extends string> {
	value: T;
	label: string;
	description?: string;
	disabled?: boolean;
	disabledReason?: string;
}

export interface ManagerStatus {
	label: string;
	tone: ManagerStatusTone;
	detail?: string;
}

export interface ManagerDefaultConnectionState {
	endpoint: ManagerEndpointPreset;
	endpointLabel: string;
	allowedEndpoints: readonly ManagerSelectOption<ManagerEndpointPreset>[];
	resolvedBaseUrl: string;
	protocolLabel: string;
	credentialChannel: ManagerCredentialChannel;
	credentialLabel: string;
	hasApiKey: boolean;
	usesCustomBaseUrl: boolean;
	customBaseUrl?: string;
	valueSourceLabel?: string;
}

export interface ManagerModelDraft {
	name: string;
	apiModelId: string;
	endpointRoute: ManagerModelEndpointRoute;
	visionMode: ManagerVisionMode;
	contextWindowTokens?: number;
	maxOutputTokens?: number;
	toolCalling?: boolean;
	thinking?: boolean;
}

export interface ManagerModelRow {
	id: string;
	name: string;
	apiModelId: string;
	connectionLabel: string;
	visionMode: ManagerVisionMode;
	visionModeLabel: string;
	status: ManagerStatus;
	isCustom: boolean;
	isBuiltInOverride?: boolean;
	canReset?: boolean;
	valueSourceLabel?: string;
	draft: ManagerModelDraft;
	allowedRoutes: readonly ManagerSelectOption<ManagerModelEndpointRoute>[];
}

export interface ManagerNewModelTemplate {
	draft: ManagerModelDraft;
	allowedRoutes: readonly ManagerSelectOption<ManagerModelEndpointRoute>[];
}

export interface ManagerCredentialRow {
	channel: ManagerCredentialChannel;
	label: string;
	description?: string;
	hasApiKey: boolean;
	modelCount: number;
	protocolsLabel?: string;
}

export interface ManagerVisionLanguageModelOption {
	key: string;
	label: string;
	description?: string;
	costDescription?: string;
}

export interface ManagerVisionEndpointState {
	url: string;
	endpointType?: ManagerVisionEndpointType;
	modelId: string;
	hasApiKey: boolean;
	hasCustomHeaders: boolean;
	customHeaderNames: readonly string[];
	extraBodyJson: string;
}

export interface ManagerVisionTestState {
	testId?: number;
	status: 'idle' | 'running' | 'success' | 'error';
	message?: string;
	imageDataUrl?: string;
	response?: string;
}

export interface ManagerVisionState {
	source: ManagerVisionProxySource;
	summaryTitle: string;
	summaryDetail: string;
	lmModels: readonly ManagerVisionLanguageModelOption[];
	selectedLmModelKey?: string;
	endpoint: ManagerVisionEndpointState;
	test: ManagerVisionTestState;
}

export interface ManagerPanelState {
	activeView: ManagerViewId;
	revision: number;
	selectedScope: ManagerScopeId;
	scopes: readonly ManagerScopeOption[];
	defaultConnection: ManagerDefaultConnectionState;
	models: readonly ManagerModelRow[];
	newModelTemplate?: ManagerNewModelTemplate;
	selectedModelId?: string;
	credentials: readonly ManagerCredentialRow[];
	vision: ManagerVisionState;
	busy?: boolean;
	status?: ManagerStatus;
}

export type ManagerWebviewMessage =
	| { type: 'ready' }
	| { type: 'setView'; value: { view: ManagerViewId } }
	| { type: 'setScope'; value: { scope: ManagerScopeId } }
	| { type: 'refresh' }
	| {
			type: 'saveModel';
			value: {
				revision: number;
				scope: ManagerScopeId;
				modelId: string;
				draft: ManagerModelDraft;
			};
	  }
	| {
			type: 'resetModel';
			value: { revision: number; scope: ManagerScopeId; modelId: string };
	  }
	| {
			type: 'createModel';
			value: {
				revision: number;
				scope: ManagerScopeId;
				id: string;
				draft: ManagerModelDraft;
			};
	  }
	| {
			type: 'deleteModel';
			value: { revision: number; scope: ManagerScopeId; modelId: string };
	  }
	| {
			type: 'saveConnection';
			value: {
				revision: number;
				scope: ManagerScopeId;
				endpoint: ManagerEndpointPreset;
				usesCustomBaseUrl: boolean;
				customBaseUrl?: string;
			};
	  }
	| { type: 'setCredentialKey'; value: { channel: ManagerCredentialChannel } }
	| { type: 'clearCredentialKey'; value: { channel: ManagerCredentialChannel } }
	| {
			type: 'openCredentialKeyUrl';
			value: { channel: ManagerCredentialChannel };
	  }
	| {
			type: 'saveVision';
			value: {
				revision: number;
				source: ManagerVisionProxySource;
				lmModelKey?: string;
				endpoint?: {
					url: string;
					endpointType?: ManagerVisionEndpointType;
					modelId: string;
					replacementHeadersJson?: string;
					extraBodyJson: string;
					apiKey?: string;
				};
			};
	  }
	| {
			type: 'testVision';
			value: {
				testId: number;
				source: ManagerVisionProxySource;
				lmModelKey?: string;
				endpoint?: {
					url: string;
					endpointType?: ManagerVisionEndpointType;
					modelId: string;
					replacementHeadersJson?: string;
					extraBodyJson: string;
					apiKey?: string;
				};
			};
	  }
	| { type: 'clearVisionApiKey' }
	| { type: 'showLogs' };

const MANAGER_MESSAGE_TYPES: ReadonlySet<ManagerWebviewMessage['type']> = new Set([
	'ready',
	'setView',
	'setScope',
	'refresh',
	'saveModel',
	'resetModel',
	'createModel',
	'deleteModel',
	'saveConnection',
	'setCredentialKey',
	'clearCredentialKey',
	'openCredentialKeyUrl',
	'saveVision',
	'testVision',
	'clearVisionApiKey',
	'showLogs',
]);

/**
 * Deliberately validates only the message envelope. The host remains responsible
 * for validating and normalizing every payload before changing configuration.
 */
export function isManagerWebviewMessage(value: unknown): value is ManagerWebviewMessage {
	if (typeof value !== 'object' || value === null || !('type' in value)) {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return (
		typeof type === 'string' && MANAGER_MESSAGE_TYPES.has(type as ManagerWebviewMessage['type'])
	);
}

export interface ManagerHostStatusMessage {
	type: 'status';
	value: ManagerStatus;
}

export interface ManagerHostStateMessage {
	type: 'state';
	value: ManagerPanelState;
}

export interface ManagerHostVisionTestMessage {
	type: 'visionTestResult';
	value: ManagerVisionTestState & { testId: number };
}

export type ManagerHostMessage =
	| ManagerHostStatusMessage
	| ManagerHostStateMessage
	| ManagerHostVisionTestMessage;
