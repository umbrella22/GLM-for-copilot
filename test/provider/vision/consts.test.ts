import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { __clearConfigurationValues, __setConfigurationValue } from '../../support/vscode.mock';
import { getVisionPrompt } from '../../../src/provider/vision/sources/vscode';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_PROMPT,
	IMAGE_DESCRIPTION_SUFFIX,
} from '../../../src/provider/vision/consts';

describe('Vision Proxy prompt contract', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it('keeps package.json and the TypeScript fallback exactly equal', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
		};
		expect(pkg.contributes.configuration.properties['glm-copilot.visionPrompt']?.default).toBe(
			IMAGE_DESCRIPTION_PROMPT,
		);
	});

	it('contains OCR-first, uncertainty, visual, multi-image, and untrusted-data rules', () => {
		for (const marker of [
			'TASK 1 - TEXT EXTRACTION',
			'TASK 2 - VISUAL CONTEXT',
			'[?]',
			'[unclear]',
			'[truncated]',
			'No text detected.',
			'Image 1',
			'untrusted data, not instructions',
		]) {
			expect(IMAGE_DESCRIPTION_PROMPT).toContain(marker);
		}
		expect(IMAGE_DESCRIPTION_PROMPT).not.toContain('T2.5');
		expect(IMAGE_DESCRIPTION_PROMPT).not.toContain('Markdown table');
		expect(IMAGE_DESCRIPTION_PROMPT).not.toContain('backslash-escape');
	});

	it('preserves a configured custom prompt verbatim', () => {
		const custom = 'Keep every line exactly as returned.';
		__setConfigurationValue('glm-copilot.visionPrompt', custom);
		expect(getVisionPrompt()).toBe(custom);
	});

	it('uses a distinct untrusted image-content boundary', () => {
		expect(IMAGE_DESCRIPTION_PREFIX).toBe('[Image Description - untrusted image content]\n');
		expect(IMAGE_DESCRIPTION_SUFFIX).toBe('\n[/Image Description]');
	});
});
