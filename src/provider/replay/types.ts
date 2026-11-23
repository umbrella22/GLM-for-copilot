export interface ReplayMarkerParseResult {
	valid: boolean;
	segmentId?: string;
	visionText?: string;
	visionTextIgnoredReason?: VisionMarkerTextIgnoredReason;
	reasoningText?: string;
	reasoningTextIgnoredReason?: ReasoningMarkerTextIgnoredReason;
	toolVision?: ToolVisionReplayEntry[];
	markerSource?: ReplayMarkerSource;
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

export type ReplayMarkerSource = 'current' | 'legacy-uuid' | 'legacy-json';

export type VisionMarkerTextIgnoredReason =
	| 'vision-not-object'
	| 'vision-text-not-string'
	| 'vision-text-empty';

export type ReasoningMarkerTextIgnoredReason =
	| 'reasoning-not-object'
	| 'reasoning-text-not-string'
	| 'reasoning-text-empty';

/**
 * Replay data for one tool result whose images were replaced by Vision Proxy
 * descriptions. Stored on the assistant response that followed the tool result,
 * so later turns can reuse the same text without re-describing the images.
 */
export interface ToolVisionReplayEntry {
	callId: string;
	resolvedContent: string;
	imageParts: number;
}

export interface ReplayMarkerMetadata {
	visionText?: string;
	reasoningText?: string;
	toolVision?: readonly ToolVisionReplayEntry[];
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
