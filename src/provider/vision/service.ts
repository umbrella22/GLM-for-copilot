import vscode from 'vscode';
import type { AuthManager } from '../../auth';
import { getApiModelId, getAutomaticGLMVisionModelId, resolveModelConnection } from '../../config';
import { resolveEndpointRegion, resolvePresetBaseUrl } from '../../endpoint';
import { t } from '../../i18n';
import { CODING_PLAN_GLM_VISION_MODEL_ID, DEFAULT_GLM_VISION_MODEL_ID } from './consts';
import {
	logAutomaticGLMVisionFallback,
	logAutomaticGLMVisionModelSelected,
	logInvalidVisionProxyApiEndpointConfig,
	logVisionApiEndpointSelected,
} from './log';
import { isVisionProxyError, VisionProxyError } from './protocols/errors';
import { createEndpointVisionDescriber } from './sources/endpoint';
import { VISION_PROXY_API_KEY_SECRET, VisionProxyConfigStore } from './sources/endpoint/config';
import { createVSCodeLanguageModelVisionDescriberGetter } from './sources/vscode';
import type { VisionDescriber, VisionProxyConfig } from './types';
import { openVisionProxyPanel } from './ui/panel';

interface ApiEndpointConfigResult {
	config?: VisionProxyConfig;
	error?: unknown;
}

export function createVisionService(
	context: vscode.ExtensionContext,
	authManager: AuthManager,
): {
	get: (resource?: vscode.Uri) => Promise<VisionDescriber | undefined>;
	reset: () => void;
	openConfiguration: () => Promise<void>;
} {
	const store = new VisionProxyConfigStore(context);
	const vscodeLm = createVSCodeLanguageModelVisionDescriberGetter();
	// The Coding Plan switch notice fires once per extension session, the
	// first time the automatic proxy describes an image through GLM-5.3-Flash.
	let codingPlanVisionNoticeShown = false;

	const reset = (): void => {
		vscodeLm.reset();
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('glm-copilot.visionModel')) {
				reset();
			}
		}),
		context.secrets.onDidChange((event) => {
			if (event.key === VISION_PROXY_API_KEY_SECRET) {
				reset();
			}
		}),
	);

	return {
		async get(resource?: vscode.Uri) {
			const source = store.getSource();
			if (source === 'vscode-lm') {
				return vscodeLm.get();
			}

			if (source === 'api-endpoint') {
				const result = getApiEndpointConfig(store, true);
				if (!result.config) {
					if (!result.error) {
						return undefined;
					}
					return createInvalidApiEndpointDescriber(result.error);
				}
				const apiKey = await store.getApiKey();
				const describer = createEndpointVisionDescriber(result.config, apiKey);
				logVisionApiEndpointSelected(describer.id);
				return describer;
			}

			if (source === undefined) {
				const result = getApiEndpointConfig(store, false);
				if (result.config) {
					const apiKey = await store.getApiKey();
					const describer = createEndpointVisionDescriber(result.config, apiKey);
					logVisionApiEndpointSelected(describer.id);
					return describer;
				}
			}

			// Automatic mode picks the vision model from the active connection:
			// GLM-5.3-Flash on Coding Plan endpoints, GLM-4.6V-Flash on Standard
			// API endpoints (pay-as-you-go callers keep the previous behavior).
			const visionModelId = getAutomaticGLMVisionModelId(resource);
			const connection = resolveModelConnection(visionModelId, resource);
			const apiKey = await authManager.getApiKey(connection.credentialChannel, resource);
			if (!apiKey) {
				return vscodeLm.get();
			}
			const config = createAutomaticGLMVisionConfig(connection, resource, visionModelId);
			const primary = createEndpointVisionDescriber(config, apiKey);
			logAutomaticGLMVisionModelSelected(primary.id, config.url);
			if (!codingPlanVisionNoticeShown && visionModelId !== DEFAULT_GLM_VISION_MODEL_ID) {
				codingPlanVisionNoticeShown = true;
				void vscode.window.showInformationMessage(t('vision.auto.codingPlanModelSwitched'));
			}
			return new AutomaticVisionDescriber(primary, () => vscodeLm.get());
		},

		reset,

		async openConfiguration() {
			openVisionProxyPanel(context, { onDidChange: reset });
		},
	};
}

class AutomaticVisionDescriber implements VisionDescriber {
	readonly source = 'auto';

	constructor(
		private readonly primary: VisionDescriber,
		private readonly getFallback: () => Promise<VisionDescriber | undefined>,
	) {}

	get id(): string {
		return `auto:${this.primary.id}`;
	}

	async describe(request: Parameters<VisionDescriber['describe']>[0]): Promise<string> {
		try {
			return await this.primary.describe(request);
		} catch (error) {
			if (request.token.isCancellationRequested || isCancelledVisionError(error)) {
				throw error;
			}
			logAutomaticGLMVisionFallback(this.primary.id, error);
			const fallback = await this.getFallback();
			if (!fallback) {
				throw error;
			}
			return fallback.describe(request);
		}
	}
}

function createAutomaticGLMVisionConfig(
	connection: ReturnType<typeof resolveModelConnection>,
	resource: vscode.Uri | undefined,
	visionModelId: string,
): VisionProxyConfig {
	// Keep the automatic GLM proxy on the OpenAI-compatible vision transport.
	// Anthropic is a valid main-chat protocol, but GLM vision availability can
	// differ there; use the matching region's Coding Plan endpoint instead.
	const baseUrl =
		connection.protocol === 'anthropic'
			? resolvePresetBaseUrl('coding-plan', resolveEndpointRegion(connection.endpoint))
			: connection.baseUrl;
	return {
		providerFamily: 'openai-compatible',
		apiType: 'chat-completions',
		url: `${baseUrl}/chat/completions`,
		modelId: getApiModelId(visionModelId, resource),
		// GLM-5.3-Flash cannot disable thinking; without an explicit effort it
		// reasons at the API default (max), which is needlessly slow for image
		// transcription. 'high' balances description quality and latency.
		...(visionModelId === CODING_PLAN_GLM_VISION_MODEL_ID
			? { extraBody: { reasoning_effort: 'high' } }
			: {}),
		updatedAt: Date.now(),
	};
}

function isCancelledVisionError(error: unknown): boolean {
	return isVisionProxyError(error) && error.code === 'cancelled';
}

function getApiEndpointConfig(
	store: VisionProxyConfigStore,
	explicitApiEndpointSource: boolean,
): ApiEndpointConfigResult {
	try {
		return { config: store.getConfig() };
	} catch (error) {
		logInvalidVisionProxyApiEndpointConfig(store.getSource(), explicitApiEndpointSource, error);
		return { error };
	}
}

function createInvalidApiEndpointDescriber(error: unknown): VisionDescriber {
	return {
		id: 'api-endpoint:invalid-configuration',
		source: 'api-endpoint',
		async describe(): Promise<string> {
			if (isVisionProxyError(error)) {
				throw error;
			}
			throw new VisionProxyError(
				'missing-configuration',
				t('vision.proxy.error.configurationInvalid'),
				undefined,
				error,
			);
		},
	};
}
