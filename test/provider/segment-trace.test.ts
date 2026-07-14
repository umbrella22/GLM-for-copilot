import { describe, expect, it } from 'vitest';
import { formatConversationSegmentTrace } from '../../src/provider/debug/segment-trace';

const SEGMENT_ID = '3917af00-099c-49a2-8373-38df581b018e';

describe('formatConversationSegmentTrace', () => {
	it('formats a missing marker without claiming a source', () => {
		expect(
			formatConversationSegmentTrace({
				segmentId: SEGMENT_ID,
				reason: 'markerMissing',
				markerMessageIndex: 9,
				markerPartIndex: 9,
				markerSource: 'current',
				markerError: 'ignored',
			}),
		).toBe(`dumpSegment=${SEGMENT_ID} segmentMarker=missing`);
	});

	it('uses an explicit unknown source for a found marker without source metadata', () => {
		expect(
			formatConversationSegmentTrace({
				segmentId: SEGMENT_ID,
				reason: 'markerFound',
			}),
		).toBe(`dumpSegment=${SEGMENT_ID} segmentMarker=found markerSource=unknown`);
	});

	it('formats a current marker without adding its location', () => {
		expect(
			formatConversationSegmentTrace({
				segmentId: SEGMENT_ID,
				reason: 'markerFound',
				markerMessageIndex: 2,
				markerPartIndex: 1,
				markerSource: 'current',
			}),
		).toBe(`dumpSegment=${SEGMENT_ID} segmentMarker=found markerSource=current`);
	});

	it('uses an explicit unknown source for an unbound marker without source metadata', () => {
		expect(
			formatConversationSegmentTrace({
				segmentId: SEGMENT_ID,
				reason: 'markerUnbound',
			}),
		).toBe(`dumpSegment=${SEGMENT_ID} segmentMarker=unbound markerSource=unknown`);
	});

	it('formats a reusable legacy UUID marker without the old legacy key', () => {
		const trace = formatConversationSegmentTrace({
			segmentId: SEGMENT_ID,
			reason: 'markerFound',
			markerMessageIndex: 0,
			markerPartIndex: 0,
			markerSource: 'legacy-uuid',
		});

		expect(trace).toBe(`dumpSegment=${SEGMENT_ID} segmentMarker=found markerSource=legacy-uuid`);
		expect(trace).not.toContain('legacySegmentMarker');
	});

	it('formats an unbound legacy JSON marker', () => {
		expect(
			formatConversationSegmentTrace({
				segmentId: SEGMENT_ID,
				reason: 'markerUnbound',
				markerMessageIndex: 3,
				markerPartIndex: 2,
				markerSource: 'legacy-json',
			}),
		).toBe(
			`dumpSegment=${SEGMENT_ID} segmentMarker=unbound markerSource=legacy-json at=message#3:part#2`,
		);
	});

	it('formats an invalid marker without inventing a source', () => {
		expect(
			formatConversationSegmentTrace({
				segmentId: SEGMENT_ID,
				reason: 'markerInvalid',
				markerMessageIndex: 4,
				markerPartIndex: 0,
				markerError: 'segment-id-not-uuid',
				markerSource: 'current',
			}),
		).toBe(
			`dumpSegment=${SEGMENT_ID} segmentMarker=invalid at=message#4:part#0 error=segment-id-not-uuid`,
		);
	});
});
