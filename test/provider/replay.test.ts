import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import {
	REPLAY_MARKER_MIME,
	createReplayMarkerPart,
	parseReplayMarkerData,
} from '../../src/provider/replay';

const SEGMENT_ID = '3917af00-099c-49a2-8373-38df581b018e';

function decodeMarkerData(part: vscode.LanguageModelDataPart): Uint8Array {
	// LanguageModelDataPart stores the encoded marker bytes. Re-encode them via
	// a fresh TextEncoder so tests assert against the raw payload the writer
	// produced.
	const raw = part.data;
	return raw;
}

describe('replay marker encode/decode contract', () => {
	it('always writes segmentId even with no replay content (segment-only marker)', () => {
		const part = createReplayMarkerPart({ segmentId: SEGMENT_ID });
		expect(part.mimeType).toBe(REPLAY_MARKER_MIME);

		const parsed = parseReplayMarkerData(decodeMarkerData(part));
		expect(parsed.valid).toBe(true);
		expect(parsed.segmentId).toBe(SEGMENT_ID);
		expect(parsed.markerSource).toBe('current');
		expect(parsed.reasoningText).toBeUndefined();
		expect(parsed.visionText).toBeUndefined();
		expect(parsed.segmentOnly).toBe(true);
		expect(parsed.error).toBeUndefined();
	});

	it('writes segmentId alongside reasoning replay content', () => {
		const part = createReplayMarkerPart({
			segmentId: SEGMENT_ID,
			reasoningText: 'step-by-step reasoning',
		});

		const parsed = parseReplayMarkerData(decodeMarkerData(part));
		expect(parsed.valid).toBe(true);
		expect(parsed.segmentId).toBe(SEGMENT_ID);
		expect(parsed.markerSource).toBe('current');
		expect(parsed.reasoningText).toBe('step-by-step reasoning');
		expect(parsed.visionText).toBeUndefined();
		expect(parsed.segmentOnly).toBe(false);
	});

	it('writes segmentId alongside vision replay content', () => {
		const part = createReplayMarkerPart({
			segmentId: SEGMENT_ID,
			visionText: '[image: a diagram]',
		});

		const parsed = parseReplayMarkerData(decodeMarkerData(part));
		expect(parsed.valid).toBe(true);
		expect(parsed.segmentId).toBe(SEGMENT_ID);
		expect(parsed.markerSource).toBe('current');
		expect(parsed.visionText).toBe('[image: a diagram]');
		expect(parsed.reasoningText).toBeUndefined();
	});

	it('round-trips segmentId, reasoning, and vision together', () => {
		const part = createReplayMarkerPart({
			segmentId: SEGMENT_ID,
			reasoningText: 'combined reasoning',
			visionText: 'combined vision',
		});

		const parsed = parseReplayMarkerData(decodeMarkerData(part));
		expect(parsed).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			markerSource: 'current',
			reasoningText: 'combined reasoning',
			visionText: 'combined vision',
			segmentOnly: false,
		});
	});

	it('keeps segment id case-insensitive (lowercased on read)', () => {
		const part = createReplayMarkerPart({
			segmentId: SEGMENT_ID.toUpperCase(),
		});

		const parsed = parseReplayMarkerData(decodeMarkerData(part));
		expect(parsed.valid).toBe(true);
		expect(parsed.segmentId).toBe(SEGMENT_ID);
	});

	it('reads legacy raw-uuid markers as found segment ids', () => {
		// Simulate a legacy writer that emitted only a bare UUID payload.
		const legacy = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`glm-copilot\\${SEGMENT_ID}`),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(legacy));
		expect(parsed).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			markerSource: 'legacy-uuid',
			segmentOnly: true,
		});
	});

	it('treats legacy markers with replay content but no segmentId as unbound', () => {
		// Legacy marker shape: JSON object with reasoning but no segmentId.
		const json = JSON.stringify({ reasoning: { text: 'old reasoning' } });
		const encoded = `json:${Buffer.from(json, 'utf8').toString('base64url')}`;
		const legacy = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`glm-copilot\\${encoded}`),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(legacy));
		expect(parsed.valid).toBe(true);
		expect(parsed.segmentId).toBeUndefined();
		expect(parsed.markerSource).toBe('legacy-json');
		expect(parsed.reasoningText).toBe('old reasoning');
		expect(parsed.segmentOnly).toBe(false);
	});

	it('classifies encoded JSON with an id from a legacy model writer as legacy-json', () => {
		const json = JSON.stringify({
			segmentId: SEGMENT_ID,
			reasoning: { text: 'legacy reasoning' },
		});
		const encoded = `json:${Buffer.from(json, 'utf8').toString('base64url')}`;
		const legacy = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`glm-5.2\\${encoded}`),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(legacy));
		expect(parsed).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			markerSource: 'legacy-json',
			payloadFormat: 'json-base64url',
			reasoningText: 'legacy reasoning',
		});
	});

	it('classifies accepted raw JSON with an id as legacy-json', () => {
		const json = JSON.stringify({
			segmentId: SEGMENT_ID,
			reasoning: { text: 'raw legacy reasoning' },
		});
		const legacy = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`glm-copilot\\${json}`),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(legacy));
		expect(parsed).toMatchObject({
			valid: true,
			segmentId: SEGMENT_ID,
			markerSource: 'legacy-json',
			payloadFormat: 'raw-json',
			reasoningText: 'raw legacy reasoning',
		});
	});

	it('rejects markers with an unknown writer prefix', () => {
		const bad = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`unknown-writer\\${SEGMENT_ID}`),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(bad));
		expect(parsed.valid).toBe(false);
		expect(parsed.error).toBe('marker-prefix-mismatch');
	});

	it('rejects json markers whose segmentId is not a uuid', () => {
		const json = JSON.stringify({
			segmentId: 'not-a-uuid',
			reasoning: { text: 'x' },
		});
		const encoded = `json:${Buffer.from(json, 'utf8').toString('base64url')}`;
		const bad = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(`glm-copilot\\${encoded}`),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(bad));
		expect(parsed.valid).toBe(false);
		expect(parsed.markerSource).toBeUndefined();
		expect(parsed.error).toBe('segment-id-not-uuid');
	});

	it('rejects markers with no writer separator', () => {
		const bad = new vscode.LanguageModelDataPart(
			new TextEncoder().encode(SEGMENT_ID),
			REPLAY_MARKER_MIME,
		);

		const parsed = parseReplayMarkerData(decodeMarkerData(bad));
		expect(parsed.valid).toBe(false);
		expect(parsed.error).toBe('marker-prefix-missing');
	});
});
