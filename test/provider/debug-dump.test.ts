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

	it('redacts native image bytes from the request, observations, and outcome errors', async () => {
		const originalImage = new Uint8Array([1, 2, 3, 4, 5]);
		const resizedImage = new Uint8Array([9, 8, 7, 6]);
		const originalImagePayload = Buffer.from(originalImage).toString('base64');
		const resizedImagePayload = Buffer.from(resizedImage).toString('base64');
		const inputMessages = [
			{
				role: vscode.LanguageModelChatMessageRole.User,
				content: [
					new vscode.LanguageModelTextPart('inspect this image'),
					new vscode.LanguageModelDataPart(originalImage, 'image/png'),
				],
			} as vscode.LanguageModelChatRequestMessage,
		];
		const resolvedMessages = [
			{
				role: vscode.LanguageModelChatMessageRole.User,
				content: [
					new vscode.LanguageModelTextPart('inspect this image'),
					new vscode.LanguageModelDataPart(resizedImage, 'image/webp'),
				],
			} as vscode.LanguageModelChatRequestMessage,
		];
		const run = dumpGLMRequest(
			{
				model: 'glm-4.6v-flash',
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'inspect this image' },
							{
								type: 'image_url',
								image_url: { url: `data:image/webp;base64,${resizedImagePayload}` },
							},
						],
					},
				],
				stream: true,
			},
			{
				globalStorageUri: vscode.Uri.file(storageRoot!),
				segment: SEGMENT,
				vscodeModelId: 'glm-4.6v-flash',
				isThinkingModel: false,
				thinkingEffort: 'none',
				maxTokens: undefined,
				inputMessages,
				resolvedMessages,
				requestOptions: {},
				visionMode: 'native',
				visionStats: {
					inputImageParts: 1,
					inputImageMessages: 1,
					inputImageBytes: originalImage.byteLength,
					nativeImageParts: 1,
					nativeImageMessages: 1,
					nativeImageBytesAfterResize: resizedImage.byteLength,
					nativeImageBytes: resizedImage.byteLength,
					nativeBudgetOmittedParts: 0,
					nativeResizeFailures: 0,
					currentImageMessages: 0,
					generatedImageMessages: 0,
					replayedImageMessages: 0,
					omittedImageMessages: 0,
					unavailableImageMessages: 0,
					failedImageMessages: 0,
					droppedImageParts: 0,
					markerVisionTextChars: 0,
					invalidMarkerVisionMetadata: 0,
				},
			},
		);

		run!.finish({
			...createOutcome(),
			error: new Error(
				`gateway echoed data:image/png;base64,${originalImagePayload} and data:image/webp;base64,${resizedImagePayload}`,
			),
		});

		const segmentRoot = join(storageRoot!, 'request-dumps', SEGMENT.segmentId);
		const outcomeName = await waitForOutcomeFile(segmentRoot);
		const requestName = outcomeName.replace(/\.outcome\.json$/, '.json');
		const inputName = outcomeName.replace(/\.outcome\.json$/, '.input.json');
		const resolvedName = outcomeName.replace(/\.outcome\.json$/, '.resolved.json');
		const requestPath = join(segmentRoot, requestName);
		const inputPath = join(segmentRoot, inputName);
		const resolvedPath = join(segmentRoot, resolvedName);
		await Promise.all([
			waitForFile(requestPath),
			waitForFile(inputPath),
			waitForFile(resolvedPath),
		]);
		const requestContent = await readFile(requestPath, 'utf8');
		const inputContent = await readFile(inputPath, 'utf8');
		const resolvedContent = await readFile(resolvedPath, 'utf8');
		const outcomeContent = await readFile(join(segmentRoot, outcomeName), 'utf8');
		const observationsPath = join(storageRoot!, 'request-dumps', '_request-observations.jsonl');
		await waitForFile(observationsPath);
		const observations = await readFile(observationsPath, 'utf8');

		for (const content of [
			requestContent,
			inputContent,
			resolvedContent,
			outcomeContent,
			observations,
		]) {
			expect(content).not.toContain(originalImagePayload);
			expect(content).not.toContain(resizedImagePayload);
		}
		expect(requestContent).toContain('[redacted native image]');
		expect(requestContent).toContain('"mimeType": "image/webp"');
		expect(requestContent).toContain('"byteLength": 4');
		expect(requestContent).toContain('"sha256"');
		expect(JSON.parse(resolvedContent).vision.stats).toMatchObject({
			nativeImageBytesAfterResize: 4,
			nativeImageBytes: 4,
		});
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
			nativeImageParts: 0,
			nativeImageBytes: 0,
			imageTokenSource: 'none',
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
