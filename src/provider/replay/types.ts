export interface ReplayMarkerParseResult {
	valid: boolean;
	segmentId?: string;
	visionText?: string;
	visionTextIgnoredReason?: VisionMarkerTextIgnoredReason;
	reasoningText?: string;
	reasoningTextIgnoredReason?: ReasoningMarkerTextIgnoredReason;
	/**
	 * True when the marker carries a segment id but no reasoning/vision replay
	 * content. Applies to both the new segment-only markers written by this
	 * adapter and legacy bare-UUID markers.
	 */
	segmentOnly?: boolean;
	payloadFormat?: ReplayMarkerPayloadFormat;
	error?: string;
}

export interface LocatedReplayMarker {
	partIndex: number;
	marker: ReplayMarkerParseResult;
}

export type ReplayMarkerPayloadFormat = 'json-base64url' | 'raw-json' | 'raw-uuid';

export type VisionMarkerTextIgnoredReason =
	| 'vision-not-object'
	| 'vision-text-not-string'
	| 'vision-text-empty';

export type ReasoningMarkerTextIgnoredReason =
	| 'reasoning-not-object'
	| 'reasoning-text-not-string'
	| 'reasoning-text-empty';

export interface ReplayMarkerMetadata {
	visionText?: string;
	reasoningText?: string;
}

/**
 * Marker write payload. The request orchestration layer supplies the
 * `segmentId`; vision/reasoning text remain optional replay content.
 *
 * `segmentId` is required for every marker written by this adapter so that
 * subsequent requests in the same conversation segment can reuse it.
 */
export interface ReplayMarkerPayload extends ReplayMarkerMetadata {
	segmentId: string;
}
