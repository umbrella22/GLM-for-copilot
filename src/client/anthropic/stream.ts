import { logger } from "../../logger";
import type { GLMUsage, StreamCallbacks } from "../../types";

// ---- Anthropic SSE event types ----

interface AnthropicSSEEvent {
  type:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop"
    | "ping"
    | "error";
  message?: {
    id: string;
    model: string;
    usage: {
      input_tokens: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  content_block?: {
    type: "text" | "thinking" | "tool_use";
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type: "text_delta" | "thinking_delta" | "input_json_delta";
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  index?: number;
  usage?: { output_tokens: number; input_tokens?: number };
  error?: { type: string; message: string };
}

/**
 * State for tracking in-progress content blocks across SSE events.
 */
interface AnthropicStreamState {
  /** Total input tokens from message_start (for final usage reporting). */
  inputTokens: number;
  /** Latest output tokens from message_delta (for final usage reporting). */
  outputTokens: number;
  /** Prompt-cache hit tokens (cache_read_input_tokens); drives cache pricing. */
  cacheReadTokens: number;
  /** Tokens written to the prompt cache (cache_creation_input_tokens). */
  cacheCreationTokens: number;
  /** Content blocks indexed by position, tracking type and accumulated text. */
  textBlocks: Map<number, { type: string; text: string }>;
  /** Tool use blocks indexed by position. */
  toolBlocks: Map<number, { id: string; name: string; input: string }>;
  /** Emitted tool call IDs to avoid duplicates. */
  emittedToolCallIds: Set<string>;
}

/**
 * Parse an Anthropic SSE stream and dispatch to the standard StreamCallbacks.
 *
 * The Anthropic SSE format uses named events:
 * - `message_start`: initial metadata with input token usage
 * - `content_block_start`: a new content block begins (text, thinking, or tool_use)
 * - `content_block_delta`: incremental content for the current block
 * - `content_block_stop`: the current block is complete
 * - `message_delta`: stop reason and output token usage
 * - `message_stop`: end of the complete message
 * - `ping`: keepalive, ignored
 */
export async function parseAnthropicStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const state: AnthropicStreamState = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    textBlocks: new Map(),
    toolBlocks: new Map(),
    emittedToolCallIds: new Set(),
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // Anthropic SSE events are separated by double newlines.
    // Normalise \r\n → \n first so that \r\n\r\n (common behind
    // proxies that canonicalise line-endings) is also recognised.
    const normalized = buffer.replace(/\r\n/g, "\n");
    const events = normalized.split("\n\n");
    // The last segment may be incomplete
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      if (!rawEvent.trim()) {
        continue;
      }

      const event = parseAnthropicSSEEvent(rawEvent);
      if (!event) {
        continue;
      }

      processAnthropicEvent(event, state, callbacks);
    }
  }

  // Flush the TextDecoder (it may buffer a partial multi-byte sequence) and
  // process any trailing event that lacked a terminating blank line. Without
  // this, a final `message_delta`/`message_stop` (or usage) frame can be lost
  // when the server omits the trailing `\n\n`, which is common behind proxies/CDNs.
  buffer += decoder.decode();
  // Split by double newlines to handle multiple trailing events that may
  // have been buffered without a terminating blank line (common behind
  // proxies/CDNs). Previously only the first event in the buffer was
  // processed and the rest were silently dropped.
  const normalizedTail = buffer.replace(/\r\n/g, "\n");
  const tailEvents = normalizedTail.split("\n\n");
  for (const rawEvent of tailEvents) {
    if (!rawEvent.trim()) {
      continue;
    }
    const event = parseAnthropicSSEEvent(rawEvent);
    if (event) {
      processAnthropicEvent(event, state, callbacks);
    }
  }
  buffer = "";

  // Flush any remaining tool blocks
  flushToolBlocks(state, callbacks);

  // Report final usage
  reportAnthropicUsage(state, callbacks);

  callbacks.onDone();
}

/**
 * Parse a single Anthropic SSE event from raw text.
 */
function parseAnthropicSSEEvent(raw: string): AnthropicSSEEvent | null {
  const lines = raw.split("\n");
  let eventType = "";
  let dataJson = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event: ")) {
      eventType = trimmed.slice(7).trim();
    } else if (trimmed.startsWith("data: ")) {
      dataJson = trimmed.slice(6).trim();
    }
  }

  if (!dataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(dataJson) as Record<string, unknown>;

    // Validate the event type to guard against malformed server SSE frames
    // that could produce misshapen objects and silently corrupt stream state.
    const resolvedType = (eventType || (parsed.type as string)) as string;
    if (!isValidAnthropicEventType(resolvedType)) {
      logger.warn("Unknown Anthropic SSE event type:", resolvedType);
      return null;
    }

    return {
      type: resolvedType as AnthropicSSEEvent["type"],
      ...parsed,
    } as AnthropicSSEEvent;
  } catch (e) {
    logger.error(
      "Failed to parse Anthropic SSE event:",
      dataJson.slice(0, 200),
      e,
    );
    return null;
  }
}

const VALID_ANTHROPIC_EVENT_TYPES = new Set([
  "message_start",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "message_delta",
  "message_stop",
  "ping",
  "error",
]);

function isValidAnthropicEventType(type: string): boolean {
  return VALID_ANTHROPIC_EVENT_TYPES.has(type);
}

/**
 * Process a parsed Anthropic SSE event and dispatch to callbacks.
 */
function processAnthropicEvent(
  event: AnthropicSSEEvent,
  state: AnthropicStreamState,
  callbacks: StreamCallbacks,
): void {
  switch (event.type) {
    case "message_start":
      if (event.message?.usage) {
        // Anthropic splits input usage into three non-overlapping buckets:
        // input_tokens (uncached), cache_creation_input_tokens (written to
        // cache) and cache_read_input_tokens (served from cache). Capture all
        // three so the reported prompt_tokens can be reconstructed as the true
        // total (Anthropic's input_tokens excludes the cache buckets).
        state.inputTokens = event.message.usage.input_tokens;
        state.cacheReadTokens =
          event.message.usage.cache_read_input_tokens ?? 0;
        state.cacheCreationTokens =
          event.message.usage.cache_creation_input_tokens ?? 0;
      }
      break;

    case "content_block_start": {
      const block = event.content_block;
      const idx = event.index ?? 0;
      if (!block) break;

      if (block.type === "text") {
        state.textBlocks.set(idx, { type: "text", text: block.text ?? "" });
      } else if (block.type === "thinking") {
        state.textBlocks.set(idx, {
          type: "thinking",
          text: block.thinking ?? "",
        });
      } else if (block.type === "tool_use") {
        // Per the Anthropic streaming protocol, `content_block_start` carries an
        // empty `{}` placeholder for tool_use and the real arguments arrive
        // incrementally via `input_json_delta`. Seeding the accumulator with
        // `JSON.stringify({})` (i.e. `"{}"`) would prepend a stray object to the
        // delta JSON, yielding invalid JSON like `{}{\"location\":\"SF\"}` and
        // silently dropping every tool argument. Only honour a non-empty initial
        // payload to stay compatible with gateways that send the full input up front.
        const initialInput =
          block.input &&
          typeof block.input === "object" &&
          Object.keys(block.input).length > 0
            ? JSON.stringify(block.input)
            : "";
        state.toolBlocks.set(idx, {
          id: block.id ?? "",
          name: block.name ?? "",
          input: initialInput,
        });
      }
      break;
    }

    case "content_block_delta": {
      const delta = event.delta;
      const idx = event.index ?? 0;
      if (!delta) break;

      switch (delta.type) {
        case "text_delta": {
          const text = delta.text ?? "";
          // Append to tracking
          const existing = state.textBlocks.get(idx);
          if (existing) {
            existing.text += text;
          }
          callbacks.onContent(text);
          break;
        }
        case "thinking_delta": {
          const thinking = delta.thinking ?? "";
          const existing = state.textBlocks.get(idx);
          if (existing) {
            existing.text += thinking;
          }
          callbacks.onThinking(thinking);
          break;
        }
        case "input_json_delta": {
          const partial = delta.partial_json ?? "";
          const existing = state.toolBlocks.get(idx);
          if (existing) {
            existing.input += partial;
          }
          break;
        }
      }
      break;
    }

    case "content_block_stop": {
      const idx = event.index ?? 0;
      // Emit completed tool calls
      const toolBlock = state.toolBlocks.get(idx);
      if (toolBlock && !state.emittedToolCallIds.has(toolBlock.id)) {
        state.emittedToolCallIds.add(toolBlock.id);
        let args = toolBlock.input;
        try {
          // Parse and re-stringify for clean JSON
          args = JSON.stringify(JSON.parse(toolBlock.input));
        } catch {
          // Keep as-is if parsing fails
        }
        callbacks.onToolCall({
          id: toolBlock.id,
          type: "function",
          function: {
            name: toolBlock.name,
            arguments: args,
          },
        });
      }
      break;
    }

    case "message_delta":
      if (event.usage?.output_tokens) {
        state.outputTokens = event.usage.output_tokens;
      }
      break;

    case "message_stop":
      // Final flush and usage handled by the outer parseAnthropicStream
      break;

    case "ping":
      // Keepalive, ignore
      break;

    case "error":
      // Throw instead of calling callbacks.onError. The stream's onError
      // callback (see provider/stream.ts) rethrows the error to abort the
      // stream, which would propagate out of parseAnthropicStream and be
      // caught by core.ts's outer catch — which then calls onError a second
      // time. Throwing here keeps the single onError invocation in core.ts,
      // matching the OpenAI path where errors only surface through the outer
      // catch. The throw also skips the trailing flushToolBlocks/onDone.
      if (event.error) {
        throw new Error(
          `Anthropic API error: ${event.error.type} - ${event.error.message}`,
        );
      }
      break;

    default:
      break;
  }
}

/**
 * Flush any remaining tool blocks that haven't been emitted.
 */
function flushToolBlocks(
  state: AnthropicStreamState,
  callbacks: StreamCallbacks,
): void {
  for (const [, block] of state.toolBlocks) {
    if (block.id && !state.emittedToolCallIds.has(block.id)) {
      state.emittedToolCallIds.add(block.id);
      let args = block.input;
      try {
        args = JSON.stringify(JSON.parse(block.input));
      } catch {
        // Keep as-is
      }
      callbacks.onToolCall({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: args,
        },
      });
    }
  }
}

/**
 * Report usage from the Anthropic stream.
 * Combines input tokens (from message_start) and output tokens (from message_delta).
 */
function reportAnthropicUsage(
  state: AnthropicStreamState,
  callbacks: StreamCallbacks,
): void {
  if (!callbacks.onUsage) {
    return;
  }

  // Anthropic's input_tokens excludes the cache buckets, so the real prompt
  // total is the sum of all three. Map cache_read to the cache-hit field so
  // pricing applies the cache rate; cache_creation has no 2-tier equivalent and
  // stays in the derived miss bucket (prompt - hit = input + creation).
  const promptTokens =
    state.inputTokens + state.cacheCreationTokens + state.cacheReadTokens;

  const usage: GLMUsage = {
    prompt_tokens: promptTokens,
    completion_tokens: state.outputTokens,
    total_tokens: promptTokens + state.outputTokens,
  };

  if (state.cacheReadTokens > 0) {
    usage.prompt_cache_hit_tokens = state.cacheReadTokens;
    usage.prompt_tokens_details = { cached_tokens: state.cacheReadTokens };
  }

  callbacks.onUsage(usage);
}
