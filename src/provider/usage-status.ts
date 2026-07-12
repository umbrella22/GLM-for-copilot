import vscode from 'vscode';
import { t } from '../i18n';
import type { GLMTokenQuotaMetric, GLMTokenQuotaUsage } from './usage';

const STATUS_BAR_PRIORITY = 92;
const PROGRESS_BAR_WIDTH = 220;
const PROGRESS_BAR_HEIGHT = 4;
const QUERY_USAGE_COMMAND = 'glm-copilot.queryUsage';

export class UsageQuotaStatus implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			STATUS_BAR_PRIORITY,
		);
		this.item.name = t('usage.status.name');
		this.item.command = QUERY_USAGE_COMMAND;
	}

	report(quota: GLMTokenQuotaUsage): void {
		this.item.text = `$(pulse) GLM 5h ${formatPercentage(quota.fiveHours.percentage)}`;
		this.item.tooltip = createUsageQuotaTooltip(quota);
		this.item.show();
	}

	hide(): void {
		this.item.hide();
	}

	dispose(): void {
		this.item.dispose();
	}
}

export function createUsageQuotaTooltip(quota: GLMTokenQuotaUsage): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString('', true);
	tooltip.supportHtml = true;
	tooltip.supportThemeIcons = true;
	tooltip.isTrusted = { enabledCommands: [QUERY_USAGE_COMMAND] };
	tooltip.appendMarkdown(
		`<table width="100%"><tr><td><b>${t('usage.status.title')}</b></td><td align="right"><a href="command:${QUERY_USAGE_COMMAND}">$(refresh)</a></td></tr></table>\n\n---\n\n`,
	);
	appendQuotaMetric(tooltip, t('usage.status.fiveHours'), quota.fiveHours);
	if (quota.sevenDays) {
		appendQuotaMetric(tooltip, t('usage.status.sevenDays'), quota.sevenDays);
	}
	const nextResetTime = formatResetTime(quota.nextResetTime);
	if (nextResetTime) {
		tooltip.appendMarkdown(t('usage.status.nextResetTime', nextResetTime));
	}
	return tooltip;
}

function appendQuotaMetric(
	tooltip: vscode.MarkdownString,
	label: string,
	metric: GLMTokenQuotaMetric,
): void {
	const percentage = clampPercentage(metric.percentage);
	const progressBarUri = createProgressBarDataUri(percentage);
	tooltip.appendMarkdown(
		`<table width="100%"><tr><td><b>${label}</b></td><td align="right"><b>${formatPercentage(percentage)}</b> ${t('usage.status.used')}</td></tr><tr><td colspan="2"><img src="${progressBarUri}" width="100%" height="${PROGRESS_BAR_HEIGHT}" /></td></tr></table>\n\n`,
	);
}

function createProgressBarDataUri(percentage: number): string {
	const filledWidth = Math.round((percentage / 100) * PROGRESS_BAR_WIDTH);
	const radius = PROGRESS_BAR_HEIGHT / 2;
	const fill =
		filledWidth > 0
			? `<rect x="0" y="0" width="${filledWidth}" height="${PROGRESS_BAR_HEIGHT}" rx="${radius}" fill="#3794ff" />`
			: '';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PROGRESS_BAR_WIDTH}" height="${PROGRESS_BAR_HEIGHT}" viewBox="0 0 ${PROGRESS_BAR_WIDTH} ${PROGRESS_BAR_HEIGHT}"><rect x="0" y="0" width="${PROGRESS_BAR_WIDTH}" height="${PROGRESS_BAR_HEIGHT}" rx="${radius}" fill="#3c3c3c" />${fill}</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function formatPercentage(value: number): string {
	return `${Math.round(clampPercentage(value))}%`;
}

function formatResetTime(value: number | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function clampPercentage(value: number): number {
	return Math.max(0, Math.min(100, value));
}
