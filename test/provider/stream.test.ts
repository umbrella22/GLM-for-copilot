import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GLMClient } from '../../src/client';
import type { CacheDiagnosticsRun } from '../../src/provider/debug';
import { REPLAY_MARKER_MIME } from '../../src/provider/replay';
import type { PreparedChatRequest } from '../../src/provider/request';
import type { RequestKind } from '../../src/provider/routing';
import { streamChatCompletion } from '../../src/provider/stream';
import type { GLMRequest, GLMToolCall, StreamCallbacks } from '../../src/types';

const SEGMENT_ID = '3917af00-099c-49a2-8373-38df581b018e';

class FakeClient extends GLMClient {
	constructor(private readonly driver: (callbacks: StreamCallbacks) => void) {
		super('https://example.test', 'fake-key', 'openai');
	}

	override async streamChatCompletion(
		_request: GLMRequest,
		callbacks: StreamCallbacks,
	): Promise<void> {
		this.driver(callbacks);
	}
}

function fakeDiagnostics(): CacheDiagnosticsRun & {
	reports: unknown[];
	done: unknown[];
} {
	const reports: unknown[] = [];
	const done: unknown[] = [];
	return {
		reports,
		done,
		onDone(info) {
			done.push(info);
		},
		onCancellationTokenRequested() {},
		onReplayMarkerReport(info) {
			reports.push(info);
		},
		onUsage() {},
	};
}

interface BuildPreparedOptions {
	driver: (callbacks: StreamCallbacks) => void;
	replayMarkerMetadata?: { visionText?: string; reasoningText?: string };
}

function buildPrepared({
	driver,
	replayMarkerMetadata = {},
}: BuildPreparedOptions): PreparedChatRequest {
	const diagnostics = fakeDiagnostics();
	const prepared: PreparedChatRequest = {
		client: new FakeClient(driver),
		request: {
			model: 'glm-test',
			messages: [],
			stream: true,
		},
		isThinkingModel: true,
		totalRequestChars: 0,
		trailingToolResultIds: [],
		cacheDiagnostics: diagnostics as unknown as CacheDiagnosticsRun,
		requestKind: 'main-agent' as RequestKind,
		segment: {
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
		},
		replayMarkerMetadata,
	};
	// Keep a strongly-typed handle on the diagnostics recorder for assertions.
	(prepared as unknown as { __diagnostics: typeof diagnostics }).__diagnostics = diagnostics;
	return prepared;
}

function getDiagnostics(prepared: PreparedChatRequest) {
	return (prepared as unknown as { __diagnostics: ReturnType<typeof fakeDiagnostics> })
		.__diagnostics;
}

function tokenFor(cancelled: boolean): vscode.CancellationToken {
	return {
		isCancellationRequested: cancelled,
		onCancellationRequested: () => ({ dispose() {} }),
	} as vscode.CancellationToken;
}

function collectParts(parts: vscode.LanguageModelResponsePart[]): {
	texts: string[];
	markers: vscode.LanguageModelDataPart[];
	toolCalls: vscode.LanguageModelToolCallPart[];
} {
	const texts: string[] = [];
	const markers: vscode.LanguageModelDataPart[] = [];
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
		}
	}
	return { texts, markers, toolCalls };
}

describe('streamChatCompletion marker reporting', () => {
	it('reports a segment-only marker when a successful response has no reasoning/vision', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('hello');
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (p) => parts.push(p) },
			token: tokenFor(false),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		const { texts, markers } = collectParts(parts);
		expect(texts).toContain('hello');
		expect(markers).toHaveLength(1);

		const diagnostics = getDiagnostics(prepared);
		expect(diagnostics.reports).toEqual([
			expect.objectContaining({ status: 'reported', segmentOnly: true }),
		]);
	});

	it('reports a marker with reasoning and segment id for thinking responses', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onThinking('step one');
				cb.onContent('answer');
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (p) => parts.push(p) },
			token: tokenFor(false),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		const { markers } = collectParts(parts);
		expect(markers).toHaveLength(1);

		// Decode the marker and assert the segment id is the prepared one.
		const decoded = JSON.parse(
			Buffer.from(
				new TextDecoder().decode(markers[0]!.data).split('\\')[1]!.slice('json:'.length),
				'base64url',
			).toString('utf8'),
		);
		expect(decoded.segmentId).toBe(SEGMENT_ID);
		expect(decoded.reasoning.text).toBe('step one');

		const diagnostics = getDiagnostics(prepared);
		expect(diagnostics.reports).toEqual([
			expect.objectContaining({ status: 'reported', segmentOnly: false }),
		]);
	});

	it('reports a marker that carries vision replay metadata from the prepared request', async () => {
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
			progress: { report: (p) => parts.push(p) },
			token: tokenFor(false),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		const decoded = JSON.parse(
			Buffer.from(
				new TextDecoder()
					.decode(collectParts(parts).markers[0]!.data)
					.split('\\')[1]!
					.slice('json:'.length),
				'base64url',
			).toString('utf8'),
		);
		expect(decoded.segmentId).toBe(SEGMENT_ID);
		expect(decoded.vision.text).toBe('[image: diagram]');
	});

	it('keeps segment continuity across a tool-call round trip (same segment id)', async () => {
		const toolCall: GLMToolCall = {
			id: 'call-1',
			type: 'function',
			function: { name: 'read_file', arguments: '{"path":"a.h"}' },
		};
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onToolCall(toolCall);
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await streamChatCompletion({
			prepared,
			progress: { report: (p) => parts.push(p) },
			token: tokenFor(false),
			getCharsPerToken: () => 4,
			setCharsPerToken: () => {},
		});

		const { toolCalls, markers } = collectParts(parts);
		expect(toolCalls).toHaveLength(1);
		expect(markers).toHaveLength(1);

		const decoded = JSON.parse(
			Buffer.from(
				new TextDecoder().decode(markers[0]!.data).split('\\')[1]!.slice('json:'.length),
				'base64url',
			).toString('utf8'),
		);
		expect(decoded.segmentId).toBe(SEGMENT_ID);
	});

	it('does not report a marker when the stream errors out (skipped/stream-error)', async () => {
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
				progress: { report: (p) => parts.push(p) },
				token: tokenFor(false),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow();

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'stream-error' }),
		]);
	});

	it('does not report a marker when the token is cancelled (skipped/cancelled)', async () => {
		// Cancellation aborts the underlying fetch before the stream completes,
		// so onDone is never reached and the promise rejects.
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onContent('partial');
				cb.onError(new Error('The user aborted a request'));
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (p) => parts.push(p) },
				token: tokenFor(true),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow();

		expect(collectParts(parts).markers).toHaveLength(0);
		expect(getDiagnostics(prepared).reports).toEqual([
			expect.objectContaining({ status: 'skipped', reason: 'cancelled' }),
		]);
	});

	it('throws when the model returns an empty response and reports no marker', async () => {
		const prepared = buildPrepared({
			driver: (cb) => {
				cb.onDone();
			},
		});
		const parts: vscode.LanguageModelResponsePart[] = [];

		await expect(
			streamChatCompletion({
				prepared,
				progress: { report: (p) => parts.push(p) },
				token: tokenFor(false),
				getCharsPerToken: () => 4,
				setCharsPerToken: () => {},
			}),
		).rejects.toThrow(/empty response/);

		expect(collectParts(parts).markers).toHaveLength(0);
	});
});

// Silence expected warn logs from the error path.
vi.spyOn(console, 'warn').mockImplementation(() => {});
