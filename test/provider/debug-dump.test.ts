import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { dumpGLMRequest } from '../../src/provider/debug';
import type { ResponseOutcomeInfo } from '../../src/provider/debug';
import type { ConversationSegment } from '../../src/provider/segment';
import { __clearConfigurationValues, __setConfigurationValue } from '../support/vscode.mock';

const SEGMENT: ConversationSegment = {
	segmentId: '3917af00-099c-49a2-8373-38df581b018e',
	reason: 'markerMissing',
};

let storageRoot: string | undefined;

beforeEach(async () => {
	__clearConfigurationValues();
	__setConfigurationValue('glm-copilot.debugMode', 'verbose');
	storageRoot = await mkdtemp(join(tmpdir(), 'glm-copilot-dump-test-'));
});

afterEach(async () => {
	__clearConfigurationValues();
	if (storageRoot) {
		await rm(storageRoot, { recursive: true, force: true });
	}
});

describe('response outcome dumps', () => {
	it('pairs a sanitized response outcome with the originating request basename', async () => {
		const run = dumpGLMRequest(
			{
				model: 'glm-5.2',
				messages: [{ role: 'user', content: 'hello' }],
				stream: true,
			},
			{
				globalStorageUri: vscode.Uri.file(storageRoot!),
				segment: SEGMENT,
				vscodeModelId: 'glm-5.2',
				isThinkingModel: true,
				thinkingEffort: 'max',
				maxTokens: undefined,
				inputMessages: [],
				resolvedMessages: [],
				requestOptions: {},
			},
		);

		expect(run).toBeDefined();
		run!.finish(createOutcome());
		run!.finish(createOutcome());

		const segmentRoot = join(storageRoot!, 'request-dumps', SEGMENT.segmentId);
		const outcomeName = await waitForOutcomeFile(segmentRoot);
		const outcome = JSON.parse(await readFile(join(segmentRoot, outcomeName), 'utf8'));
		expect(outcome).toMatchObject({
			schemaVersion: 1,
			stage: 'response-outcome',
			basename: outcomeName.replace(/\.outcome\.json$/, ''),
			outcome: {
				status: 'stream-error',
				error: { name: 'Error', message: 'request failed with sensitive body' },
			},
		});
		expect(outcome.outcome.error).not.toHaveProperty('stack');

		const observationsPath = join(storageRoot!, 'request-dumps', '_request-observations.jsonl');
		await waitForFile(observationsPath);
		const observations = (await readFile(observationsPath, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		const request = observations.find((entry) => entry.event === 'glm-request');
		const response = observations.find((entry) => entry.event === 'response-outcome');
		expect(observations.filter((entry) => entry.event === 'response-outcome')).toHaveLength(1);
		expect(response.basename).toBe(request.basename);
		expect(response.paths.outcome).toContain(`${response.basename}.outcome.json`);
	});

	it('does not create a response recorder outside verbose mode', () => {
		__setConfigurationValue('glm-copilot.debugMode', 'metadata');

		expect(
			dumpGLMRequest(
				{ model: 'glm-5.2', messages: [], stream: true },
				{
					globalStorageUri: vscode.Uri.file(storageRoot!),
					segment: SEGMENT,
					vscodeModelId: 'glm-5.2',
					isThinkingModel: true,
					thinkingEffort: 'max',
					maxTokens: undefined,
					inputMessages: [],
					resolvedMessages: [],
					requestOptions: {},
				},
			),
		).toBeUndefined();
	});
});

function createOutcome(): ResponseOutcomeInfo {
	return {
		startedAt: '2026-07-14T00:00:00.000Z',
		completedAt: '2026-07-14T00:00:01.000Z',
		durationMs: 1_000,
		status: 'stream-error',
		clientSettlement: 'rejected',
		doneObserved: false,
		cancellation: { requestedAtSettlement: false, requestedAtOutcome: false },
		output: { textChars: 0, reasoningChars: 0, toolCalls: 0, reportedPartCount: 0 },
		contextUsage: {
			status: 'skipped',
			reason: 'stream-error',
			providerUsageObserved: false,
			providerCallbackCount: 0,
		},
		replayMarker: { status: 'skipped', reason: 'stream-error' },
		error: Object.assign(new Error('request failed with sensitive body'), {
			stack: 'secret stack',
		}),
	};
}

async function waitForOutcomeFile(directory: string): Promise<string> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			const files = await readdir(directory);
			const outcome = files.find((file) => file.endsWith('.outcome.json'));
			if (outcome) {
				return outcome;
			}
		} catch {
			// The async dump queue has not created the segment directory yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('Timed out waiting for response outcome dump');
}

async function waitForFile(filePath: string): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			await readFile(filePath);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	throw new Error(`Timed out waiting for ${filePath}`);
}
