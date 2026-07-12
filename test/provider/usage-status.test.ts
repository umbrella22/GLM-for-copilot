import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageQuotaStatus } from '../../src/provider/usage-status';
import {
	__getLastStatusBarItem,
	__resetCommandState,
	MarkdownString,
} from '../support/vscode.mock';

describe('GLM usage quota status', () => {
	let status: UsageQuotaStatus;

	beforeEach(() => {
		__resetCommandState();
		status = new UsageQuotaStatus();
	});

	afterEach(() => status.dispose());

	it('renders only the five-hour progress bar when weekly usage is absent', () => {
		const nextResetTime = new Date(2026, 6, 18, 12, 30, 47).getTime();
		status.report({ fiveHours: { percentage: 5 }, nextResetTime });

		const item = __getLastStatusBarItem();
		expect(item).toBeDefined();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.text).toBe('$(pulse) GLM 5h 5%');
		expect(item.visible).toBe(true);
		expect(item.command).toBe('glm-copilot.queryUsage');
		expect(item.tooltip).toBeInstanceOf(MarkdownString);
		const markdown = item.tooltip as MarkdownString;
		expect(markdown.supportThemeIcons).toBe(true);
		expect(markdown.isTrusted).toEqual({
			enabledCommands: ['glm-copilot.queryUsage'],
		});
		const tooltip = markdown.value;
		expect(tooltip).toContain(
			'<table width="100%"><tr><td><b>GLM Coding Plan</b></td><td align="right"><a href="command:glm-copilot.queryUsage">$(refresh)</a></td></tr></table>',
		);
		expect(tooltip).toContain('5-hour usage');
		expect(tooltip).not.toContain('Weekly usage');
		expect(tooltip).toContain('data:image/svg+xml');
		expect(tooltip).toContain('Next usage update: 2026-07-18 12:30:47');
		expect(tooltip).not.toContain('Click to refresh usage');
	});

	it('renders the optional weekly progress bar and clamps display percentages', () => {
		status.report({
			fiveHours: { percentage: 125 },
			sevenDays: { percentage: -5 },
		});

		const item = __getLastStatusBarItem();
		expect(item).toBeDefined();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.text).toBe('$(pulse) GLM 5h 100%');
		const tooltip = (item.tooltip as MarkdownString).value;
		expect(tooltip).toContain('Weekly usage');
		expect(tooltip).toContain('<b>0%</b> used');
	});
});
