import { randomUUID } from 'crypto';
import vscode from 'vscode';
import { findFirstReplayMarker } from './replay';

export type SegmentResolveReason = 'markerFound' | 'markerMissing' | 'markerInvalid';

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
		if (marker.valid && marker.segmentId) {
			return {
				segmentId: marker.segmentId,
				reason: 'markerFound',
				markerMessageIndex: messageIndex,
				markerPartIndex: partIndex,
			};
		}

		// A marker that is structurally invalid, or valid but missing its
		// segment id, cannot be reused. Treating the latter as invalid avoids a
		// silent fall-through that would otherwise rebind to an earlier marker or
		// mint a brand-new segment, breaking conversation-segment continuity.
		if (!marker.valid || !marker.segmentId) {
			return {
				segmentId: randomUUID(),
				reason: 'markerInvalid',
				markerMessageIndex: messageIndex,
				markerPartIndex: partIndex,
				markerError: marker.error ?? 'missing-segment-id',
			};
		}
	}

	return {
		segmentId: randomUUID(),
		reason: 'markerMissing',
	};
}
