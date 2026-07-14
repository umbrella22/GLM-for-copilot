import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { REPLAY_MARKER_MIME, createReplayMarkerPart } from '../../src/provider/replay';
import { resolveConversationSegment, type ConversationSegment } from '../../src/provider/segment';

const SEGMENT_ID = '3917af00-099c-49a2-8373-38df581b018e';

function assistant(content: readonly unknown[]): vscode.LanguageModelChatRequestMessage {
	return {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		content,
	} as vscode.LanguageModelChatRequestMessage;
}

function user(content: readonly unknown[]): vscode.LanguageModelChatRequestMessage {
	return {
		role: vscode.LanguageModelChatMessageRole.User,
		content,
	} as vscode.LanguageModelChatRequestMessage;
}

function legacyUnboundMarker(text: string): vscode.LanguageModelDataPart {
	const json = JSON.stringify({ reasoning: { text } });
	const encoded = `json:${Buffer.from(json, 'utf8').toString('base64url')}`;
	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(`glm-copilot\\${encoded}`),
		REPLAY_MARKER_MIME,
	);
}

function legacyRawUuidMarker(): vscode.LanguageModelDataPart {
	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(`glm-copilot\\${SEGMENT_ID}`),
		REPLAY_MARKER_MIME,
	);
}

function legacyJsonMarkerWithSegmentId(): vscode.LanguageModelDataPart {
	const json = JSON.stringify({ segmentId: SEGMENT_ID });
	const encoded = `json:${Buffer.from(json, 'utf8').toString('base64url')}`;
	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(`glm-5.2\\${encoded}`),
		REPLAY_MARKER_MIME,
	);
}

function isUuid(value: string | undefined): boolean {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
	);
}

describe('resolveConversationSegment', () => {
	it('mints a new uuid and reports markerMissing when no assistant marker exists', () => {
		const segment = resolveConversationSegment([user([new vscode.LanguageModelTextPart('hello')])]);

		expect(segment.reason).toBe('markerMissing');
		expect(isUuid(segment.segmentId)).toBe(true);
		expect(segment.markerMessageIndex).toBeUndefined();
	});

	it('reuses the segmentId of a full marker (markerFound)', () => {
		const marker = createReplayMarkerPart({
			segmentId: SEGMENT_ID,
			reasoningText: 'reasoning',
		});

		const segment = resolveConversationSegment([assistant([marker])]);

		expect(segment).toMatchObject<ConversationSegment>({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 0,
			markerPartIndex: 0,
			markerSource: 'current',
		});
	});

	it('returns markerFound for a segment-only marker', () => {
		const marker = createReplayMarkerPart({ segmentId: SEGMENT_ID });

		const segment = resolveConversationSegment([assistant([marker])]);

		expect(segment).toEqual({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 0,
			markerPartIndex: 0,
			markerSource: 'current',
		});
	});

	it('reuses the latest assistant marker and ignores earlier ones', () => {
		const oldMarker = createReplayMarkerPart({
			segmentId: '11111111-1111-1111-1111-111111111111',
		});
		const latestMarker = createReplayMarkerPart({ segmentId: SEGMENT_ID });

		const segment = resolveConversationSegment([assistant([oldMarker]), assistant([latestMarker])]);

		expect(segment).toMatchObject({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 1,
		});
	});

	it('preserves segment continuity across a tool-call round trip', () => {
		const assistantMarker = createReplayMarkerPart({ segmentId: SEGMENT_ID });
		const toolCall = new vscode.LanguageModelToolCallPart('call-1', 'read_file', {
			path: 'a.h',
		});
		const toolResult = new vscode.LanguageModelToolResultPart('call-1', [
			new vscode.LanguageModelTextPart('file body'),
		]);

		const segment = resolveConversationSegment([
			assistant([toolCall, assistantMarker]),
			user([toolResult]),
		]);

		expect(segment).toMatchObject({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 0,
			markerPartIndex: 1,
			markerSource: 'current',
		});
	});

	it('treats a legacy raw-uuid marker as markerFound', () => {
		const segment = resolveConversationSegment([assistant([legacyRawUuidMarker()])]);

		expect(segment).toMatchObject({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 0,
			markerSource: 'legacy-uuid',
		});
	});

	it('propagates legacy-json for a reusable id from a legacy model writer', () => {
		const segment = resolveConversationSegment([assistant([legacyJsonMarkerWithSegmentId()])]);

		expect(segment).toMatchObject({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerSource: 'legacy-json',
		});
	});

	it('reports markerUnbound for a legacy marker with replay content but no segment id', () => {
		const marker = legacyUnboundMarker('old reasoning');

		const segment = resolveConversationSegment([assistant([marker])]);

		expect(segment.reason).toBe('markerUnbound');
		expect(segment.segmentId).not.toBe(SEGMENT_ID);
		expect(isUuid(segment.segmentId)).toBe(true);
		expect(segment.markerMessageIndex).toBe(0);
		expect(segment.markerPartIndex).toBe(0);
		expect(segment.markerSource).toBe('legacy-json');
	});

	it('reports markerInvalid for a marker with a malformed segment id', () => {
		const json = JSON.stringify({ segmentId: 'not-a-uuid' });
		const encoded = `json:${Buffer.from(json, 'utf8').toString('base64url')}`;
		const badMarker = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`glm-copilot\\${encoded}`),
			REPLAY_MARKER_MIME,
		);

		const segment = resolveConversationSegment([assistant([badMarker])]);

		expect(segment.reason).toBe('markerInvalid');
		expect(segment.markerError).toBe('segment-id-not-uuid');
		expect(segment).not.toHaveProperty('markerSource');
		expect(isUuid(segment.segmentId)).toBe(true);
	});

	it('reports markerInvalid for a marker with a wrong writer prefix', () => {
		const badMarker = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`unknown-writer\\${SEGMENT_ID}`),
			REPLAY_MARKER_MIME,
		);

		const segment = resolveConversationSegment([assistant([badMarker])]);

		expect(segment.reason).toBe('markerInvalid');
		expect(segment.markerError).toBe('marker-prefix-mismatch');
	});

	it('prefers the newest unbound marker over an older bound marker', () => {
		// Newer unbound marker should win over an older valid one, because the
		// resolver scans newest-first and returns on the first marker it finds.
		const validMarker = createReplayMarkerPart({ segmentId: SEGMENT_ID });
		const unboundMarker = legacyUnboundMarker('newer reasoning');

		const segment = resolveConversationSegment([
			assistant([validMarker]),
			assistant([unboundMarker]),
		]);

		expect(segment.reason).toBe('markerUnbound');
		expect(segment.segmentId).not.toBe(SEGMENT_ID);
	});
});
