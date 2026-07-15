import vscode from 'vscode';
import { CONFIG_SECTION, MODELS } from './consts';
import { DEFAULT_GLM_VISION_MODEL_ID } from './provider/vision/consts';
import {
	deriveEndpointPreset,
	normalizeBaseUrl,
	resolveApiKeyUrl,
	resolveEndpointApiKeyUrl,
	resolveEndpointBaseUrl,
	resolveEndpointProtocol,
} from './endpoint';
import type {
	ApiMode,
	ApiProtocol,
	ApiRegion,
	CustomModelConfig,
	EndpointPreset,
	ModelVisionMode,
	ModelDefinition,
} from './types';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

const DEFAULT_API_MODE: ApiMode = 'coding-plan';
const DEFAULT_API_REGION: ApiRegion = 'china';
const DEFAULT_API_PROTOCOL: ApiProtocol = 'openai';
const CUSTOM_MODEL_DETAIL = 'Custom GLM-compatible model';
const CUSTOM_MODEL_MAX_INPUT_TOKENS = 200_000;
const CUSTOM_MODEL_MAX_OUTPUT_TOKENS = 131_072;

/**
 * Get GLM API base URL from settings.
 *
 * Resolution order:
 *   1. `baseUrl` override (highest priority — covers advanced/proxy use cases)
 *   2. `endpoint` preset (new single-value selector)
 *   3. Legacy (region, apiMode, apiProtocol) tuple — transparently mapped to
 *      a preset so existing user settings keep working without migration.
 */
export function getBaseUrl(): string {
	const override = getBaseUrlOverride();
	if (override) {
		return override;
	}

	const preset = getEndpoint();
	return resolveEndpointBaseUrl(preset);
}

export function getBaseUrlOverride(): string | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<string>('baseUrl', '');
	// Guard against non-string values in settings.json that would crash normalizeBaseUrl().trim()
	const normalized = normalizeBaseUrl(typeof value === 'string' ? value : '');
	return normalized || undefined;
}

export function getApiMode(): ApiMode {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return normalizeApiMode(config.get<string>('apiMode'), DEFAULT_API_MODE) ?? DEFAULT_API_MODE;
}

export function getRegion(): ApiRegion {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return normalizeApiRegion(config.get<string>('region'), DEFAULT_API_REGION) ?? DEFAULT_API_REGION;
}

/**
 * Get the single-value endpoint preset.
 *
 * Falls back to deriving a preset from the legacy (region, apiMode,
 * apiProtocol) tuple when `endpoint` is not explicitly configured. This keeps
 * existing user settings working without a destructive migration.
 */
export function getEndpoint(): EndpointPreset {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const explicit = normalizeEndpointPreset(config.get<string>('endpoint'));
	if (explicit) {
		return explicit;
	}
	return deriveEndpointFromLegacy();
}

/**
 * Get the wire protocol implied by the active endpoint preset.
 *
 * `baseUrl` override does not change the protocol — users pointing at a
 * custom gateway still pick the protocol shape explicitly via `endpoint`.
 */
export function getApiProtocol(): ApiProtocol {
	const preset = getEndpoint();
	const protocol = resolveEndpointProtocol(preset);
	// Preserve the legacy explicit `apiProtocol` override path: when a user has
	// NOT set the new `endpoint` but DID set `apiProtocol`, that intent still
	// wins so custom-baseUrl users keep their chosen protocol shape.
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const explicitEndpoint = normalizeEndpointPreset(config.get<string>('endpoint'));
	if (explicitEndpoint) {
		return protocol;
	}
	const legacyProtocol = normalizeApiProtocol(config.get<string>('apiProtocol'), protocol);
	return legacyProtocol ?? protocol;
}

export function getApiKeyUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const explicitEndpoint = normalizeEndpointPreset(config.get<string>('endpoint'));
	if (explicitEndpoint) {
		return resolveEndpointApiKeyUrl(explicitEndpoint);
	}
	// Legacy path: derive from the old tuple so old configs keep pointing at
	// the right key-management page.
	return resolveApiKeyUrl(getApiMode(), getRegion());
}

function deriveEndpointFromLegacy(): EndpointPreset {
	const region = getRegion();
	const apiMode = getApiMode();
	const apiProtocol = getApiProtocolLegacy();
	return deriveEndpointPreset(region, apiMode, apiProtocol);
}

function getApiProtocolLegacy(): ApiProtocol {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return (
		normalizeApiProtocol(config.get<string>('apiProtocol'), DEFAULT_API_PROTOCOL) ??
		DEFAULT_API_PROTOCOL
	);
}

function normalizeEndpointPreset(value: unknown): EndpointPreset | undefined {
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

/**
 * Resolve the API model ID to send to the endpoint.
 *
 * Users can override model IDs via the `modelIdOverrides` setting object
 * (e.g. for third-party API proxies). Falls back to the VS Code model ID
 * when no override is configured.
 */
export function getApiModelId(vscodeModelId: string): string {
	const override = getModelIdOverrides()[vscodeModelId]?.trim();
	return override || vscodeModelId;
}

export function getModelIdOverrides(): Record<string, string> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const raw = config.get<Record<string, unknown>>('modelIdOverrides');
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(raw)
			.map(([key, value]) => [key.trim(), typeof value === 'string' ? value.trim() : ''])
			.filter(([key, value]) => key.length > 0 && value.length > 0),
	);
}

/**
 * Resolve image routing by VS Code model ID rather than by its upstream API
 * override. The built-in vision model opts into native image input by default;
 * all other models retain the proxy behavior unless explicitly configured.
 */
export function getModelVisionMode(vscodeModelId: string): ModelVisionMode {
	const mode = getModelVisionModes()[vscodeModelId];
	if (mode) {
		return mode;
	}
	return vscodeModelId === DEFAULT_GLM_VISION_MODEL_ID ? 'native' : 'proxy';
}

export function getModelVisionModes(): Record<string, ModelVisionMode> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const raw = config.get<Record<string, unknown>>('modelVisionModes');
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(raw)
			.map(([key, value]) => [key.trim(), normalizeModelVisionMode(value)] as const)
			.filter(
				(entry): entry is readonly [string, ModelVisionMode] =>
					entry[0].length > 0 && entry[1] !== undefined,
			),
	);
}

export function getCustomModels(): ModelDefinition[] {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const raw = config.get<unknown[]>('customModels', []);
	if (!Array.isArray(raw)) {
		return [];
	}

	const byId = new Map<string, ModelDefinition>();
	for (const entry of raw) {
		const model = normalizeCustomModel(entry);
		if (model) {
			byId.set(model.id, model);
		}
	}
	return [...byId.values()];
}

export function listProviderModels(): ModelDefinition[] {
	const byId = new Map(MODELS.map((model) => [model.id, model]));
	for (const model of getCustomModels()) {
		byId.set(model.id, model);
	}
	return [...byId.values()];
}

export function findModelDefinition(modelId: string): ModelDefinition | undefined {
	return listProviderModels().find((model) => model.id === modelId);
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
 * Reads the *effective* (cross-scope merged) legacy values so that users who
 * split their legacy keys across scopes (e.g. `region` at Global,
 * `apiMode` at Workspace) get a correct migration result.
 *
 * Writes the new endpoint to the most-specific scope that had any legacy key,
 * then clears legacy keys at all scopes.  Idempotent: a second run finds no
 * legacy values and exits immediately.
 */
export async function migrateLegacyEndpointSettings(): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

	// Effective (cross-scope merged) endpoint — if already set explicitly the
	// migration only needs to clean up stale legacy keys.
	const effectiveEndpoint = normalizeEndpointPreset(config.get<string>('endpoint'));

	// Effective legacy values (VS Code merges across Global → Workspace →
	// WorkspaceFolder automatically via config.get).
	const effectiveRegion = config.get<string>('region');
	const effectiveApiMode = config.get<string>('apiMode');
	const effectiveApiProtocol = config.get<string>('apiProtocol');

	const region = normalizeApiRegion(effectiveRegion, undefined);
	const apiMode = normalizeApiMode(effectiveApiMode, undefined);
	const apiProtocol = normalizeApiProtocol(effectiveApiProtocol, undefined);

	if (region === undefined && apiMode === undefined && apiProtocol === undefined) {
		return;
	}

	const preset = deriveEndpointPreset(
		region ?? DEFAULT_API_REGION,
		apiMode ?? DEFAULT_API_MODE,
		apiProtocol ?? DEFAULT_API_PROTOCOL,
	);

	if (!effectiveEndpoint) {
		// Determine the most specific scope(s) that have any legacy key, and
		// write the new endpoint there so VS Code's scope-precedence picks it
		// up. WorkspaceFolder requires a resource-scoped config object — the
		// section-scoped `config` above throws when ConfigurationTarget.
		// WorkspaceFolder is passed without a resource URI (same root cause as
		// the legacy-key cleanup below). Furthermore, in a multi-root workspace
		// `config.inspect(...).workspaceFolderValue` is undefined (no specific
		// resource is associated), so WorkspaceFolder legacy keys are only
		// discoverable by inspecting each folder individually. Write the preset
		// to every folder that carries a legacy key, plus the most specific of
		// Workspace/Global when those scopes hold legacy keys.
		await writeDerivedEndpointPreset(config, preset);
	}

	// Clear legacy keys at Global and Workspace scopes.  WorkspaceFolder
	// requires a resource-scoped config object (the section-scoped config
	// used above throws when ConfigurationTarget.WorkspaceFolder is passed
	// without a resource URI).  Iterate workspace folders separately below.
	// Failures are non-fatal — the new endpoint preset takes precedence at
	// runtime regardless.
	for (const target of [
		vscode.ConfigurationTarget.Global,
		vscode.ConfigurationTarget.Workspace,
	] as const) {
		try {
			await config.update('region', undefined, target);
		} catch {
			/* non-fatal */
		}
		try {
			await config.update('apiMode', undefined, target);
		} catch {
			/* non-fatal */
		}
		try {
			await config.update('apiProtocol', undefined, target);
		} catch {
			/* non-fatal */
		}
	}
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const folderConfig = vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri);
		try {
			await folderConfig.update('region', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
		} catch {
			/* non-fatal */
		}
		try {
			await folderConfig.update('apiMode', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
		} catch {
			/* non-fatal */
		}
		try {
			await folderConfig.update(
				'apiProtocol',
				undefined,
				vscode.ConfigurationTarget.WorkspaceFolder,
			);
		} catch {
			/* non-fatal */
		}
	}
}

/**
 * Write the derived endpoint preset to the most-specific scope(s) that carry at
 * least one legacy key.
 *
 * WorkspaceFolder keys require a resource-scoped config and are invisible to a
 * section-scoped `inspect()` in multi-root workspaces, so each folder is
 * inspected individually and the preset is written to every folder that has a
 * legacy key. The single-section config handles Workspace/Global. Failures are
 * non-fatal — the runtime endpoint resolver falls back to defaults.
 */
async function writeDerivedEndpointPreset(
	config: vscode.WorkspaceConfiguration,
	preset: string,
): Promise<void> {
	// WorkspaceFolder: per-folder resource-scoped writes.
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const folderConfig = vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri);
		const regionInspect = folderConfig.inspect<string>('region');
		const apiModeInspect = folderConfig.inspect<string>('apiMode');
		const apiProtocolInspect = folderConfig.inspect<string>('apiProtocol');
		if (
			regionInspect?.workspaceFolderValue !== undefined ||
			apiModeInspect?.workspaceFolderValue !== undefined ||
			apiProtocolInspect?.workspaceFolderValue !== undefined
		) {
			try {
				await folderConfig.update('endpoint', preset, vscode.ConfigurationTarget.WorkspaceFolder);
			} catch {
				/* non-fatal */
			}
		}
	}

	// Workspace scope.
	const wsRegionInspect = config.inspect<string>('region');
	const wsApiModeInspect = config.inspect<string>('apiMode');
	const wsApiProtocolInspect = config.inspect<string>('apiProtocol');
	if (
		wsRegionInspect?.workspaceValue !== undefined ||
		wsApiModeInspect?.workspaceValue !== undefined ||
		wsApiProtocolInspect?.workspaceValue !== undefined
	) {
		try {
			await config.update('endpoint', preset, vscode.ConfigurationTarget.Workspace);
		} catch {
			/* non-fatal */
		}
		return;
	}

	// Global scope (only when no Workspace legacy key exists, to avoid a
	// lower-precedence Global write shadowing behaviour unexpectedly).
	if (
		wsRegionInspect?.globalValue !== undefined ||
		wsApiModeInspect?.globalValue !== undefined ||
		wsApiProtocolInspect?.globalValue !== undefined
	) {
		try {
			await config.update('endpoint', preset, vscode.ConfigurationTarget.Global);
		} catch {
			/* non-fatal */
		}
	}
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
	return value === 'proxy' || value === 'native' ? value : undefined;
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
