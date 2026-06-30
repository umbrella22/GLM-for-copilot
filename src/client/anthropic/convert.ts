import type { GLMMessage, GLMRequest, GLMTool } from "../../types";

// ---- Anthropic Messages API types ----

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  thinking?: { type: "enabled"; budget_tokens: number };
}

const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
const DEFAULT_THINKING_BUDGET_TOKENS = 4096;
// Anthropic requires thinking.budget_tokens to be at least 1024.
const MIN_THINKING_BUDGET_TOKENS = 1024;

/**
 * Convert an internal GLMRequest to Anthropic Messages API format.
 */
export function convertToAnthropicRequest(
  request: GLMRequest,
): AnthropicRequest {
  const messages = convertMessages(request.messages);
  const system = extractSystem(request.messages);
  const tools = request.tools?.length
    ? request.tools.map(convertTool)
    : undefined;

  const maxTokens = request.max_tokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
  const anthropicRequest: AnthropicRequest = {
    model: request.model,
    max_tokens: maxTokens,
    messages,
    stream: request.stream,
  };

  if (system) {
    anthropicRequest.system = system;
  }

  if (tools) {
    anthropicRequest.tools = tools;
  }

  if (request.temperature !== undefined) {
    anthropicRequest.temperature = request.temperature;
  }

  if (request.top_p !== undefined) {
    anthropicRequest.top_p = request.top_p;
  }

  // Convert thinking configuration.
  // Anthropic requires thinking.budget_tokens to be >= 1024 and strictly less
  // than max_tokens; a budget that equals/exceeds max_tokens yields HTTP 400.
  // Previously the budget was a fixed 4096, which equalled the default
  // max_tokens (also 4096) and broke thinking on the Anthropic protocol out of
  // the box. Derive a safe budget from the effective max_tokens instead.
  if (request.thinking?.type === "enabled") {
    const budgetTokens = Math.min(
      DEFAULT_THINKING_BUDGET_TOKENS,
      Math.max(MIN_THINKING_BUDGET_TOKENS, maxTokens - 1),
    );
    // Only enable thinking when a valid budget exists: Anthropic requires
    // budget_tokens to be >= 1024 and strictly < max_tokens. With max_tokens
    // <= 1024 there is no budget satisfying both, so omit the field (the request
    // succeeds without extended thinking) rather than send one the API rejects
    // with HTTP 400.
    if (budgetTokens < maxTokens) {
      anthropicRequest.thinking = {
        type: "enabled",
        budget_tokens: budgetTokens,
      };
    }
  }

  return anthropicRequest;
}

/**
 * Extract the system prompt from the messages array.
 * In Anthropic format, system is a top-level field, not a message.
 */
function extractSystem(messages: GLMMessage[]): string | undefined {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      parts.push(msg.content);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * Convert GLM messages to Anthropic messages.
 * - System messages are excluded (handled separately).
 * - Tool call messages are converted to assistant content blocks with tool_use.
 * - Tool result messages use Anthropic's `tool_result` format.
 *
 * Anthropic requires `user`/`assistant` roles to strictly alternate. A multi-turn
 * agent flow can produce sequences that violate this once converted to Anthropic:
 *   - Several parallel tool calls yield one `tool_result` GLM message per result,
 *     which would each become a separate `user` message.
 *   - A tool result followed by a user text message yields `user` → `user`.
 * Adjacent same-role messages are therefore merged into a single message whose
 * content is the concatenation of the blocks, which is what Anthropic expects.
 */
function convertMessages(messages: GLMMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      continue; // Already extracted
    }

    if (msg.role === "tool") {
      // Anthropic expects tool results as user messages with tool_result content blocks
      if (!msg.tool_call_id) {
        throw new Error("Tool message is missing tool_call_id");
      }
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: msg.content,
      };
      appendContentBlock(result, "user", block);
      continue;
    }

    if (
      msg.role === "assistant" &&
      msg.tool_calls &&
      msg.tool_calls.length > 0
    ) {
      const blocks: AnthropicContentBlock[] = [];

      // Include text content if present
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }

      // Include reasoning content as text if present (Anthropic doesn't have a direct equivalent in messages)
      // Note: reasoning_content from previous turns is typically omitted

      // Convert tool calls to tool_use blocks
      for (const tc of msg.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // If arguments are not valid JSON, store as raw string
          input = { _raw: tc.function.arguments };
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }

      for (const block of blocks) {
        appendContentBlock(result, "assistant", block);
      }
      continue;
    }

    // Regular user/assistant messages
    const role = msg.role as "user" | "assistant";
    const block: AnthropicContentBlock = { type: "text", text: msg.content };
    appendContentBlock(result, role, block);
  }

  return result;
}

/**
 * Append a content block to the message list, merging it into the previous
 * message when it shares the same role. This keeps `user`/`assistant` strictly
 * alternating as Anthropic requires. A standalone string content is promoted to
 * a `text` content block so it can be merged alongside tool blocks.
 */
function appendContentBlock(
  messages: AnthropicMessage[],
  role: "user" | "assistant",
  block: AnthropicContentBlock,
): void {
  const last = messages[messages.length - 1];
  if (last && last.role === role && Array.isArray(last.content)) {
    last.content.push(block);
    return;
  }
  messages.push({ role, content: [block] });
}

/**
 * Convert an internal GLM tool definition to Anthropic format.
 */
function convertTool(tool: GLMTool): AnthropicTool {
  const parameters = tool.function.parameters ?? {};
  const properties = (parameters as Record<string, unknown>).properties as
    | Record<string, unknown>
    | undefined;
  const required = (parameters as Record<string, unknown>).required as
    | string[]
    | undefined;

  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: "object",
      properties: properties ?? {},
      ...(required ? { required } : {}),
    },
  };
}
