import vscode from "vscode";
import type { AuthManager } from "../../auth";
import { getApiModelId, getApiProtocol, getBaseUrl } from "../../config";
import { GLM_CN_CODING_BASE_URL } from "../../endpoint";
import { t } from "../../i18n";
import { DEFAULT_GLM_VISION_MODEL_ID } from "./consts";
import {
  logAutomaticGLMVisionFallback,
  logAutomaticGLMVisionModelSelected,
  logInvalidVisionProxyApiEndpointConfig,
  logVisionApiEndpointSelected,
} from "./log";
import { isVisionProxyError, VisionProxyError } from "./protocols/errors";
import { createEndpointVisionDescriber } from "./sources/endpoint";
import {
  VISION_PROXY_API_KEY_SECRET,
  VisionProxyConfigStore,
} from "./sources/endpoint/config";
import { createVSCodeLanguageModelVisionDescriberGetter } from "./sources/vscode";
import type { VisionDescriber, VisionProxyConfig } from "./types";
import { openVisionProxyPanel } from "./ui/panel";

interface ApiEndpointConfigResult {
  config?: VisionProxyConfig;
  error?: unknown;
}

export function createVisionService(
  context: vscode.ExtensionContext,
  authManager: AuthManager,
): {
  get: () => Promise<VisionDescriber | undefined>;
  reset: () => void;
  openConfiguration: () => Promise<void>;
} {
  const store = new VisionProxyConfigStore(context);
  const vscodeLm = createVSCodeLanguageModelVisionDescriberGetter();

  const reset = (): void => {
    vscodeLm.reset();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("glm-copilot.visionModel")) {
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
    async get() {
      const source = store.getSource();
      if (source === "vscode-lm") {
        return vscodeLm.get();
      }

      if (source === "api-endpoint") {
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
          const describer = createEndpointVisionDescriber(
            result.config,
            apiKey,
          );
          logVisionApiEndpointSelected(describer.id);
          return describer;
        }
      }

      const config = createAutomaticGLMVisionConfig();
      const apiKey = await authManager.getApiKey();
      const primary = createEndpointVisionDescriber(config, apiKey);
      logAutomaticGLMVisionModelSelected(primary.id, config.url);
      return new AutomaticVisionDescriber(primary, () => vscodeLm.get());
    },

    reset,

    async openConfiguration() {
      openVisionProxyPanel(context, { onDidChange: reset });
    },
  };
}

class AutomaticVisionDescriber implements VisionDescriber {
  readonly source = "auto";

  constructor(
    private readonly primary: VisionDescriber,
    private readonly getFallback: () => Promise<VisionDescriber | undefined>,
  ) {}

  get id(): string {
    return `auto:${this.primary.id}`;
  }

  async describe(
    request: Parameters<VisionDescriber["describe"]>[0],
  ): Promise<string> {
    try {
      return await this.primary.describe(request);
    } catch (error) {
      if (
        request.token.isCancellationRequested ||
        isCancelledVisionError(error)
      ) {
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

function createAutomaticGLMVisionConfig(): VisionProxyConfig {
  // When the main chat protocol is Anthropic, the vision proxy still needs to use
  // the OpenAI-compatible endpoint because Anthropic vision endpoint availability
  // may differ. Fall back to the Coding Plan endpoint for vision descriptions.
  const protocol = getApiProtocol();
  const visionBaseUrl =
    protocol === "anthropic" ? GLM_CN_CODING_BASE_URL : getBaseUrl();

  return {
    providerFamily: "openai-compatible",
    apiType: "chat-completions",
    url: `${visionBaseUrl}/chat/completions`,
    modelId: getApiModelId(DEFAULT_GLM_VISION_MODEL_ID),
    updatedAt: Date.now(),
  };
}

function isCancelledVisionError(error: unknown): boolean {
  return isVisionProxyError(error) && error.code === "cancelled";
}

function getApiEndpointConfig(
  store: VisionProxyConfigStore,
  explicitApiEndpointSource: boolean,
): ApiEndpointConfigResult {
  try {
    return { config: store.getConfig() };
  } catch (error) {
    logInvalidVisionProxyApiEndpointConfig(
      store.getSource(),
      explicitApiEndpointSource,
      error,
    );
    return { error };
  }
}

function createInvalidApiEndpointDescriber(error: unknown): VisionDescriber {
  return {
    id: "api-endpoint:invalid-configuration",
    source: "api-endpoint",
    async describe(): Promise<string> {
      if (isVisionProxyError(error)) {
        throw error;
      }
      throw new VisionProxyError(
        "missing-configuration",
        t("vision.proxy.error.configurationInvalid"),
        undefined,
        error,
      );
    },
  };
}
