import vscode from 'vscode';
import { CONFIG_SECTION, MODELS } from './consts';
import { DEFAULT_GLM_VISION_MODEL_ID } from './provider/vision/consts';
import {
	deriveEndpointPreset,
	identifyOfficialGLMApiMode,
	identifyOfficialGLMPlatform,
	normalizeBaseUrl,
	resolveApiKeyUrl,
	resolveEndpointApiKeyUrl,
	resolveEndpointApiMode,
	resolveEndpointBaseUrl,
	resolveEndpointCredentialChannel,
	resolveEndpointProtocol,
	resolveEndpointRegion,
} from './endpoint';
import type {
	ApiMode,
	ApiProtocol,
	ApiRegion,
	CustomModelConfig,
	EndpointPreset,
	ModelManagementConfigurationV1,
	ModelManagementModelConfiguration,
	ModelDefinition,
	ModelEndpointRoute,
	ModelVisionMode,
	ResolvedModelConnection,
} from './types';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

const DEFAULT_API_MODE: ApiMode = 'coding-plan';
const DEFAULT_API_REGION: ApiRegion = 'china';
const DEFAULT_API_PROTOCOL: ApiProtocol = 'openai';
const CUSTOM_MODEL_DETAIL = 'Custom GLM-compatible model';
const CUSTOM_MODEL_MAX_INPUT_TOKENS = 200_000;
const CUSTOM_MODEL_MAX_OUTPUT_TOKENS = 131_072;
const MODEL_MANAGEMENT_SETTING = 'modelManagement';
const LEGACY_MODEL_MANAGEMENT_SETTINGS = [
	'endpoint',
	'baseUrl',
	'modelIdOverrides',
	'modelEndpointOverrides',
	'modelVisionModes',
	'customModels',
] as const;

export interface ModelManagementConfigurationInspection {
	effective: ModelManagementConfigurationV1;
	globalValue?: ModelManagementConfigurationV1;
	workspaceValue?: ModelManagementConfigurationV1;
	workspaceFolderValue?: ModelManagementConfigurationV1;
}

/** Read and field-wise merge the versioned configuration for one resource. */
export function getModelManagementConfiguration(
	resource?: vscode.Uri,
): ModelManagementConfigurationV1 {
	return inspectModelManagementConfiguration(resource).effective;
}

/**
 * Return normalized values for every VS Code scope as well as their effective
 * Global -> Workspace -> Workspace Folder merge.
 */
export function inspectModelManagementConfiguration(
	resource?: vscode.Uri,
): ModelManagementConfigurationInspection {
	const inspection = vscode.workspace
		.getConfiguration(CONFIG_SECTION, resource)
		.inspect<unknown>(MODEL_MANAGEMENT_SETTING);
	const globalValue = normalizeModelManagementConfiguration(inspection?.globalValue);
	const workspaceValue = normalizeModelManagementConfiguration(inspection?.workspaceValue);
	const workspaceFolderValue = normalizeModelManagementConfiguration(
		inspection?.workspaceFolderValue,
	);
	return {
		effective: mergeModelManagementConfigurations(
			mergeModelManagementConfigurations(globalValue, workspaceValue),
			workspaceFolderValue,
		),
		...(globalValue ? { globalValue } : {}),
		...(workspaceValue ? { workspaceValue } : {}),
		...(workspaceFolderValue ? { workspaceFolderValue } : {}),
	};
}

/** Inspect per-scope runtime values after translating legacy settings. */
export function inspectEffectiveModelManagementConfiguration(
	resource?: vscode.Uri,
): ModelManagementConfigurationInspection {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const canonical = inspectModelManagementConfiguration(resource);
	let effective: ModelManagementConfigurationV1 = { version: 1 };
	const globalValue = getModelManagementScopeConfiguration(
		effective,
		config,
		vscode.ConfigurationTarget.Global,
		canonical.globalValue,
	);
	effective = mergeModelManagementConfigurations(effective, globalValue);
	const workspaceValue = getModelManagementScopeConfiguration(
		effective,
		config,
		vscode.ConfigurationTarget.Workspace,
		canonical.workspaceValue,
	);
	effective = mergeModelManagementConfigurations(effective, workspaceValue);
	const workspaceFolderValue = getModelManagementScopeConfiguration(
		effective,
		config,
		vscode.ConfigurationTarget.WorkspaceFolder,
		canonical.workspaceFolderValue,
	);
	effective = mergeModelManagementConfigurations(effective, workspaceFolderValue);
	return {
		effective,
		...(globalValue ? { globalValue } : {}),
		...(workspaceValue ? { workspaceValue } : {}),
		...(workspaceFolderValue ? { workspaceFolderValue } : {}),
	};
}

function getModelManagementScopeConfiguration(
	inherited: ModelManagementConfigurationV1,
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
	canonical: ModelManagementConfigurationV1 | undefined,
): ModelManagementConfigurationV1 | undefined {
	const legacy = getLegacyModelManagementConfiguration(config, target, inherited.customModels);
	if (!legacy && !canonical) {
		return undefined;
	}
	// Canonical values supersede legacy values only within the same VS Code scope.
	return mergeModelManagementConfigurations(legacy, canonical);
}

/** Persist one complete scope value after validating its versioned shape. */
export async function saveModelManagementConfiguration(
	configuration: ModelManagementConfigurationV1,
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	if (target === vscode.ConfigurationTarget.WorkspaceFolder && !resource) {
		throw new Error('A workspace folder resource is required for folder-scoped configuration.');
	}
	const normalized = normalizeModelManagementConfiguration(configuration);
	if (!normalized) {
		throw new Error('Unsupported model management configuration. Expected version 1.');
	}
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION, resource)
		.update(MODEL_MANAGEMENT_SETTING, normalized, target);
}

/** Remove the canonical configuration at exactly one VS Code scope. */
export async function resetModelManagementConfiguration(
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	if (target === vscode.ConfigurationTarget.WorkspaceFolder && !resource) {
		throw new Error('A workspace folder resource is required for folder-scoped configuration.');
	}
	await vscode.workspace
		.getConfiguration(CONFIG_SECTION, resource)
		.update(MODEL_MANAGEMENT_SETTING, undefined, target);
}

/** Parse persisted or Webview-provided configuration without applying defaults. */
export function normalizeModelManagementConfiguration(
	value: unknown,
): ModelManagementConfigurationV1 | undefined {
	if (!isRecord(value) || value.version !== 1) {
		return undefined;
	}

	const normalized: ModelManagementConfigurationV1 = { version: 1 };
	if (isRecord(value.defaultConnection)) {
		const endpoint = normalizeEndpointPreset(value.defaultConnection.endpoint);
		const defaultConnection: NonNullable<ModelManagementConfigurationV1['defaultConnection']> = {};
		if (endpoint) {
			defaultConnection.endpoint = endpoint;
		}
		if (
			hasOwn(value.defaultConnection, 'baseUrl') &&
			typeof value.defaultConnection.baseUrl === 'string'
		) {
			defaultConnection.baseUrl = value.defaultConnection.baseUrl;
		}
		if (Object.keys(defaultConnection).length > 0) {
			normalized.defaultConnection = defaultConnection;
		}
	}

	if (isRecord(value.models)) {
		const models = createModelIdRecord<ModelManagementModelConfiguration>();
		for (const [rawId, rawProfile] of Object.entries(value.models)) {
			if (!isCanonicalModelId(rawId)) {
				return undefined;
			}
			if (!isRecord(rawProfile)) {
				continue;
			}
			const profile: ModelManagementModelConfiguration = {};
			if (typeof rawProfile.apiModelId === 'string') {
				if (!isCanonicalModelId(rawProfile.apiModelId)) {
					return undefined;
				}
				profile.apiModelId = rawProfile.apiModelId;
			}
			const endpointRoute = normalizeModelEndpointRoute(rawProfile.endpointRoute);
			if (endpointRoute) {
				profile.endpointRoute = endpointRoute;
			}
			const visionMode = normalizeModelVisionMode(rawProfile.visionMode);
			if (visionMode) {
				profile.visionMode = visionMode;
			}
			if (Object.keys(profile).length > 0) {
				models[rawId] = profile;
			}
		}
		if (Object.keys(models).length > 0) {
			normalized.models = models;
		}
	}

	if (isRecord(value.customModels)) {
		const customModels = createModelIdRecord<CustomModelConfig | null>();
		for (const [rawId, rawModel] of Object.entries(value.customModels)) {
			if (!isCanonicalModelId(rawId)) {
				return undefined;
			}
			if (rawModel === null) {
				customModels[rawId] = null;
				continue;
			}
			const model = normalizeCustomModelConfiguration(rawModel);
			if (model) {
				customModels[rawId] = model;
			}
		}
		if (Object.keys(customModels).length > 0) {
			normalized.customModels = customModels;
		}
	}

	return normalized;
}

/** Merge normalized configurations from least to most specific scope. */
export function mergeModelManagementConfigurations(
	...values: Array<ModelManagementConfigurationV1 | undefined>
): ModelManagementConfigurationV1 {
	const result: ModelManagementConfigurationV1 = { version: 1 };
	for (const value of values) {
		if (!value) {
			continue;
		}
		if (value.defaultConnection) {
			result.defaultConnection = {
				...result.defaultConnection,
				...value.defaultConnection,
			};
		}
		for (const [id, profile] of Object.entries(value.models ?? {})) {
			result.models ??= createModelIdRecord<ModelManagementModelConfiguration>();
			result.models[id] = { ...result.models[id], ...profile };
		}
		for (const [id, model] of Object.entries(value.customModels ?? {})) {
			result.customModels ??= createModelIdRecord<CustomModelConfig | null>();
			if (model === null) {
				result.customModels[id] = null;
				continue;
			}
			const inherited = result.customModels[id];
			result.customModels[id] = {
				...(inherited && inherited !== null ? inherited : {}),
				...model,
			};
		}
	}
	return result;
}

/**
 * Get GLM API base URL from settings.
 *
 * Resolution order:
 *   1. `baseUrl` override (highest priority — covers advanced/proxy use cases)
 *   2. `endpoint` preset (new single-value selector)
 *   3. Legacy (region, apiMode, apiProtocol) tuple — transparently mapped to
 *      a preset so existing user settings keep working without migration.
 */
export function getBaseUrl(resource?: vscode.Uri): string {
	const override = getBaseUrlOverride(resource);
	if (override) {
		return override;
	}

	const preset = getEndpoint(resource);
	return resolveEndpointBaseUrl(preset);
}

export function getBaseUrlOverride(resource?: vscode.Uri): string | undefined {
	const connection =
		inspectEffectiveModelManagementConfiguration(resource).effective.defaultConnection;
	if (connection && hasOwn(connection, 'baseUrl')) {
		const normalized = normalizeBaseUrl(connection.baseUrl ?? '');
		return normalized || undefined;
	}
	return undefined;
}

export function getApiMode(resource?: vscode.Uri): ApiMode {
	const configuredEndpoint = getConfiguredEndpoint(resource);
	if (configuredEndpoint) {
		return resolveEndpointApiMode(configuredEndpoint);
	}
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	return normalizeApiMode(config.get<string>('apiMode'), DEFAULT_API_MODE) ?? DEFAULT_API_MODE;
}

export function getRegion(resource?: vscode.Uri): ApiRegion {
	const configuredEndpoint = getConfiguredEndpoint(resource);
	if (configuredEndpoint) {
		return resolveEndpointRegion(configuredEndpoint);
	}
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	return normalizeApiRegion(config.get<string>('region'), DEFAULT_API_REGION) ?? DEFAULT_API_REGION;
}

/**
 * Get the single-value endpoint preset.
 *
 * Falls back to deriving a preset from the legacy (region, apiMode,
 * apiProtocol) tuple when `endpoint` is not explicitly configured. This keeps
 * existing user settings working without a destructive migration.
 */
export function getEndpoint(resource?: vscode.Uri): EndpointPreset {
	const configured = getConfiguredEndpoint(resource);
	if (configured) {
		return configured;
	}
	return deriveEndpointFromLegacy(resource);
}

/**
 * Get the wire protocol implied by the active endpoint preset.
 *
 * `baseUrl` override does not change the protocol — users pointing at a
 * custom gateway still pick the protocol shape explicitly via `endpoint`.
 */
export function getApiProtocol(resource?: vscode.Uri): ApiProtocol {
	const preset = getEndpoint(resource);
	const protocol = resolveEndpointProtocol(preset);
	// Preserve the legacy explicit `apiProtocol` override path: when a user has
	// NOT set the new `endpoint` but DID set `apiProtocol`, that intent still
	// wins so custom-baseUrl users keep their chosen protocol shape.
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const explicitEndpoint = getConfiguredEndpoint(resource);
	if (explicitEndpoint) {
		return protocol;
	}
	const legacyProtocol = normalizeApiProtocol(config.get<string>('apiProtocol'), protocol);
	return legacyProtocol ?? protocol;
}

export function getApiKeyUrl(resource?: vscode.Uri): string {
	const explicitEndpoint = getConfiguredEndpoint(resource);
	if (explicitEndpoint) {
		return resolveEndpointApiKeyUrl(explicitEndpoint);
	}
	// Legacy path: derive from the old tuple so old configs keep pointing at
	// the right key-management page.
	return resolveApiKeyUrl(getApiMode(resource), getRegion(resource));
}

function deriveEndpointFromLegacy(resource?: vscode.Uri): EndpointPreset {
	const region = getRegion(resource);
	const apiMode = getApiMode(resource);
	const apiProtocol = getApiProtocolLegacy(resource);
	return deriveEndpointPreset(region, apiMode, apiProtocol);
}

function getApiProtocolLegacy(resource?: vscode.Uri): ApiProtocol {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	return (
		normalizeApiProtocol(config.get<string>('apiProtocol'), DEFAULT_API_PROTOCOL) ??
		DEFAULT_API_PROTOCOL
	);
}

export function normalizeEndpointPreset(value: unknown): EndpointPreset | undefined {
	if (
		value === 'china-coding' ||
		value === 'china-standard' ||
		value === 'china-anthropic' ||
		value === 'international-coding' ||
		value === 'international-standard' ||
		value === 'international-anthropic'
	) {
		return value;
	}
	return undefined;
}

export function getModelEndpointRoutes(resource?: vscode.Uri): Record<string, ModelEndpointRoute> {
	const configured = Object.entries(
		inspectEffectiveModelManagementConfiguration(resource).effective.models ?? {},
	)
		.map(([key, value]) => [key.trim(), value.endpointRoute] as const)
		.filter(
			(entry): entry is readonly [string, ModelEndpointRoute] =>
				entry[0].length > 0 && entry[1] !== undefined,
		);

	return Object.fromEntries(configured);
}

export function getModelEndpointRoute(
	vscodeModelId: string,
	resource?: vscode.Uri,
): ModelEndpointRoute {
	return (
		getModelEndpointRoutes(resource)[vscodeModelId] ??
		findModelDefinition(vscodeModelId, resource)?.defaultEndpointRoute ??
		'default'
	);
}

export function resolveModelConnection(
	vscodeModelId: string,
	resource?: vscode.Uri,
): ResolvedModelConnection {
	const route = getModelEndpointRoute(vscodeModelId, resource);
	const globalEndpoint = getEndpoint(resource);
	const endpoint = resolveRouteEndpoint(route, globalEndpoint);
	const usesGlobalBaseUrlOverride =
		route === 'default' && getBaseUrlOverride(resource) !== undefined;
	const baseUrl = usesGlobalBaseUrlOverride
		? getBaseUrlOverride(resource)!
		: resolveEndpointBaseUrl(endpoint);
	const endpointApiMode = resolveEndpointApiMode(endpoint);
	const model = findModelDefinition(vscodeModelId, resource);
	const supportedApiModes =
		MODELS.find((candidate) => candidate.id === vscodeModelId)?.supportedApiModes ??
		model?.supportedApiModes;
	if (supportedApiModes && !supportedApiModes.includes(endpointApiMode)) {
		throw new Error(
			`Model ${vscodeModelId} does not support the ${endpointApiMode} connection route (${route}).`,
		);
	}
	const platform = identifyOfficialGLMPlatform(baseUrl);
	return {
		route,
		endpoint,
		baseUrl,
		protocol: route === 'default' ? getApiProtocol(resource) : resolveEndpointProtocol(endpoint),
		apiMode: identifyOfficialGLMApiMode(baseUrl),
		credentialChannel: resolveEndpointCredentialChannel(endpoint),
		pricingCurrency: platform === 'zhipu' ? 'CNY' : platform === 'zai' ? 'USD' : undefined,
		usesGlobalBaseUrlOverride,
	};
}

export function resolveDefaultConnection(resource?: vscode.Uri): ResolvedModelConnection {
	const endpoint = getEndpoint(resource);
	const override = getBaseUrlOverride(resource);
	const baseUrl = override ?? resolveEndpointBaseUrl(endpoint);
	const platform = identifyOfficialGLMPlatform(baseUrl);
	return {
		route: 'default',
		endpoint,
		baseUrl,
		protocol: getApiProtocol(resource),
		apiMode: identifyOfficialGLMApiMode(baseUrl),
		credentialChannel: resolveEndpointCredentialChannel(endpoint),
		pricingCurrency: platform === 'zhipu' ? 'CNY' : platform === 'zai' ? 'USD' : undefined,
		usesGlobalBaseUrlOverride: override !== undefined,
	};
}

function resolveRouteEndpoint(
	route: ModelEndpointRoute,
	globalEndpoint: EndpointPreset,
): EndpointPreset {
	if (route === 'default') {
		return globalEndpoint;
	}
	if (route === 'same-region-standard') {
		return resolveEndpointRegion(globalEndpoint) === 'international'
			? 'international-standard'
			: 'china-standard';
	}
	return route;
}

/**
 * Resolve the API model ID to send to the endpoint.
 *
 * Users can override model IDs via the `modelIdOverrides` setting object
 * (e.g. for third-party API proxies). Falls back to the VS Code model ID
 * when no override is configured.
 */
export function getApiModelId(vscodeModelId: string, resource?: vscode.Uri): string {
	const override = getModelIdOverrides(resource)[vscodeModelId]?.trim();
	return override || vscodeModelId;
}

export function getModelIdOverrides(resource?: vscode.Uri): Record<string, string> {
	const configured = Object.entries(
		inspectEffectiveModelManagementConfiguration(resource).effective.models ?? {},
	)
		.map(([key, value]) => [key.trim(), value.apiModelId?.trim() ?? ''] as const)
		.filter(([key, value]) => key.length > 0 && value.length > 0);

	return Object.fromEntries(configured);
}

/**
 * Resolve image routing by VS Code model ID rather than by its upstream API
 * override. The built-in vision model opts into native image input by default;
 * all other models retain the proxy behavior unless explicitly configured.
 */
export function getModelVisionMode(vscodeModelId: string, resource?: vscode.Uri): ModelVisionMode {
	const mode = getModelVisionModes(resource)[vscodeModelId];
	if (mode) {
		return mode;
	}
	return (
		findModelDefinition(vscodeModelId, resource)?.defaultVisionMode ??
		(vscodeModelId === DEFAULT_GLM_VISION_MODEL_ID ? 'native' : 'proxy')
	);
}

export function getModelVisionModes(resource?: vscode.Uri): Record<string, ModelVisionMode> {
	const configured = Object.entries(
		inspectEffectiveModelManagementConfiguration(resource).effective.models ?? {},
	)
		.map(([key, value]) => [key.trim(), value.visionMode] as const)
		.filter(
			(entry): entry is readonly [string, ModelVisionMode] =>
				entry[0].length > 0 && entry[1] !== undefined,
		);

	return Object.fromEntries(configured);
}

export function getCustomModels(resource?: vscode.Uri): ModelDefinition[] {
	const byId = new Map<string, ModelDefinition>();
	for (const [id, entry] of Object.entries(
		inspectEffectiveModelManagementConfiguration(resource).effective.customModels ?? {},
	)) {
		if (entry === null) {
			byId.delete(id);
			continue;
		}
		const model = normalizeCustomModel({ ...entry, id });
		if (model) {
			byId.set(model.id, model);
		}
	}
	return [...byId.values()];
}

export function listProviderModels(resource?: vscode.Uri): ModelDefinition[] {
	const byId = new Map(MODELS.map((model) => [model.id, model]));
	for (const model of getCustomModels(resource)) {
		byId.set(model.id, model);
	}
	return [...byId.values()];
}

export function findModelDefinition(
	modelId: string,
	resource?: vscode.Uri,
): ModelDefinition | undefined {
	return listProviderModels(resource).find((model) => model.id === modelId);
}

/**
 * Get the configured max output tokens limit.
 * Returns `undefined` when set to 0 (API default — no limit).
 */
export function getMaxTokens(): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('maxTokens', 0);
	// Guard against Infinity (e.g. from misconfiguration) which would satisfy
	// value > 0 but produce an invalid API request.
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Diagnostic mode. `verbose` also enables metadata logs.
 *
 * The legacy boolean `debug` setting is still read as a fallback so old
 * settings keep working even if migration cannot update every scope.
 */
export function getDebugMode(): DebugMode {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mode = getConfiguredDebugMode(config);
	if (mode) return mode;

	return config.get<boolean>('debug', false) ? 'metadata' : 'minimal';
}

/**
 * Whether to log privacy-preserving diagnostic debug information.
 */
export function getDebugLoggingEnabled(): boolean {
	return getDebugMode() !== 'minimal';
}

/**
 * Whether to write full GLM request payloads to disk.
 */
export function getRequestDumpEnabled(): boolean {
	return getDebugMode() === 'verbose';
}

export function getStabilizeToolListEnabled(): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<boolean>('experimental.stabilizeToolList', false);
}

/**
 * Migrate the legacy boolean `glm-copilot.debug` setting to `debugMode`.
 *
 * `debug: true` maps to `debugMode: metadata`; `debug: false` maps to the
 * default `minimal`, so it only needs cleanup.
 */
export async function migrateLegacyDebugSetting(): Promise<void> {
	await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.Global);

	if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
		await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.Workspace);
	}

	// Also clean up per-folder scopes (multi-root workspaces), consistent with
	// clearSettingsApiKey() in auth.ts.
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.WorkspaceFolder, folder.uri);
	}
}

/**
 * Migrate the legacy `region` + `apiMode` + `apiProtocol` settings into the
 * single `endpoint` preset, then clear the legacy keys.
 *
 * Reads the effective legacy values for each target so split Global/Workspace
 * tuples and independent Workspace Folder tuples retain their original scope.
 *
 * Writes the new endpoint to each applicable target, then clears legacy keys
 * at all scopes. Idempotent: a second run finds no legacy values and exits.
 */
export async function migrateLegacyEndpointSettings(): Promise<void> {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		await migrateLegacyEndpointSettingsAtScope(
			vscode.ConfigurationTarget.WorkspaceFolder,
			folder.uri,
		);
	}
	if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
		await migrateLegacyEndpointSettingsAtScope(vscode.ConfigurationTarget.Workspace);
	}
	await migrateLegacyEndpointSettingsAtScope(vscode.ConfigurationTarget.Global);
}

async function migrateLegacyEndpointSettingsAtScope(
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	if (!hasLegacyEndpointTupleAtScope(config, target)) {
		return;
	}

	if (!getExplicitEndpointThroughScope(resource, config, target)) {
		const endpoint = deriveLegacyEndpointPresetAtScope(config, target);
		// Do not remove the fallback tuple until the canonical endpoint write succeeds.
		await config.update('endpoint', endpoint, target);
	}
	await clearLegacyEndpointTupleAtScope(config, target);
}

async function clearLegacyEndpointTupleAtScope(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
): Promise<void> {
	for (const key of ['region', 'apiMode', 'apiProtocol'] as const) {
		try {
			await config.update(key, undefined, target);
		} catch {
			// Cleanup is retryable; the endpoint written above already wins at runtime.
		}
	}
}

function getExplicitEndpointThroughScope(
	resource: vscode.Uri | undefined,
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
): EndpointPreset | undefined {
	const canonical = inspectModelManagementConfiguration(resource);
	const legacy = config.inspect<unknown>('endpoint');
	const values = [
		[
			canonical.workspaceFolderValue?.defaultConnection?.endpoint,
			legacy?.workspaceFolderValue,
			vscode.ConfigurationTarget.WorkspaceFolder,
		],
		[
			canonical.workspaceValue?.defaultConnection?.endpoint,
			legacy?.workspaceValue,
			vscode.ConfigurationTarget.Workspace,
		],
		[
			canonical.globalValue?.defaultConnection?.endpoint,
			legacy?.globalValue,
			vscode.ConfigurationTarget.Global,
		],
	] as const;
	for (const [canonicalEndpoint, legacyEndpoint, scope] of values) {
		if (scope > target) {
			continue;
		}
		const endpoint = canonicalEndpoint ?? normalizeEndpointPreset(legacyEndpoint);
		if (endpoint) {
			return endpoint;
		}
	}
	return undefined;
}

/**
 * Move the six model/connection settings into the versioned management object.
 * Each VS Code scope is migrated independently so inheritance is preserved.
 */
export async function migrateLegacyModelManagementSettings(): Promise<void> {
	await migrateLegacyModelManagementSettingsAtScope(vscode.ConfigurationTarget.Global);

	if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
		await migrateLegacyModelManagementSettingsAtScope(vscode.ConfigurationTarget.Workspace);
	}

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		await migrateLegacyModelManagementSettingsAtScope(
			vscode.ConfigurationTarget.WorkspaceFolder,
			folder.uri,
		);
	}
}

async function migrateLegacyModelManagementSettingsAtScope(
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const currentRaw = getScopedValue(config.inspect<unknown>(MODEL_MANAGEMENT_SETTING), target);
	const current = normalizeModelManagementConfiguration(currentRaw);
	const canonical = inspectModelManagementConfiguration(resource);
	const inherited = getModelManagementConfigurationBeforeScope(config, canonical, target);
	const legacy = getLegacyModelManagementConfiguration(config, target, inherited.customModels);
	if (!legacy) {
		return;
	}
	if (currentRaw !== undefined && !current) {
		throw new Error(
			`Cannot migrate legacy model settings over an unsupported ${MODEL_MANAGEMENT_SETTING} value.`,
		);
	}

	// Canonical fields win; legacy values only fill fields that are still absent.
	const migrated = mergeModelManagementConfigurations(legacy, current);
	await saveModelManagementConfiguration(migrated, target, resource);

	// Never remove the fallback representation before the canonical write has completed.
	await clearLegacyModelManagementSettingsAtScope(config, target);
}

async function clearLegacyModelManagementSettingsAtScope(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
): Promise<void> {
	for (const key of LEGACY_MODEL_MANAGEMENT_SETTINGS) {
		try {
			await config.update(key, undefined, target);
		} catch {
			// Cleanup is retryable; the canonical configuration already wins at runtime.
		}
	}
}

function getLegacyModelManagementConfiguration(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
	inheritedCustomModels?: ModelManagementConfigurationV1['customModels'],
): ModelManagementConfigurationV1 | undefined {
	const endpointRaw = getScopedValue(config.inspect<unknown>('endpoint'), target);
	const baseUrlRaw = getScopedValue(config.inspect<unknown>('baseUrl'), target);
	const modelIdsRaw = getScopedValue(config.inspect<unknown>('modelIdOverrides'), target);
	const modelEndpointsRaw = getScopedValue(
		config.inspect<unknown>('modelEndpointOverrides'),
		target,
	);
	const modelVisionRaw = getScopedValue(config.inspect<unknown>('modelVisionModes'), target);
	const customModelsRaw = getScopedValue(config.inspect<unknown>('customModels'), target);
	if (
		endpointRaw === undefined &&
		baseUrlRaw === undefined &&
		modelIdsRaw === undefined &&
		modelEndpointsRaw === undefined &&
		modelVisionRaw === undefined &&
		customModelsRaw === undefined
	) {
		return undefined;
	}

	const candidate: Record<string, unknown> = { version: 1 };
	const endpoint = normalizeEndpointPreset(endpointRaw);
	const defaultConnection: Record<string, unknown> = {};
	if (endpoint) {
		defaultConnection.endpoint = endpoint;
	}
	if (typeof baseUrlRaw === 'string') {
		defaultConnection.baseUrl = baseUrlRaw;
	}
	if (Object.keys(defaultConnection).length > 0) {
		candidate.defaultConnection = defaultConnection;
	}

	const models = createModelIdRecord<Record<string, unknown>>();
	appendLegacyApiModelIds(models, modelIdsRaw);
	appendLegacyModelFields(models, modelEndpointsRaw, 'endpointRoute');
	appendLegacyModelFields(models, modelVisionRaw, 'visionMode');
	if (Object.keys(models).length > 0) {
		candidate.models = models;
	}

	if (Array.isArray(customModelsRaw)) {
		const customModels = createModelIdRecord<CustomModelConfig | null>();
		for (const [id, model] of Object.entries(inheritedCustomModels ?? {})) {
			if (model !== null) {
				customModels[id] = null;
			}
		}
		for (const entry of customModelsRaw) {
			const model = materializeLegacyCustomModelConfiguration(entry);
			if (model?.id) {
				customModels[model.id] = model;
			}
		}
		if (Object.keys(customModels).length > 0) {
			candidate.customModels = customModels;
		}
	}

	return normalizeModelManagementConfiguration(candidate) ?? { version: 1 };
}

function appendLegacyApiModelIds(
	models: Record<string, Record<string, unknown>>,
	value: unknown,
): void {
	if (!isRecord(value)) {
		return;
	}
	for (const [rawId, rawApiModelId] of Object.entries(value)) {
		const id = rawId.trim();
		const apiModelId = typeof rawApiModelId === 'string' ? rawApiModelId.trim() : '';
		if (id && apiModelId) {
			(models[id] ??= {}).apiModelId = apiModelId;
		}
	}
}

function getModelManagementConfigurationBeforeScope(
	config: vscode.WorkspaceConfiguration,
	canonical: ModelManagementConfigurationInspection,
	target: vscode.ConfigurationTarget,
): ModelManagementConfigurationV1 {
	let effective: ModelManagementConfigurationV1 = { version: 1 };
	if (target === vscode.ConfigurationTarget.Global) {
		return effective;
	}
	effective = mergeModelManagementConfigurations(
		effective,
		getModelManagementScopeConfiguration(
			effective,
			config,
			vscode.ConfigurationTarget.Global,
			canonical.globalValue,
		),
	);
	if (target === vscode.ConfigurationTarget.Workspace) {
		return effective;
	}
	return mergeModelManagementConfigurations(
		effective,
		getModelManagementScopeConfiguration(
			effective,
			config,
			vscode.ConfigurationTarget.Workspace,
			canonical.workspaceValue,
		),
	);
}

function appendLegacyModelFields(
	models: Record<string, Record<string, unknown>>,
	value: unknown,
	field: keyof ModelManagementModelConfiguration,
): void {
	if (!isRecord(value)) {
		return;
	}
	for (const [rawId, fieldValue] of Object.entries(value)) {
		const id = rawId.trim();
		if (id) {
			(models[id] ??= {})[field] = fieldValue;
		}
	}
}

function hasLegacyEndpointTupleAtScope(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
): boolean {
	return (
		normalizeApiRegion(getScopedValue(config.inspect<unknown>('region'), target), undefined) !==
			undefined ||
		normalizeApiMode(getScopedValue(config.inspect<unknown>('apiMode'), target), undefined) !==
			undefined ||
		normalizeApiProtocol(
			getScopedValue(config.inspect<unknown>('apiProtocol'), target),
			undefined,
		) !== undefined
	);
}

function deriveLegacyEndpointPresetAtScope(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
): EndpointPreset {
	const inherited = getInheritedEndpointBeforeScope(config, target);
	return deriveEndpointPreset(
		normalizeApiRegion(
			getScopedValue(config.inspect<unknown>('region'), target),
			resolveEndpointRegion(inherited),
		) ?? resolveEndpointRegion(inherited),
		normalizeApiMode(
			getScopedValue(config.inspect<unknown>('apiMode'), target),
			resolveEndpointApiMode(inherited),
		) ?? resolveEndpointApiMode(inherited),
		normalizeApiProtocol(
			getScopedValue(config.inspect<unknown>('apiProtocol'), target),
			resolveEndpointProtocol(inherited),
		) ?? resolveEndpointProtocol(inherited),
	);
}

function getInheritedEndpointBeforeScope(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget,
): EndpointPreset {
	if (target === vscode.ConfigurationTarget.Global) {
		return deriveEndpointPreset(DEFAULT_API_REGION, DEFAULT_API_MODE, DEFAULT_API_PROTOCOL);
	}

	if (target === vscode.ConfigurationTarget.Workspace) {
		return resolveEndpointThroughScope(config, vscode.ConfigurationTarget.Global);
	}

	return resolveEndpointThroughScope(config, vscode.ConfigurationTarget.Workspace);
}

function resolveEndpointThroughScope(
	config: vscode.WorkspaceConfiguration,
	target: vscode.ConfigurationTarget.Global | vscode.ConfigurationTarget.Workspace,
): EndpointPreset {
	const endpointInspection = config.inspect<unknown>('endpoint');
	const regionInspection = config.inspect<unknown>('region');
	const modeInspection = config.inspect<unknown>('apiMode');
	const protocolInspection = config.inspect<unknown>('apiProtocol');
	let endpoint =
		normalizeEndpointPreset(endpointInspection?.globalValue) ??
		deriveEndpointPreset(
			normalizeApiRegion(regionInspection?.globalValue, DEFAULT_API_REGION) ?? DEFAULT_API_REGION,
			normalizeApiMode(modeInspection?.globalValue, DEFAULT_API_MODE) ?? DEFAULT_API_MODE,
			normalizeApiProtocol(protocolInspection?.globalValue, DEFAULT_API_PROTOCOL) ??
				DEFAULT_API_PROTOCOL,
		);
	if (target === vscode.ConfigurationTarget.Global) {
		return endpoint;
	}

	const workspaceEndpoint = normalizeEndpointPreset(endpointInspection?.workspaceValue);
	if (workspaceEndpoint) {
		return workspaceEndpoint;
	}
	endpoint = deriveEndpointPreset(
		normalizeApiRegion(regionInspection?.workspaceValue, resolveEndpointRegion(endpoint)) ??
			resolveEndpointRegion(endpoint),
		normalizeApiMode(modeInspection?.workspaceValue, resolveEndpointApiMode(endpoint)) ??
			resolveEndpointApiMode(endpoint),
		normalizeApiProtocol(protocolInspection?.workspaceValue, resolveEndpointProtocol(endpoint)) ??
			resolveEndpointProtocol(endpoint),
	);
	return endpoint;
}

function getConfiguredDebugMode(config: vscode.WorkspaceConfiguration): DebugMode | undefined {
	const mode = config.inspect<unknown>('debugMode');
	return (
		normalizeDebugMode(mode?.workspaceFolderValue) ??
		normalizeDebugMode(mode?.workspaceValue) ??
		normalizeDebugMode(mode?.globalValue)
	);
}

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') {
		return value;
	}
	return undefined;
}

function normalizeApiMode(value: unknown, fallback: ApiMode | undefined): ApiMode | undefined {
	return value === 'coding-plan' || value === 'standard' ? value : fallback;
}

function normalizeApiProtocol(
	value: unknown,
	fallback: ApiProtocol | undefined,
): ApiProtocol | undefined {
	return value === 'openai' || value === 'anthropic' ? value : fallback;
}

function normalizeApiRegion(
	value: unknown,
	fallback: ApiRegion | undefined,
): ApiRegion | undefined {
	return value === 'china' || value === 'international' ? value : fallback;
}

function normalizeModelVisionMode(value: unknown): ModelVisionMode | undefined {
	return value === 'proxy' || value === 'native' || value === 'mcp' // [FORK] +mcp
		? value
		: undefined;
}

function normalizeModelEndpointRoute(value: unknown): ModelEndpointRoute | undefined {
	if (value === 'default' || value === 'same-region-standard') {
		return value;
	}
	return normalizeEndpointPreset(value);
}

function getConfiguredEndpoint(resource?: vscode.Uri): EndpointPreset | undefined {
	return inspectEffectiveModelManagementConfiguration(resource).effective.defaultConnection
		?.endpoint;
}

function normalizeCustomModelConfiguration(value: unknown): CustomModelConfig | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const result: CustomModelConfig = {};
	if (typeof value.id === 'string') result.id = value.id;
	if (typeof value.name === 'string') result.name = value.name;
	const contextWindowTokens = getCanonicalPositiveInteger(value.contextWindowTokens);
	const maxInputTokens = getCanonicalPositiveInteger(value.maxInputTokens);
	const maxOutputTokens = getCanonicalPositiveInteger(value.maxOutputTokens);
	if (contextWindowTokens !== undefined) result.contextWindowTokens = contextWindowTokens;
	if (maxInputTokens !== undefined) result.maxInputTokens = maxInputTokens;
	if (maxOutputTokens !== undefined) result.maxOutputTokens = maxOutputTokens;
	if (typeof value.toolCalling === 'boolean') result.toolCalling = value.toolCalling;
	if (typeof value.thinking === 'boolean') result.thinking = value.thinking;
	return result;
}

function getCanonicalPositiveInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isCanonicalModelId(value: string): boolean {
	return value.length > 0 && value === value.trim();
}

function createModelIdRecord<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeCustomModel(entry: unknown): ModelDefinition | undefined {
	const model = readCustomModelConfig(entry);
	if (!model) {
		return undefined;
	}

	const id = model.id?.trim();
	if (!id) {
		return undefined;
	}

	const thinking = model.thinking !== false;
	const maxOutputTokens = getPositiveInteger(model.maxOutputTokens, CUSTOM_MODEL_MAX_OUTPUT_TOKENS);
	const legacyMaxInputTokens = getPositiveInteger(
		model.maxInputTokens,
		CUSTOM_MODEL_MAX_INPUT_TOKENS,
	);
	const contextWindowTokens = getPositiveInteger(model.contextWindowTokens, 0);
	return {
		id,
		name: getCustomModelName(model, id),
		family: 'glm',
		version: 'custom',
		detail: CUSTOM_MODEL_DETAIL,
		maxInputTokens:
			contextWindowTokens > maxOutputTokens
				? contextWindowTokens - maxOutputTokens
				: legacyMaxInputTokens,
		maxOutputTokens,
		capabilities: {
			toolCalling: model.toolCalling === false ? false : true,
			imageInput: true,
			thinking,
		},
		requiresThinkingParam: thinking,
	};
}

function materializeLegacyCustomModelConfiguration(entry: unknown): CustomModelConfig | undefined {
	const model = normalizeCustomModel(entry);
	if (!model) {
		return undefined;
	}
	return {
		id: model.id,
		name: model.name,
		contextWindowTokens: model.maxInputTokens + model.maxOutputTokens,
		maxOutputTokens: model.maxOutputTokens,
		toolCalling: model.capabilities.toolCalling !== false,
		thinking: model.capabilities.thinking,
	};
}

function readCustomModelConfig(entry: unknown): CustomModelConfig | undefined {
	if (typeof entry === 'string') {
		return { id: entry };
	}

	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
		return undefined;
	}

	return entry as CustomModelConfig;
}

function getCustomModelName(model: CustomModelConfig, id: string): string {
	const name = model.name?.trim();
	return name || id;
}

function getPositiveInteger(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

async function migrateLegacyDebugSettingAtScope(
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const legacy = config.inspect<boolean>('debug');
	const mode = config.inspect<DebugMode>('debugMode');
	const legacyValue = getScopedValue(legacy, target);

	if (legacyValue === undefined) {
		return;
	}

	if (legacyValue === true && getScopedValue(mode, target) === undefined) {
		await config.update('debugMode', 'metadata', target);
	}
	// Clear the legacy key after migrate. If this fails the legacy key is
	// harmless — the new debugMode takes precedence at runtime.
	try {
		await config.update('debug', undefined, target);
	} catch {
		/* non-fatal */
	}
}

function getScopedValue<T>(
	inspection:
		| {
				globalValue?: T;
				workspaceValue?: T;
				workspaceFolderValue?: T;
		  }
		| undefined,
	target: vscode.ConfigurationTarget,
): T | undefined {
	if (!inspection) {
		return undefined;
	}

	if (target === vscode.ConfigurationTarget.Global) {
		return inspection.globalValue;
	}
	if (target === vscode.ConfigurationTarget.Workspace) {
		return inspection.workspaceValue;
	}
	if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
		return inspection.workspaceFolderValue;
	}
	return undefined;
}
