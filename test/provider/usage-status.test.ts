import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UsageCostEstimate } from '../../src/provider/pricing/usage';
import { UsageStatus } from '../../src/provider/usage-status';
import {
	__getLastStatusBarItem,
	__resetCommandState,
	MarkdownString,
} from '../support/vscode.mock';

describe('GLM usage quota status', () => {
	let status: UsageStatus;

	beforeEach(() => {
		__resetCommandState();
		status = new UsageStatus();
	});

	afterEach(() => status.dispose());

	it('renders only the five-hour progress bar when weekly usage is absent', () => {
		const nextResetTime = new Date(2026, 6, 18, 12, 30, 47).getTime();
		status.reportQuota({ fiveHours: { percentage: 5, nextResetTime } });

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
		expect(tooltip).toContain('5-hour reset');
		expect(tooltip).toContain('2026-07-18 12:30:47');
		expect(tooltip).not.toContain('Weekly reset');
		expect(tooltip).not.toContain('Click to refresh usage');
	});

	it('renders separate reset times for the five-hour and weekly windows', () => {
		const fiveHoursReset = new Date(2026, 6, 18, 12, 30, 47).getTime();
		const sevenDaysReset = new Date(2026, 6, 22, 8, 15, 12).getTime();
		status.reportQuota({
			fiveHours: { percentage: 125, nextResetTime: fiveHoursReset },
			sevenDays: { percentage: -5, nextResetTime: sevenDaysReset },
		});

		const item = __getLastStatusBarItem();
		expect(item).toBeDefined();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.text).toBe('$(pulse) GLM 5h 100%');
		const tooltip = (item.tooltip as MarkdownString).value;
		expect(tooltip).toContain('Weekly usage');
		expect(tooltip).toContain('<b>0%</b> used');
		expect(tooltip).toContain('5-hour reset');
		expect(tooltip).toContain('2026-07-18 12:30:47');
		expect(tooltip).toContain('Weekly reset');
		expect(tooltip).toContain('2026-07-22 08:15:12');
	});

	it('renders a pay-as-you-go waiting state before the first request', () => {
		status.showBalanceBilling();

		const item = __getLastStatusBarItem();
		expect(item).toBeDefined();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.text).toBe('$(credit-card) GLM PAYG');
		expect(item.command).toBe('glm-copilot.openSettings');
		const markdown = item.tooltip as MarkdownString;
		expect(markdown.isTrusted).toEqual({
			enabledCommands: ['glm-copilot.openSettings'],
		});
		expect(markdown.value).toContain('GLM pay-as-you-go');
		expect(markdown.value).toContain('Cost will appear after the next request completes.');
	});

	it('renders last-request and session costs for pay-as-you-go usage', () => {
		status.reportBalanceCost(createCostEstimate(0.005));
		status.reportBalanceCost(createCostEstimate(0.01));

		const item = __getLastStatusBarItem();
		expect(item).toBeDefined();
		if (!item) throw new Error('Expected a status bar item');
		expect(item.text).toBe('$(credit-card) GLM $0.010');
		const tooltip = (item.tooltip as MarkdownString).value;
		expect(tooltip).toContain('<b>$0.010</b>');
		expect(tooltip).toContain('$0.015');
		expect(tooltip).toContain('GLM &lt;custom&gt;');
		expect(tooltip).toContain('&lt;$0.0001');
	});
});

function createCostEstimate(totalCost: number): UsageCostEstimate {
	return {
		modelId: 'glm-custom',
		modelName: 'GLM <custom>',
		currency: 'USD',
		inputCost: totalCost / 2,
		outputCost: totalCost / 2,
		totalCost,
		cacheHitInputTokens: 100,
		cacheMissInputTokens: 200,
		outputTokens: 300,
		pricing: {
			cacheHitInput: 0.000_01,
			cacheMissInput: 1,
			output: 4,
		},
	};
}
