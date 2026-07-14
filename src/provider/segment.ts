import { randomUUID } from 'crypto';
import vscode from 'vscode';
import { findFirstReplayMarker } from './replay';

export type SegmentResolveReason =
	| 'markerFound'
	| 'markerMissing'
	| 'markerUnbound'
	| 'markerInvalid';

export interface ConversationSegment {
	segmentId: string;
	reason: SegmentResolveReason;
	markerMessageIndex?: number;
	markerPartIndex?: number;
	markerError?: string;
}

export function resolveConversationSegment(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): ConversationSegment {
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
		const message = messages[messageIndex];
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}

		const foundMarker = findFirstReplayMarker(message);
		if (!foundMarker) {
			continue;
		}

		const { marker, partIndex } = foundMarker;

		// Structurally invalid markers (wrong prefix, malformed JSON, bad
		// segment id type, etc.) cannot be reused and must not be treated as a
		// compatible migration target.
		if (!marker.valid) {
			return {
				segmentId: randomUUID(),
				reason: 'markerInvalid',
				markerMessageIndex: messageIndex,
				markerPartIndex: partIndex,
				markerError: marker.error,
			};
		}

		// A valid marker with a reusable segment id.
		if (marker.segmentId) {
			return {
				segmentId: marker.segmentId,
				reason: 'markerFound',
				markerMessageIndex: messageIndex,
				markerPartIndex: partIndex,
			};
		}

		// Valid marker with replay content but no segment id. This is a legacy
		// marker from before segment ids were required. Its reasoning/vision
		// content can still be replayed, but it carries no reusable segment
		// identity, so we mint a new id once and rely on the next response to
		// emit a full marker (after which subsequent requests resolve to
		// `markerFound`).
		return {
			segmentId: randomUUID(),
			reason: 'markerUnbound',
			markerMessageIndex: messageIndex,
			markerPartIndex: partIndex,
		};
	}

	return {
		segmentId: randomUUID(),
		reason: 'markerMissing',
	};
}
