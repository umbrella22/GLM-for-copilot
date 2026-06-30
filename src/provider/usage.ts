import { identifyOfficialGLMPlatform, normalizeBaseUrl } from "../endpoint";

const USAGE_TIMEOUT_MS = 15_000;

export interface GLMPlanUsageResult {
  platform: "ZAI" | "ZHIPU";
  baseDomain: string;
  startTime: string;
  endTime: string;
  modelUsage: unknown;
  toolUsage: unknown;
  quotaLimit: unknown;
}

export function supportsGLMPlanUsage(baseUrl: string): boolean {
  return identifyOfficialGLMPlatform(baseUrl) !== undefined;
}

export async function queryGLMPlanUsage(
  baseUrl: string,
  authToken: string,
): Promise<GLMPlanUsageResult> {
  const platform = identifyOfficialGLMPlatform(baseUrl);
  if (!platform) {
    throw new Error("Unsupported GLM baseUrl");
  }

  const baseDomain = getBaseDomain(baseUrl);
  const { startTime, endTime } = createUsageWindow();
  const queryParams = new URLSearchParams({ startTime, endTime });
  // Combine a manual controller with the timeout so that if any one request
  // fails, the remaining in-flight requests are cancelled instead of being
  // orphaned (they would otherwise keep consuming connections/quota).
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(USAGE_TIMEOUT_MS),
  ]);

  try {
    const [modelUsage, toolUsage, quotaLimit] = await Promise.all([
      queryUsageEndpoint(
        `${baseDomain}/api/monitor/usage/model-usage?${queryParams}`,
        authToken,
        signal,
      ),
      queryUsageEndpoint(
        `${baseDomain}/api/monitor/usage/tool-usage?${queryParams}`,
        authToken,
        signal,
      ),
      queryUsageEndpoint(
        `${baseDomain}/api/monitor/usage/quota/limit`,
        authToken,
        signal,
      ).then(processQuotaLimit),
    ]);

    return {
      platform: platform === "zai" ? "ZAI" : "ZHIPU",
      baseDomain,
      startTime,
      endTime,
      modelUsage,
      toolUsage,
      quotaLimit,
    };
  } catch (error) {
    throw error;
  } finally {
    // Always abort the controller so the AbortSignal is torn down
    // and doesn't hold references — previously only aborted on error.
    controller.abort();
  }
}

export function formatGLMPlanUsageForLog(result: GLMPlanUsageResult): string {
  return [
    `GLM Coding Plan usage`,
    `platform=${result.platform}`,
    `baseDomain=${result.baseDomain}`,
    `window=${result.startTime} -> ${result.endTime}`,
    `modelUsage=${JSON.stringify(result.modelUsage, null, 2)}`,
    `toolUsage=${JSON.stringify(result.toolUsage, null, 2)}`,
    `quotaLimit=${JSON.stringify(result.quotaLimit, null, 2)}`,
  ].join("\n");
}

function getBaseDomain(baseUrl: string): string {
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  return `${parsed.protocol}//${parsed.host}`;
}

function createUsageWindow(now = new Date()): {
  startTime: string;
  endTime: string;
} {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    now.getHours(),
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    59,
    59,
    999,
  );
  return {
    startTime: formatDateTime(start),
    endTime: formatDateTime(end),
  };
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function queryUsageEndpoint(
  url: string,
  authToken: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authToken,
      "Accept-Language": "en-US,en",
      "Content-Type": "application/json",
    },
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${truncate(text)}`);
  }

  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    return parsed.data ?? parsed;
  } catch {
    return text;
  }
}

function processQuotaLimit(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data.limits)) {
    return data;
  }

  return {
    ...data,
    limits: data.limits.map((item) => {
      if (!isRecord(item)) {
        return item;
      }
      if (item.type === "TOKENS_LIMIT") {
        return {
          type: "Token usage (5 hours)",
          percentage: item.percentage,
        };
      }
      if (item.type === "TIME_LIMIT") {
        return {
          type: "MCP usage (1 month)",
          percentage: item.percentage,
          currentUsage: item.currentValue,
          total: item.usage,
          usageDetails: item.usageDetails,
        };
      }
      return item;
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 500
    ? `${singleLine.slice(0, 500)}...`
    : singleLine;
}
