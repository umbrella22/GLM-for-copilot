import type { CancellationToken } from 'vscode';
import { safeStringify } from '../json';
import { logger } from '../logger';
import type {
	ApiProtocol,
	GLMRequest,
	GLMStreamChunk,
	GLMToolCall,
	GLMUsage,
	StreamCallbacks,
} from '../types';
import { convertToAnthropicRequest, parseAnthropicStream } from './anthropic';
import { createHttpError, formatRequestError, normalizeRequestError } from './error';

/**
 * Lightweight SSE-streaming GLM API client.
 * No external dependencies — uses Node's built-in fetch.
 *
 * Supports both OpenAI-compatible (`/chat/completions`) and
 * Anthropic-compatible (`/v1/messages`) protocols.
 */
export class GLMClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		private readonly protocol: ApiProtocol = 'openai',
	) {}

	/**
	 * Stream a chat completion from the GLM API.
	 * Parses SSE chunks and dispatches callbacks for content, thinking, and tool calls.
	 */
	async streamChatCompletion(
		request: GLMRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		if (this.protocol === 'anthropic') {
			return this.streamAnthropicCompletion(request, callbacks, cancellationToken);
		}
		return this.streamOpenAIChatCompletion(request, callbacks, cancellationToken);
	}

	/**
	 * Stream using OpenAI-compatible `/chat/completions` endpoint.
	 */
	private async streamOpenAIChatCompletion(
		request: GLMRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});
		if (cancellationToken?.isCancellationRequested) {
			cancelListener?.dispose();
			controller.abort();
			return;
		}

		// Captured per-request so the `finally` can release the stream lock even
		// on the early `return` paths (cancellation / `[DONE]` sentinel).
		let releaseReader: (() => Promise<void>) | undefined;

		try {
			const response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: safeStringify(request),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw await createHttpError(response, {
					baseUrl: this.baseUrl,
					request,
				});
			}

			if (!response.body) {
				throw new Error('No response body received');
			}

			const reader = response.body.getReader();
			releaseReader = async (): Promise<void> => {
				try {
					await reader.cancel();
				} catch {
					// already closed/cancelled
				}
			};
			const decoder = new TextDecoder();
			let buffer = '';
			let latestUsage: GLMUsage | undefined;

			// Accumulate tool call deltas by index, then emit on finish_reason=stop/tool_calls
			const pendingToolCalls = new Map<number, GLMToolCall>();

			// Process a single SSE line. Returns true once the terminal `data: [DONE]`
			// sentinel has been fully handled so the caller can stop reading.
			const processLine = (line: string): boolean => {
				const trimmed = line.trim();

				if (!trimmed || trimmed.startsWith(':')) {
					return false;
				}

				if (trimmed === 'data: [DONE]') {
					// Flush any remaining tool calls
					for (const tc of pendingToolCalls.values()) {
						callbacks.onToolCall(tc);
					}
					pendingToolCalls.clear();
					reportFinalUsage(callbacks, latestUsage);
					callbacks.onDone();
					return true;
				}

				if (!trimmed.startsWith('data: ')) {
					return false;
				}

				const jsonStr = trimmed.slice(6);
				try {
					const chunk: GLMStreamChunk = JSON.parse(jsonStr);
					const choice = chunk.choices?.[0];

					if (chunk.usage) {
						latestUsage = chunk.usage;
					}

					if (!choice) {
						return false;
					}

					const reasoning = choice.delta.reasoning_content;
					if (reasoning) {
						callbacks.onThinking(reasoning);
					}

					if (choice.delta.content) {
						callbacks.onContent(choice.delta.content);
					}

					if (choice.delta.tool_calls) {
						for (const tc of choice.delta.tool_calls) {
							// Create the pending entry as soon as we see the index. Some
							// OpenAI-compatible gateways emit the first delta without an `id`
							// (e.g. sending `function.name` first); requiring `id` up front
							// would silently drop the entire tool call for those servers.
							let pending = pendingToolCalls.get(tc.index);
							if (!pending) {
								pending = {
									id: tc.id ?? '',
									type: 'function',
									function: { name: '', arguments: '' },
								};
								pendingToolCalls.set(tc.index, pending);
							}
							if (tc.id && !pending.id) {
								pending.id = tc.id;
							}
							if (tc.function?.name) {
								pending.function.name += tc.function.name;
							}
							if (tc.function?.arguments) {
								pending.function.arguments += tc.function.arguments;
							}
						}
					}

					if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
						for (const tc of pendingToolCalls.values()) {
							callbacks.onToolCall(tc);
						}
						pendingToolCalls.clear();
					}
				} catch (e) {
					logger.error('Failed to parse SSE chunk:', jsonStr.slice(0, 200), e);
				}
				return false;
			};

			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					controller.abort();
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (processLine(line)) {
						return;
					}
				}
			}

			// Flush the TextDecoder (it may hold a partial multi-byte sequence) and
			// process any trailing line that lacked a terminating newline. Without this
			// a final `data:` frame (e.g. usage or the last tool-call delta) can be
			// dropped when the server omits the trailing `\n`, which is common behind
			// proxies/CDNs.
			buffer += decoder.decode();
			if (buffer.length > 0) {
				for (const line of buffer.split('\n')) {
					if (processLine(line)) {
						return;
					}
				}
				buffer = '';
			}

			// The stream ended without a `[DONE]` sentinel (e.g. upstream closed
			// early, `finish_reason: "length"`, or a non-spec gateway). Emit any tool
			// calls still accumulated so agent flows don't silently stall.
			for (const tc of pendingToolCalls.values()) {
				callbacks.onToolCall(tc);
			}
			pendingToolCalls.clear();
			reportFinalUsage(callbacks, latestUsage);
			callbacks.onDone();
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalizedError = normalizeRequestError(error, {
				baseUrl: this.baseUrl,
				request,
			});
			logger.error('GLM request failed:', formatRequestError(normalizedError));
			callbacks.onError(normalizedError);
		} finally {
			// Release the response stream lock on every exit path (`[DONE]`
			// early-return, cancellation, normal completion and errors). On the
			// normal/done paths cancel() is a harmless no-op; on early returns it
			// promptly tears down the connection instead of waiting for GC.
			await releaseReader?.();
			cancelListener?.dispose();
			// Abort the controller on every exit path so the signal is torn down
			// and doesn't hold references to listeners/connections.
			controller.abort();
		}
	}

	/**
	 * Stream using Anthropic-compatible `/v1/messages` endpoint.
	 */
	private async streamAnthropicCompletion(
		request: GLMRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});
		if (cancellationToken?.isCancellationRequested) {
			cancelListener?.dispose();
			controller.abort();
			return;
		}

		try {
			const anthropicRequest = convertToAnthropicRequest(request);

			const response = await fetch(`${this.baseUrl}/v1/messages`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.apiKey,
					'anthropic-version': '2023-06-01',
				},
				body: safeStringify(anthropicRequest),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw await createHttpError(response, {
					baseUrl: this.baseUrl,
					request,
				});
			}

			if (!response.body) {
				throw new Error('No response body received');
			}

			// Take ownership of the reader lifecycle so the stream lock is released if
			// parsing throws (e.g. a callback rejects) or the request is aborted;
			// otherwise the underlying connection lingers until GC.
			const reader = response.body.getReader();
			try {
				await parseAnthropicStream(reader, callbacks);
			} finally {
				await reader.cancel().catch((err) => {
					// Log non-AbortError failures — a corrupt reader state may
					// otherwise be silently discarded, masking stream teardown issues.
					if (!isAbortError(err)) {
						logger.warn('Error cancelling Anthropic stream reader:', err);
					}
				});
			}
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalizedError = normalizeRequestError(error, {
				baseUrl: this.baseUrl,
				request,
			});
			logger.error('GLM Anthropic request failed:', formatRequestError(normalizedError));
			callbacks.onError(normalizedError);
		} finally {
			cancelListener?.dispose();
			controller.abort();
		}
	}
}

function reportFinalUsage(callbacks: StreamCallbacks, usage: GLMUsage | undefined): void {
	if (!usage || !callbacks.onUsage) {
		return;
	}
	callbacks.onUsage(usage);
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}
