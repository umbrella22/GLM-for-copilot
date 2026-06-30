import type { ApiMode, ApiRegion, EndpointPreset } from "./types";

export const GLM_CN_API_HOST = "open.bigmodel.cn";
export const GLM_CN_LEGACY_API_HOST = "dev.bigmodel.cn";
export const GLM_INTERNATIONAL_API_HOST = "api.z.ai";

export const GLM_CN_CODING_BASE_URL = `https://${GLM_CN_API_HOST}/api/coding/paas/v4`;
export const GLM_CN_GENERAL_BASE_URL = `https://${GLM_CN_API_HOST}/api/paas/v4`;
export const GLM_CN_ANTHROPIC_BASE_URL = `https://${GLM_CN_API_HOST}/api/anthropic`;
export const GLM_INTERNATIONAL_CODING_BASE_URL = `https://${GLM_INTERNATIONAL_API_HOST}/api/coding/paas/v4`;
export const GLM_INTERNATIONAL_GENERAL_BASE_URL = `https://${GLM_INTERNATIONAL_API_HOST}/api/paas/v4`;
export const GLM_INTERNATIONAL_ANTHROPIC_BASE_URL = `https://${GLM_INTERNATIONAL_API_HOST}/api/anthropic`;
export const DEFAULT_GLM_BASE_URL = GLM_CN_CODING_BASE_URL;

/**
 * Default endpoint preset — domestic Coding Plan over the OpenAI protocol.
 *
 * Kept in sync with `DEFAULT_GLM_BASE_URL` so that the legacy single-setting
 * fallback and the new enum-based selection resolve to the same URL.
 */
export const DEFAULT_ENDPOINT_PRESET: EndpointPreset = "china-coding";

export const GLM_CN_CODING_API_KEY_URL =
  "https://bigmodel.cn/coding-plan/personal/overview";
export const GLM_CN_GENERAL_API_KEY_URL =
  "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys";
export const GLM_INTERNATIONAL_CODING_API_KEY_URL =
  "https://z.ai/manage-apikey/subscription";
export const GLM_INTERNATIONAL_GENERAL_API_KEY_URL =
  "https://z.ai/manage-apikey/apikey-list";

export type OfficialGLMPlatform = "zhipu" | "zai";

export function resolvePresetBaseUrl(
  apiMode: ApiMode,
  region: ApiRegion,
): string {
  if (region === "international") {
    return apiMode === "standard"
      ? GLM_INTERNATIONAL_GENERAL_BASE_URL
      : GLM_INTERNATIONAL_CODING_BASE_URL;
  }
  return apiMode === "standard"
    ? GLM_CN_GENERAL_BASE_URL
    : GLM_CN_CODING_BASE_URL;
}

export function resolveAnthropicBaseUrl(region: ApiRegion): string {
  // Both the CN (open.bigmodel.cn) and international (api.z.ai) platforms
  // expose an Anthropic-compatible `/api/anthropic` endpoint for Coding Plan.
  return region === "international"
    ? GLM_INTERNATIONAL_ANTHROPIC_BASE_URL
    : GLM_CN_ANTHROPIC_BASE_URL;
}

/**
 * Resolve the base URL for a single `endpoint` preset value.
 *
 * The preset encodes region + mode + protocol in one enum, removing the
 * combinatorial confusion of the legacy region/apiMode/apiProtocol trio.
 * The legacy resolver helpers above remain for backward compatibility.
 */
export function resolveEndpointBaseUrl(preset: EndpointPreset): string {
  switch (preset) {
    case "china-coding":
      return GLM_CN_CODING_BASE_URL;
    case "china-standard":
      return GLM_CN_GENERAL_BASE_URL;
    case "china-anthropic":
      return GLM_CN_ANTHROPIC_BASE_URL;
    case "international-coding":
      return GLM_INTERNATIONAL_CODING_BASE_URL;
    case "international-standard":
      return GLM_INTERNATIONAL_GENERAL_BASE_URL;
    case "international-anthropic":
      return GLM_INTERNATIONAL_ANTHROPIC_BASE_URL;
  }
}

/**
 * Resolve the "request an API key" landing page for a single preset value.
 */
export function resolveEndpointApiKeyUrl(preset: EndpointPreset): string {
  switch (preset) {
    case "china-coding":
      return GLM_CN_CODING_API_KEY_URL;
    case "china-standard":
      return GLM_CN_GENERAL_API_KEY_URL;
    case "china-anthropic":
      return GLM_CN_CODING_API_KEY_URL;
    case "international-coding":
      return GLM_INTERNATIONAL_CODING_API_KEY_URL;
    case "international-standard":
      return GLM_INTERNATIONAL_GENERAL_API_KEY_URL;
    case "international-anthropic":
      return GLM_INTERNATIONAL_CODING_API_KEY_URL;
  }
}

/**
 * The wire protocol implied by a preset value.
 */
export function resolveEndpointProtocol(
  preset: EndpointPreset,
): "openai" | "anthropic" {
  return preset === "china-anthropic" || preset === "international-anthropic"
    ? "anthropic"
    : "openai";
}

/**
 * Map the legacy (region, apiMode, apiProtocol) tuple onto the closest
 * `endpoint` preset. Used to migrate existing user settings transparently.
 *
 * `apiProtocol === "anthropic"` wins over `apiMode` because the protocol
 * uniquely implies the Anthropic endpoint path, while `apiMode` only varies
 * the OpenAI-style path.
 */
export function deriveEndpointPreset(
  region: ApiRegion,
  apiMode: ApiMode,
  apiProtocol: "openai" | "anthropic",
): EndpointPreset {
  if (apiProtocol === "anthropic") {
    return region === "international"
      ? "international-anthropic"
      : "china-anthropic";
  }
  if (region === "international") {
    return apiMode === "standard"
      ? "international-standard"
      : "international-coding";
  }
  return apiMode === "standard" ? "china-standard" : "china-coding";
}

export function resolveApiKeyUrl(apiMode: ApiMode, region: ApiRegion): string {
  if (region === "international") {
    return apiMode === "standard"
      ? GLM_INTERNATIONAL_GENERAL_API_KEY_URL
      : GLM_INTERNATIONAL_CODING_API_KEY_URL;
  }
  return apiMode === "standard"
    ? GLM_CN_GENERAL_API_KEY_URL
    : GLM_CN_CODING_API_KEY_URL;
}

export function identifyOfficialGLMPlatform(
  baseUrl: string,
): OfficialGLMPlatform | undefined {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === GLM_INTERNATIONAL_API_HOST) {
      return "zai";
    }
    if (host === GLM_CN_API_HOST || host === GLM_CN_LEGACY_API_HOST) {
      return "zhipu";
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function isOfficialGLMBaseUrl(baseUrl: string): boolean {
  return identifyOfficialGLMPlatform(baseUrl) !== undefined;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/u, "");
}
