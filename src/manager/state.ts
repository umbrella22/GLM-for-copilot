import vscode from 'vscode';
import { AuthManager, CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import {
	findModelDefinition,
	getApiModelId,
	getBaseUrlOverride,
	getCustomModels,
	getEndpoint,
	getModelEndpointRoute,
	getModelVisionMode,
	inspectEffectiveModelManagementConfiguration,
	inspectModelManagementConfiguration,
	listProviderModels,
	normalizeEndpointPreset,
	resolveDefaultConnection,
	resolveModelConnection,
	saveModelManagementConfiguration,
} from '../config';
import { CONFIG_SECTION, MODELS } from '../consts';
import { resolveEndpointApiMode, resolveEndpointBaseUrl } from '../endpoint';
import { t } from '../i18n';
import type {
	CustomModelConfig,
	EndpointPreset,
	ModelDefinition,
	ModelEndpointRoute,
	ModelManagementConfigurationV1,
	ModelManagementModelConfiguration,
} from '../types';
import type {
	ManagerCredentialRow,
	ManagerDefaultConnectionState,
	ManagerModelDraft,
	ManagerModelRow,
	ManagerNewModelTemplate,
	ManagerPanelState,
	ManagerScopeId,
	ManagerScopeOption,
	ManagerSelectOption,
	ManagerVisionState,
	ManagerViewId,
} from './ui';

const ENDPOINTS: readonly EndpointPreset[] = [
	'china-coding',
	'china-standard',
	'china-anthropic',
	'international-coding',
	'international-standard',
	'international-anthropic',
];

const ALL_MODEL_ROUTES: readonly ModelEndpointRoute[] = [
	'default',
	'same-region-standard',
	...ENDPOINTS,
];

const STANDARD_ONLY_ROUTES: readonly ModelEndpointRoute[] = [
	'same-region-standard',
	'china-standard',
	'international-standard',
];

export interface ModelManagerStateOptions {
	auth: AuthManager;
	scope: ManagerScopeId;
	resource?: vscode.Uri;
	revision: number;
	activeView: ManagerViewId;
	selectedModelId?: string;
	vision: ManagerVisionState;
	status?: ManagerPanelState['status'];
	busy?: boolean;
}

export async function buildModelManagerState(
	options: ModelManagerStateOptions,
): Promise<ManagerPanelState> {
	const resource = options.resource;
	const models = listProviderModels(resource);
	const modelRows = await Promise.all(
		models.map((model) => buildModelRow(model, options.auth, options.scope, resource)),
	);
	const defaultConnection = await buildDefaultConnection(options.auth, resource);
	const credentials = await buildCredentialRows(options.auth, models, resource);
	const selectedModelId = modelRows.some((row) => row.id === options.selectedModelId)
		? options.selectedModelId
		: undefined;

	return {
		activeView: options.activeView,
		revision: options.revision,
		selectedScope: options.scope,
		scopes: getScopeOptions(options.resource),
		defaultConnection,
		models: modelRows,
		newModelTemplate: createNewModelTemplate(),
		selectedModelId,
		credentials,
		vision: options.vision,
		...(options.status ? { status: options.status } : {}),
		...(options.busy ? { busy: true } : {}),
	};
}

export async function saveManagedModel(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	modelId: string,
	draft: ManagerModelDraft,
): Promise<void> {
	const id = requireCanonicalModelId(modelId);
	const model = findModelDefinition(id, resource);
	if (!model) {
		throw new Error(t('manager.error.modelNotFound', id));
	}
	validateDraft(draft, model, resource);
	const apiModelId = requireCanonicalModelId(draft.apiModelId);
	const effectiveApiModelId = getApiModelId(id, resource);
	const effectiveEndpointRoute = getModelEndpointRoute(id, resource);
	const effectiveVisionMode = getModelVisionMode(id, resource);
	const raw = getScopeConfiguration(scope, resource);
	const currentProfile = raw.models?.[id];
	const nextProfile: ModelManagementModelConfiguration = { ...currentProfile };
	if (
		hasOwnModelConfigurationField(currentProfile, 'apiModelId') ||
		apiModelId !== effectiveApiModelId
	) {
		nextProfile.apiModelId = apiModelId;
	}
	if (
		hasOwnModelConfigurationField(currentProfile, 'endpointRoute') ||
		draft.endpointRoute !== effectiveEndpointRoute
	) {
		nextProfile.endpointRoute = draft.endpointRoute;
	}
	if (
		hasOwnModelConfigurationField(currentProfile, 'visionMode') ||
		draft.visionMode !== effectiveVisionMode
	) {
		nextProfile.visionMode = draft.visionMode;
	}
	if (Object.keys(nextProfile).length > 0) {
		raw.models ??= createModelIdRecord<ModelManagementModelConfiguration>();
		raw.models[id] = nextProfile;
	}

	if (isCustomModel(id, resource)) {
		raw.customModels ??= createModelIdRecord<CustomModelConfig | null>();
		raw.customModels[id] = toCustomModelConfiguration(id, draft);
	}
	await saveScopeConfiguration(scope, resource, raw);
}

export async function createManagedModel(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	modelId: string,
	draft: ManagerModelDraft,
): Promise<void> {
	const id = requireCanonicalModelId(modelId);
	if (findModelDefinition(id, resource)) {
		throw new Error(t('manager.error.modelExists', id));
	}
	validateDraft(draft, undefined, resource);
	const raw = getScopeConfiguration(scope, resource);
	raw.customModels ??= createModelIdRecord<CustomModelConfig | null>();
	raw.customModels[id] = toCustomModelConfiguration(id, draft);
	raw.models ??= createModelIdRecord<ModelManagementModelConfiguration>();
	raw.models[id] = {
		apiModelId: requireCanonicalModelId(draft.apiModelId),
		endpointRoute: draft.endpointRoute,
		visionMode: draft.visionMode,
	};
	await saveScopeConfiguration(scope, resource, raw);
}

export async function resetManagedModel(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	modelId: string,
): Promise<void> {
	await clearLegacyModelOverridesAtScope(scope, resource, modelId);
	const raw = getScopeConfiguration(scope, resource);
	const resetCustomDefinition =
		hasOwnCustomModel(raw, modelId) &&
		(isBuiltInModel(modelId) || hasParentCustomModel(scope, resource, modelId));
	if (raw.models) {
		delete raw.models[modelId];
		if (Object.keys(raw.models).length === 0) delete raw.models;
	}
	if (resetCustomDefinition && raw.customModels) {
		delete raw.customModels[modelId];
		if (Object.keys(raw.customModels).length === 0) delete raw.customModels;
	}
	await saveScopeConfiguration(scope, resource, raw);
}

export async function deleteManagedModel(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	modelId: string,
): Promise<void> {
	if (!isCustomModel(modelId, resource)) {
		throw new Error(t('manager.error.builtInDelete'));
	}
	const raw = getScopeConfiguration(scope, resource);
	raw.customModels ??= createModelIdRecord<CustomModelConfig | null>();
	raw.customModels[modelId] = null;
	if (raw.models) {
		delete raw.models[modelId];
		if (Object.keys(raw.models).length === 0) delete raw.models;
	}
	await saveScopeConfiguration(scope, resource, raw);
}

export async function saveManagedConnection(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	endpointValue: unknown,
	usesCustomBaseUrl: boolean,
	customBaseUrl: unknown,
): Promise<void> {
	const endpoint = normalizeEndpointPreset(endpointValue);
	if (!endpoint) {
		throw new Error(t('manager.error.invalidEndpoint'));
	}
	const baseUrl = usesCustomBaseUrl ? validateBaseUrl(customBaseUrl) : '';
	const raw = getScopeConfiguration(scope, resource);
	raw.defaultConnection = { endpoint, baseUrl };
	await saveScopeConfiguration(scope, resource, raw);
}

function getScopeOptions(resource: vscode.Uri | undefined): ManagerScopeOption[] {
	const scopes: ManagerScopeOption[] = [{ id: 'global', label: t('manager.scope.global') }];
	if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
		scopes.push({ id: 'workspace', label: t('manager.scope.workspace') });
	}
	if (resource && vscode.workspace.getWorkspaceFolder(resource)) {
		scopes.push({
			id: 'workspace-folder',
			label: t('manager.scope.workspaceFolder'),
			detail: vscode.workspace.getWorkspaceFolder(resource)?.name,
		});
	}
	return scopes;
}

async function buildDefaultConnection(
	auth: AuthManager,
	resource?: vscode.Uri,
): Promise<ManagerDefaultConnectionState> {
	const connection = resolveDefaultConnection(resource);
	const customBaseUrl = getBaseUrlOverride(resource);
	return {
		endpoint: connection.endpoint,
		endpointLabel: formatEndpoint(connection.endpoint),
		allowedEndpoints: ENDPOINTS.map((endpoint) => ({
			value: endpoint,
			label: formatEndpoint(endpoint),
			description: resolveEndpointBaseUrl(endpoint),
		})),
		resolvedBaseUrl: connection.baseUrl,
		protocolLabel: formatProtocol(connection.protocol),
		credentialChannel: connection.credentialChannel,
		credentialLabel: formatCredentialChannel(connection.credentialChannel),
		hasApiKey: await auth.hasApiKey(connection.credentialChannel, resource),
		usesCustomBaseUrl: connection.usesGlobalBaseUrlOverride,
		...(connection.usesGlobalBaseUrlOverride && customBaseUrl
			? { customBaseUrl: customBaseUrl.trim() }
			: {}),
		valueSourceLabel: getDefaultConnectionSource(resource),
	};
}

async function buildModelRow(
	model: ModelDefinition,
	auth: AuthManager,
	scope: ManagerScopeId,
	resource?: vscode.Uri,
): Promise<ManagerModelRow> {
	const custom = getCustomModelDefinition(model.id, resource);
	const endpointRoute = getModelEndpointRoute(model.id, resource);
	const visionMode = getModelVisionMode(model.id, resource);
	let connectionLabel = formatRoute(endpointRoute);
	let status: ManagerModelRow['status'];
	try {
		const connection = resolveModelConnection(model.id, resource);
		connectionLabel = `${formatRoute(endpointRoute)} · ${formatEndpoint(connection.endpoint)}`;
		status = (await auth.hasApiKey(connection.credentialChannel, resource))
			? { label: t('manager.status.ready'), tone: 'success' }
			: {
					label: t('manager.key.missing'),
					tone: 'warning',
					detail: formatCredentialChannel(connection.credentialChannel),
				};
	} catch (error) {
		status = {
			label: t('manager.status.invalid'),
			tone: 'error',
			detail: error instanceof Error ? error.message : String(error),
		};
	}

	const raw = getScopeConfiguration(scope, resource);
	const effectiveScope = getEffectiveScopeConfiguration(scope, resource);
	const canResetCustomDefinition =
		hasOwnCustomModel(raw, model.id) &&
		(isBuiltInModel(model.id) || hasParentCustomModel(scope, resource, model.id));
	return {
		id: model.id,
		name: model.name,
		apiModelId: getApiModelId(model.id, resource),
		connectionLabel,
		visionMode,
		visionModeLabel:
			visionMode === 'native' ? t('manager.visionMode.native') : t('manager.visionMode.proxy'),
		status,
		isCustom: Boolean(custom),
		isBuiltInOverride: Boolean(custom && MODELS.some((entry) => entry.id === model.id)),
		canReset:
			Boolean(raw.models?.[model.id]) ||
			Boolean(effectiveScope?.models?.[model.id]) ||
			canResetCustomDefinition,
		valueSourceLabel: getModelSource(model.id, resource),
		draft: {
			name: model.name,
			apiModelId: getApiModelId(model.id, resource),
			endpointRoute,
			visionMode,
			...(custom
				? {
						contextWindowTokens: custom.maxInputTokens + custom.maxOutputTokens,
						maxOutputTokens: custom.maxOutputTokens,
						toolCalling: custom.capabilities.toolCalling !== false,
						thinking: custom.capabilities.thinking !== false,
					}
				: {}),
		},
		allowedRoutes: getAllowedRoutes(model),
	};
}

async function buildCredentialRows(
	auth: AuthManager,
	models: readonly ModelDefinition[],
	resource?: vscode.Uri,
): Promise<ManagerCredentialRow[]> {
	const counts = new Map(CREDENTIAL_CHANNELS.map((channel) => [channel, 0]));
	for (const model of models) {
		try {
			const channel = resolveModelConnection(model.id, resource).credentialChannel;
			counts.set(channel, (counts.get(channel) ?? 0) + 1);
		} catch {
			// Invalid routes are represented in the model table.
		}
	}
	return Promise.all(
		CREDENTIAL_CHANNELS.map(async (channel) => ({
			channel,
			label: formatCredentialChannel(channel),
			description: t(`manager.credential.${channel}.description`),
			hasApiKey: await auth.hasApiKey(channel, resource),
			modelCount: counts.get(channel) ?? 0,
			protocolsLabel: channel.endsWith('-coding')
				? t('manager.credential.codingProtocols')
				: t('manager.credential.standardProtocol'),
		})),
	);
}

function createNewModelTemplate(): ManagerNewModelTemplate {
	return {
		draft: {
			name: '',
			apiModelId: '',
			endpointRoute: 'default',
			visionMode: 'proxy',
			contextWindowTokens: 200_000,
			maxOutputTokens: 131_072,
			toolCalling: true,
			thinking: true,
		},
		allowedRoutes: ALL_MODEL_ROUTES.map(toRouteOption),
	};
}

function getAllowedRoutes(
	model: ModelDefinition,
): readonly ManagerSelectOption<ModelEndpointRoute>[] {
	const constrainedModel = getRouteConstraintModel(model);
	const routes =
		constrainedModel.supportedApiModes?.length === 1 &&
		constrainedModel.supportedApiModes[0] === 'standard'
			? STANDARD_ONLY_ROUTES
			: ALL_MODEL_ROUTES;
	return routes.map(toRouteOption);
}

function toRouteOption(route: ModelEndpointRoute): ManagerSelectOption<ModelEndpointRoute> {
	return {
		value: route,
		label: formatRoute(route),
		...(route !== 'default' && route !== 'same-region-standard'
			? { description: resolveEndpointBaseUrl(route) }
			: {}),
	};
}

function getScopeConfiguration(
	scope: ManagerScopeId,
	resource?: vscode.Uri,
): ModelManagementConfigurationV1 {
	const inspection = inspectModelManagementConfiguration(resource);
	const value =
		scope === 'global'
			? inspection.globalValue
			: scope === 'workspace'
				? inspection.workspaceValue
				: inspection.workspaceFolderValue;
	return cloneConfiguration(value ?? { version: 1 });
}

async function saveScopeConfiguration(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	configuration: ModelManagementConfigurationV1,
): Promise<void> {
	const target =
		scope === 'global'
			? vscode.ConfigurationTarget.Global
			: scope === 'workspace'
				? vscode.ConfigurationTarget.Workspace
				: vscode.ConfigurationTarget.WorkspaceFolder;
	await saveModelManagementConfiguration(configuration, target, resource);
}

function getEffectiveScopeConfiguration(
	scope: ManagerScopeId,
	resource?: vscode.Uri,
): ModelManagementConfigurationV1 | undefined {
	const inspection = inspectEffectiveModelManagementConfiguration(resource);
	return scope === 'global'
		? inspection.globalValue
		: scope === 'workspace'
			? inspection.workspaceValue
			: inspection.workspaceFolderValue;
}

async function clearLegacyModelOverridesAtScope(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	modelId: string,
): Promise<void> {
	const target = getConfigurationTarget(scope);
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	for (const setting of [
		'modelIdOverrides',
		'modelEndpointOverrides',
		'modelVisionModes',
	] as const) {
		const inspection = config.inspect<unknown>(setting);
		const scoped = getScopedConfigurationValue(inspection, target);
		if (!scoped || typeof scoped !== 'object' || Array.isArray(scoped)) {
			continue;
		}
		const matchingKeys = Object.keys(scoped).filter((key) => key.trim() === modelId);
		if (matchingKeys.length === 0) {
			continue;
		}
		const next = { ...(scoped as Record<string, unknown>) };
		for (const key of matchingKeys) {
			delete next[key];
		}
		await config.update(setting, Object.keys(next).length > 0 ? next : undefined, target);
	}
}

function getConfigurationTarget(scope: ManagerScopeId): vscode.ConfigurationTarget {
	return scope === 'global'
		? vscode.ConfigurationTarget.Global
		: scope === 'workspace'
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.WorkspaceFolder;
}

function getScopedConfigurationValue(
	inspection:
		| {
				globalValue?: unknown;
				workspaceValue?: unknown;
				workspaceFolderValue?: unknown;
		  }
		| undefined,
	target: vscode.ConfigurationTarget,
): unknown {
	if (target === vscode.ConfigurationTarget.Global) return inspection?.globalValue;
	if (target === vscode.ConfigurationTarget.Workspace) return inspection?.workspaceValue;
	return inspection?.workspaceFolderValue;
}

function getCustomModelDefinition(
	modelId: string,
	resource?: vscode.Uri,
): ModelDefinition | undefined {
	return getCustomModels(resource).find((model) => model.id === modelId);
}

function isCustomModel(modelId: string, resource?: vscode.Uri): boolean {
	return getCustomModels(resource).some((model) => model.id === modelId);
}

function isBuiltInModel(modelId: string): boolean {
	return MODELS.some((model) => model.id === modelId);
}

function getRouteConstraintModel(model: ModelDefinition): ModelDefinition {
	return MODELS.find((entry) => entry.id === model.id) ?? model;
}

function hasOwnCustomModel(
	configuration: ModelManagementConfigurationV1,
	modelId: string,
): boolean {
	return Boolean(
		configuration.customModels &&
		Object.prototype.hasOwnProperty.call(configuration.customModels, modelId),
	);
}

function hasOwnModelConfigurationField(
	configuration: ModelManagementModelConfiguration | undefined,
	field: keyof ModelManagementModelConfiguration,
): boolean {
	return Boolean(configuration && Object.prototype.hasOwnProperty.call(configuration, field));
}

function hasParentCustomModel(
	scope: ManagerScopeId,
	resource: vscode.Uri | undefined,
	modelId: string,
): boolean {
	const inspection = inspectEffectiveModelManagementConfiguration(resource);
	let inherited: CustomModelConfig | null | undefined;
	if (scope !== 'global' && hasOwnCustomModel(inspection.globalValue ?? { version: 1 }, modelId)) {
		inherited = inspection.globalValue?.customModels?.[modelId];
	}
	if (
		scope === 'workspace-folder' &&
		hasOwnCustomModel(inspection.workspaceValue ?? { version: 1 }, modelId)
	) {
		inherited = inspection.workspaceValue?.customModels?.[modelId];
	}
	return inherited !== undefined && inherited !== null;
}

function getDefaultConnectionSource(resource?: vscode.Uri): string | undefined {
	const inspection = inspectEffectiveModelManagementConfiguration(resource);
	if (inspection.workspaceFolderValue?.defaultConnection) return t('manager.scope.workspaceFolder');
	if (inspection.workspaceValue?.defaultConnection) return t('manager.scope.workspace');
	if (inspection.globalValue?.defaultConnection) return t('manager.scope.global');
	return t('manager.scope.builtIn');
}

function getModelSource(modelId: string, resource?: vscode.Uri): string {
	const inspection = inspectEffectiveModelManagementConfiguration(resource);
	if (
		inspection.workspaceFolderValue?.models?.[modelId] ||
		inspection.workspaceFolderValue?.customModels?.[modelId] !== undefined
	) {
		return t('manager.scope.workspaceFolder');
	}
	if (
		inspection.workspaceValue?.models?.[modelId] ||
		inspection.workspaceValue?.customModels?.[modelId] !== undefined
	) {
		return t('manager.scope.workspace');
	}
	if (
		inspection.globalValue?.models?.[modelId] ||
		inspection.globalValue?.customModels?.[modelId] !== undefined
	) {
		return t('manager.scope.global');
	}
	return t('manager.scope.builtIn');
}

function toCustomModelConfiguration(id: string, draft: ManagerModelDraft): CustomModelConfig {
	return {
		id,
		name: requireText(draft.name, 'model name'),
		...(draft.contextWindowTokens
			? { contextWindowTokens: positiveInteger(draft.contextWindowTokens) }
			: {}),
		...(draft.maxOutputTokens ? { maxOutputTokens: positiveInteger(draft.maxOutputTokens) } : {}),
		toolCalling: draft.toolCalling !== false,
		thinking: draft.thinking !== false,
	};
}

function validateDraft(
	draft: ManagerModelDraft,
	model?: ModelDefinition,
	resource?: vscode.Uri,
): void {
	requireText(draft.name, 'model name');
	requireCanonicalModelId(draft.apiModelId);
	if (!ALL_MODEL_ROUTES.includes(draft.endpointRoute)) {
		throw new Error(t('manager.error.invalidEndpoint'));
	}
	if (draft.visionMode !== 'proxy' && draft.visionMode !== 'native') {
		throw new Error(t('manager.error.invalidVisionMode'));
	}
	const apiMode =
		draft.endpointRoute === 'default'
			? resolveEndpointApiMode(getEndpoint(resource))
			: draft.endpointRoute === 'same-region-standard'
				? 'standard'
				: resolveEndpointApiMode(draft.endpointRoute);
	const constrainedModel = model ? getRouteConstraintModel(model) : undefined;
	if (
		constrainedModel?.supportedApiModes &&
		!constrainedModel.supportedApiModes.includes(apiMode)
	) {
		throw new Error(t('manager.error.unsupportedRoute', constrainedModel.name));
	}
	const contextWindowTokens =
		draft.contextWindowTokens === undefined
			? undefined
			: positiveInteger(draft.contextWindowTokens);
	const maxOutputTokens =
		draft.maxOutputTokens === undefined ? undefined : positiveInteger(draft.maxOutputTokens);
	if (
		contextWindowTokens !== undefined &&
		maxOutputTokens !== undefined &&
		maxOutputTokens >= contextWindowTokens
	) {
		throw new Error(t('manager.error.contextWindowTooSmall'));
	}
}

function validateBaseUrl(value: unknown): string {
	const text = requireText(value, 'Base URL').replace(/\/+$/u, '');
	try {
		const parsed = new URL(text);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
		return text;
	} catch {
		throw new Error(t('manager.error.invalidBaseUrl'));
	}
}

function requireText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(t('manager.error.requiredField', label));
	}
	return value.trim();
}

function requireCanonicalModelId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(t('manager.error.requiredField', 'model ID'));
	}
	if (value !== value.trim()) {
		throw new Error(t('manager.error.nonCanonicalModelId'));
	}
	return value;
}

function positiveInteger(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(t('manager.error.invalidNumber'));
	}
	return value;
}

function formatEndpoint(endpoint: EndpointPreset): string {
	return t(`manager.endpoint.${endpoint}`);
}

function formatRoute(route: ModelEndpointRoute): string {
	return route === 'default'
		? t('manager.route.default')
		: route === 'same-region-standard'
			? t('manager.route.sameRegionStandard')
			: formatEndpoint(route);
}

function formatProtocol(protocol: 'openai' | 'anthropic'): string {
	return protocol === 'anthropic' ? 'Anthropic Messages' : 'OpenAI Chat Completions';
}

function cloneConfiguration(
	configuration: ModelManagementConfigurationV1,
): ModelManagementConfigurationV1 {
	const clone = JSON.parse(JSON.stringify(configuration)) as ModelManagementConfigurationV1;
	if (clone.models) {
		clone.models = Object.assign(
			createModelIdRecord<ModelManagementModelConfiguration>(),
			clone.models,
		);
	}
	if (clone.customModels) {
		clone.customModels = Object.assign(
			createModelIdRecord<CustomModelConfig | null>(),
			clone.customModels,
		);
	}
	return clone;
}

function createModelIdRecord<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}
