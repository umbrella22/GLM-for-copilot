import type { ConversationSegment } from '../segment';

export function formatConversationSegmentTrace(segment: ConversationSegment): string {
	const prefix = `dumpSegment=${segment.segmentId}`;

	switch (segment.reason) {
		case 'markerFound':
			return `${prefix} segmentMarker=found markerSource=${segment.markerSource ?? 'unknown'}`;
		case 'markerUnbound':
			return (
				`${prefix} segmentMarker=unbound markerSource=${segment.markerSource ?? 'unknown'}` +
				formatMarkerLocation(segment)
			);
		case 'markerInvalid':
			return (
				`${prefix} segmentMarker=invalid` +
				formatMarkerLocation(segment) +
				(segment.markerError ? ` error=${segment.markerError}` : '')
			);
		case 'markerMissing':
			return `${prefix} segmentMarker=missing`;
	}
}

function formatMarkerLocation(segment: ConversationSegment): string {
	return segment.markerMessageIndex === undefined || segment.markerPartIndex === undefined
		? ''
		: ` at=message#${segment.markerMessageIndex}:part#${segment.markerPartIndex}`;
}
