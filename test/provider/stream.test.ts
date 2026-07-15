import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GLMClient } from '../../src/client';
import { convertMessages } from '../../src/provider/convert';
import type { CacheDiagnosticsRun } from '../../src/provider/debug';
import { REPLAY_MARKER_MIME, parseReplayMarkerData } from '../../src/provider/replay';
import type { PreparedChatRequest } from '../../src/provider/request';
import type { RequestKind } from '../../src/provider/routing';
import { resolveConversationSegment, type ConversationSegment } from '../../src/provider/segment';
import { streamChatCompletion } from '../../src/provider/stream';
import type { GLMMessage, GLMRequest, GLMToolCall, StreamCallbacks } from '../../src/types';

const SEGMENT_ID = '3917af00-099c-49a2-8373-38df581b018e';

class FakeClient extends GLMClient {
	constructor(private readonly driver: (callbacks: StreamCallbacks) => void | Promise<void>) {
		super('https://example.test', 'fake-key', 'openai');
	}

	override async streamChatCompletion(
		_request: GLMRequest,
		callbacks: StreamCallbacks,
	): Promise<void> {
		await this.driver(callbacks);
	}
}

class MutableCancellationToken implements vscode.CancellationToken {
	private readonly emitter = new vscode.EventEmitter<void>();

	isCancellationRequested = false;
	readonly onCancellationRequested = this.emitter.event;

	cancel(): void {
		if (this.isCancellationRequested) {
			return;
		}
		this.isCancellationRequested = true;
		this.emitter.fire(undefined);
	}
}

function fakeDiagnostics(): CacheDiagnosticsRun & {
	reports: unknown[];
	contextUsage: unknown[];
	outcomes: unknown[];
	done: unknown[];
	cancellations: unknown[];
} {
	const reports: unknown[] = [];
	const contextUsage: unknown[] = [];
	const outcomes: unknown[] = [];
	const done: unknown[] = [];
	const cancellations: unknown[] = [];
	return {
		reports,
		contextUsage,
		outcomes,
		done,
		cancellations,
		onDone(info) {
			done.push(info);
		},
		onCancellationTokenRequested() {
			cancellations.push(true);
		},
		onReplayMarkerReport(info) {
			reports.push(info);
		},
		onUsage() {},
		onContextUsageReport(info) {
			contextUsage.push(info);
		},
		onResponseOutcome(info) {
			outcomes.push(info);
		},
	};
}

interface BuildPreparedOptions {
	driver: (callbacks: StreamCallbacks) => void | Promise<void>;
	replayMarkerMetadata?: { visionText?: string; reasoningText?: string };
	requestMessages?: GLMMessage[];
	segment?: ConversationSegment;
	nativeImageParts?: number;
	nativeImageBytes?: number;
}

function chatMessage(
	role: vscode.LanguageModelChatMessageRole,
	content: readonly unknown[],
): vscode.LanguageModelChatRequestMessage {
	return { role, content } as vscode.LanguageModelChatRequestMessage;
}

function defaultSegment(): ConversationSegment {
	return {
		segmentId: SEGMENT_ID,
		reason: 'markerMissing',
	};
}

function buildPrepared({
	driver,
	replayMarkerMetadata = {},
	requestMessages = [],
	segment = defaultSegment(),
	nativeImageParts = 0,
	nativeImageBytes = 0,
}: BuildPreparedOptions): PreparedChatRequest {
	const diagnostics = fakeDiagnostics();
	const prepared: PreparedChatRequest = {
		client: new FakeClient(driver),
		request: {
			model: 'glm-test',
			messages: requestMessages,
			stream: true,
		},
		isThinkingModel: true,
		promptChars: 0,
		trailingToolResultIds: [],
		cacheDiagnostics: diagnostics as unknown as CacheDiagnosticsRun,
		requestKind: 'main-agent' as RequestKind,
		segment,
		replayMarkerMetadata,
		visionMode: nativeImageParts > 0 ? 'native' : 'proxy',
		nativeImageParts,
		nativeImageBytes,
	};
	(prepared as unknown as { __diagnostics: typeof diagnostics }).__diagnostics = diagnostics;
	return prepared;
}

function getDiagnostics(prepared: PreparedChatRequest): ReturnType<typeof fakeDiagnostics> {
	return (prepared as unknown as { __diagnostics: ReturnType<typeof fakeDiagnostics> })
		.__diagnostics;
}

function collectParts(parts: vscode.LanguageModelResponsePart[]): {
	texts: string[];
	markers: vscode.LanguageModelDataPart[];
	usages: vscode.LanguageModelDataPart[];
	toolCalls: vscode.LanguageModelToolCallPart[];
} {
	const texts: string[] = [];
	const markers: vscode.LanguageModelDataPart[] = [];
	const usages: vscode.LanguageModelDataPart[] = [];
	const toolCalls: vscode.LanguageModelToolCallPart[] = [];
	for (const part of parts) {
		if (part instanceof vscode.LanguageModelTextPart) {
			texts.push(part.value);
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			toolCalls.push(part);
		} else if (
			part instanceof vscode.LanguageModelDataPart &&
			part.mimeType === REPLAY_MARKER_MIME
		) {
			markers.push(part);
		} else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'usage') {
			usages.push(part);
		}
	}
	return { texts, markers, usages, toolCalls };
}

function markerFrom(
	parts: readonly vscode.LanguageModelResponsePart[],
): vscode.LanguageModelDataPart {
	const marker = collectParts([...parts]).markers[0];
	expect(marker).toBeDefined();
	return marker!;
}

function usageFrom(parts: readonly vscode.LanguageModelResponsePart[]): Record<string, unknown> {
	const usage = collectParts([...parts]).usages[0];
	expect(usage).toBeDefined();
	return JSON.parse(new TextDecoder().decode(usage!.data));
}

describe('streamChatCompletion marker reporting', () => {
	it('reports estimated usage and a segment-only marker after a successful response', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('hello');
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		const { texts, markers, usages } = collectParts(parts);
		expect(texts).toEqual(['hello']);
		expect(usages).toHaveLength(1);
		expect(markers).toHaveLength(1);
		expect(parts).toHaveLength(3);
		expect(parts[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
		expect(parts[1]).toBe(usages[0]);
		expect(parts[2]).toBe(markers[0]);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'reported', segmentOnly: true }),
		]);
		expect(getDiagnostics(prepared).done).toHaveLength(1);
		expect(getDiagnostics(prepared).contextUsage).toEqual([
			expect.objectContaining({
				status: 'reported',
				source: 'estimate',
				promptTokenSource: 'estimate',
				completionTokenSource: 'estimate',
			}),
		]);
		expect(getDiagnostics(prepared).outcomes).toEqual([
			expect.objectContaining({
				status: 'completed',
				clientSettlement: 'fulfilled',
				doneObserved: true,
				output: expect.objectContaining({ lastReportedPart: 'marker' }),
			}),
		]);
	});

	it('reports usage before the final marker and preserves reasoning', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onThinking('step one');
				cb.onContent('answer');
				cb.onUsage?.({
					prompt_tokens: 10,
					completion_tokens: 2,
					total_tokens: 12,
				});
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		const marker = markerFrom(parts);
		expect(parts.at(-1)).toBe(marker);
		expect(parts.at(-2)).toMatchObject({ mimeType: 'usage' });
		expect(parseReplayMarkerData(marker.data)).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			reasoningText: 'step one',
		});
	});

	it('reports only the final provider usage snapshot', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('answer');
				cb.onUsage?.({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
				cb.onUsage?.({ prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 });
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(collectParts(parts).usages).toHaveLength(1);
		expect(usageFrom(parts)).toMatchObject({
			prompt_tokens: 20,
			completion_tokens: 3,
			total_tokens: 23,
		});
		expect(getDiagnostics(prepared).contextUsage).toEqual([
			expect.objectContaining({ source: 'provider', providerCallbackCount: 2 }),
		]);
	});

	it('marks native image token usage unknown when the provider omits usage', async () => {
		const prepared = buildPrepared({
			nativeImageParts: 1,
			nativeImageBytes: 3,
			driver: (cb) => {
				cb.onContent('answer');
				cb.onDone();
			},
		});

		await streamChatCompletion({
			prepared,
			progress: { report() {} },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(getDiagnostics(prepared).contextUsage).toEqual([
			expect.objectContaining({
				source: 'estimate',
				nativeImageParts: 1,
				nativeImageBytes: 3,
				imageTokenSource: 'unknown',
			}),
		]);
	});

	it('treats provider usage as authoritative for native image token accounting', async () => {
		const prepared = buildPrepared({
			nativeImageParts: 1,
			nativeImageBytes: 3,
			driver: (cb) => {
				cb.onContent('answer');
				cb.onUsage?.({ prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
				cb.onDone();
			},
		});

		await streamChatCompletion({
			prepared,
			progress: { report() {} },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(getDiagnostics(prepared).contextUsage).toEqual([
			expect.objectContaining({
				source: 'provider',
				imageTokenSource: 'provider',
			}),
		]);
	});

	it('reports a marker that carries vision replay metadata', async () => {
		const prepared = buildPrepared({
			replayMarkerMetadata: { visionText: '[image: diagram]' },
			driver: (cb) => {
				cb.onContent('answer');
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(parseReplayMarkerData(markerFrom(parts).data)).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			visionText: '[image: diagram]',
		});
	});

	it('keeps segment continuity through a real two-round tool-call flow', async () => {
		const toolCall: GLMToolCall = {
			id: 'call-1',
			type: 'function',
			function: { name: 'read_file', arguments: '{"path":"a.h"}' },
		};
		const firstPrepared = buildPrepared({
			driver: (cb) => {
				cb.onThinking('plan');
				cb.onToolCall(toolCall);
				cb.onDone();
			},
		});
		const firstParts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared: firstPrepared,
			progress: { report: (part) => firstParts.push(part) },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(firstParts).toHaveLength(4);
		expect(firstParts[0]).toBeInstanceOf(vscode.LanguageModelThinkingPart);
		expect(firstParts[1]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
		expect(firstParts[2]).toMatchObject({ mimeType: 'usage' });
		expect(firstParts[3]).toBeInstanceOf(vscode.LanguageModelDataPart);
		expect(parseReplayMarkerData(markerFrom(firstParts).data)).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			reasoningText: 'plan',
			markerSource: 'current',
		});

		const history = [
			chatMessage(vscode.LanguageModelChatMessageRole.Assistant, firstParts),
			chatMessage(vscode.LanguageModelChatMessageRole.User, [
				new vscode.LanguageModelToolResultPart('call-1', [
					new vscode.LanguageModelTextPart('file body'),
				]),
			]),
		];
		const secondSegment = resolveConversationSegment(history);
		expect(secondSegment).toMatchObject({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 0,
			markerPartIndex: 3,
			markerSource: 'current',
		});

		const convertedHistory = convertMessages(history, true);
		expect(convertedHistory).toEqual([
			{
				role: 'assistant',
				content: '',
				reasoning_content: 'plan',
				tool_calls: [toolCall],
			},
			{
				role: 'tool',
				content: 'file body',
				tool_call_id: 'call-1',
			},
		]);

		const secondPrepared = buildPrepared({
			segment: secondSegment,
			requestMessages: convertedHistory,
			driver: (cb) => {
				cb.onContent('final answer');
				cb.onDone();
			},
		});
		const secondParts: vscode.LanguageModelResponsePart[] = [];
		await streamChatCompletion({
			prepared: secondPrepared,
			progress: { report: (part) => secondParts.push(part) },
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(parseReplayMarkerData(markerFrom(secondParts).data)).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			markerSource: 'current',
		});
		expect(secondPrepared.request.messages).toEqual(convertedHistory);
	});

	it('does not report a marker when the stream errors out', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('partial');
				cb.onError(new Error('boom'));
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (part) => parts.push(part) },
				token: new MutableCancellationToken(),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow('boom');

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'stream-error' }),
		]);
		expect(getDiagnostics(prepared).done).toHaveLength(0);
	});

	it('does not report a marker when the client rejects after onDone', async () => {
		const prepared = buildPrepared({
			driver: async (cb) => {
				cb.onContent('partial');
				cb.onDone();
				await Promise.resolve();
				throw new Error('late failure');
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (part) => parts.push(part) },
				token: new MutableCancellationToken(),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow('late failure');

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'stream-error' }),
		]);
	});

	it('skips the marker when cancellation resolves the client before onDone', async () => {
		const token = new MutableCancellationToken();
		const prepared = buildPrepared({
			driver: async (cb) => {
				cb.onContent('partial');
				token.cancel();
				await Promise.resolve();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token,
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'cancelled' }),
		]);
		expect(getDiagnostics(prepared).cancellations).toHaveLength(1);
		expect(getDiagnostics(prepared).done).toHaveLength(0);
		expect(getDiagnostics(prepared).contextUsage).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'cancelled' }),
		]);
		expect(getDiagnostics(prepared).outcomes).toEqual([
			expect.objectContaining({ status: 'cancelled', clientSettlement: 'fulfilled' }),
		]);
	});

	it('skips the marker when the token is already cancelled and the client resolves', async () => {
		const token = new MutableCancellationToken();
		token.cancel();
		const prepared = buildPrepared({
			driver: () => {},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token,
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(parts).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'cancelled' }),
		]);
		expect(getDiagnostics(prepared).cancellations).toHaveLength(1);
		expect(getDiagnostics(prepared).done).toHaveLength(0);
	});

	it('skips the marker when cancellation happens after onDone but before fulfillment', async () => {
		const token = new MutableCancellationToken();
		const prepared = buildPrepared({
			driver: async (cb) => {
				cb.onContent('complete output');
				cb.onDone();
				await Promise.resolve();
				token.cancel();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (part) => parts.push(part) },
			token,
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'cancelled' }),
		]);
		expect(getDiagnostics(prepared).cancellations).toHaveLength(1);
		expect(getDiagnostics(prepared).done).toHaveLength(0);
	});

	it('preserves rejection while classifying a cancelled stream as cancelled', async () => {
		const token = new MutableCancellationToken();
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('partial');
				token.cancel();
				cb.onError(new Error('The user aborted a request'));
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (part) => parts.push(part) },
				token,
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow();

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'cancelled' }),
		]);
		expect(getDiagnostics(prepared).cancellations).toHaveLength(1);
	});

	it('rejects a resolved stream that never signals onDone', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('partial');
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (part) => parts.push(part) },
				token: new MutableCancellationToken(),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow('Model stream resolved without a completion signal.');

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'stream-error' }),
		]);
	});

	it('throws when the model returns an empty completed response', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (part) => parts.push(part) },
				token: new MutableCancellationToken(),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow(/empty response/);

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'stream-error' }),
		]);
	});

	it('keeps marker reporting best-effort when progress rejects the marker', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('answer');
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: {
				report: (part) => {
					if (
						part instanceof vscode.LanguageModelDataPart &&
						part.mimeType === REPLAY_MARKER_MIME
					) {
						throw new Error('marker rejected');
					}
					parts.push(part);
				},
			},
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'failed', trigger: 'done' }),
		]);
		expect(getDiagnostics(prepared).done).toHaveLength(1);
	});

	it('keeps the marker and response completion when usage reporting fails', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('answer');
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: {
				report: (part) => {
					if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'usage') {
						throw new Error('usage rejected');
					}
					parts.push(part);
				},
			},
			token: new MutableCancellationToken(),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		expect(collectParts(parts).markers).toHaveLength(1);
		expect(getDiagnostics(prepared).contextUsage).toEqual([
			expect.objectContaining({ status: 'failed', source: 'estimate' }),
		]);
		expect(getDiagnostics(prepared).outcomes).toEqual([
			expect.objectContaining({
				status: 'completed',
				replayMarker: expect.objectContaining({ status: 'reported' }),
			}),
		]);
	});
});

vi.spyOn(console, 'warn').mockImplementation(() => {});
