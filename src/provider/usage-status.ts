import vscode from 'vscode';
import { CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import { t } from '../i18n';
import type { CredentialChannel } from '../types';
import { formatMoney, type UsageCostEstimate } from './pricing/usage';
import type { GLMTokenQuotaMetric, GLMTokenQuotaUsage } from './usage';

const STATUS_BAR_PRIORITY = 92;
const PROGRESS_BAR_WIDTH = 220;
const PROGRESS_BAR_HEIGHT = 4;
const QUERY_USAGE_COMMAND = 'glm-copilot.queryUsage';
const OPEN_SETTINGS_COMMAND = 'glm-copilot.openSettings';

export class UsageStatus implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly quotas = new Map<CredentialChannel, GLMTokenQuotaUsage>();
	private readonly balanceSessionTotals = new Map<CredentialChannel, number>();
	private readonly lastBalanceEstimates = new Map<CredentialChannel, UsageCostEstimate>();
	private activeChannels = new Set<CredentialChannel>();
	private defaultChannel: CredentialChannel = 'china-coding';

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			STATUS_BAR_PRIORITY,
		);
		this.item.name = t('usage.status.name');
	}

	setActiveChannels(
		defaultChannel: CredentialChannel,
		channels: readonly CredentialChannel[],
	): void {
		this.defaultChannel = defaultChannel;
		this.activeChannels = new Set(channels);
		this.render();
	}

	reportQuota(channel: CredentialChannel, quota: GLMTokenQuotaUsage): void {
		this.quotas.set(channel, quota);
		this.activeChannels.add(channel);
		this.render();
	}

	clearQuota(channel: CredentialChannel): void {
		this.quotas.delete(channel);
		this.render();
	}

	showBalanceBilling(channel: CredentialChannel): void {
		this.activeChannels.add(channel);
		this.render();
	}

	reportBalanceCost(channel: CredentialChannel, estimate: UsageCostEstimate): void {
		const sessionTotal = (this.balanceSessionTotals.get(channel) ?? 0) + estimate.totalCost;
		this.balanceSessionTotals.set(channel, sessionTotal);
		this.lastBalanceEstimates.set(channel, estimate);
		this.activeChannels.add(channel);
		this.render();
	}

	hide(): void {
		this.item.hide();
	}

	reset(): void {
		this.quotas.clear();
		this.balanceSessionTotals.clear();
		this.lastBalanceEstimates.clear();
		this.activeChannels.clear();
		this.hide();
	}

	/** Reset active connection/quota state without losing session PAYG totals. */
	resetConnections(): void {
		this.quotas.clear();
		this.activeChannels.clear();
		this.hide();
	}

	dispose(): void {
		this.item.dispose();
	}

	private render(): void {
		const orderedChannels = CREDENTIAL_CHANNELS.filter((channel) =>
			this.activeChannels.has(channel),
		);
		if (orderedChannels.length === 0) {
			this.hide();
			return;
		}

		const headlineChannel = this.activeChannels.has(this.defaultChannel)
			? this.defaultChannel
			: orderedChannels[0];
		const quota = this.quotas.get(headlineChannel);
		const estimate = this.lastBalanceEstimates.get(headlineChannel);
		if (isCodingChannel(headlineChannel)) {
			this.item.text = quota
				? `$(pulse) GLM 5h ${formatPercentage(quota.fiveHours.percentage)}`
				: '$(pulse) GLM Coding Plan';
		} else {
			this.item.text = estimate
				? `$(credit-card) GLM ${formatMoney(estimate.totalCost, estimate.currency)}`
				: '$(credit-card) GLM PAYG';
		}

		const hasCodingChannel = orderedChannels.some(isCodingChannel);
		this.item.command = hasCodingChannel ? QUERY_USAGE_COMMAND : OPEN_SETTINGS_COMMAND;
		this.item.tooltip = createCombinedUsageTooltip({
			channels: orderedChannels,
			quotas: this.quotas,
			lastBalanceEstimates: this.lastBalanceEstimates,
			balanceSessionTotals: this.balanceSessionTotals,
			hasCodingChannel,
		});
		this.item.show();
	}
}

interface CombinedUsageTooltipOptions {
	channels: readonly CredentialChannel[];
	quotas: ReadonlyMap<CredentialChannel, GLMTokenQuotaUsage>;
	lastBalanceEstimates: ReadonlyMap<CredentialChannel, UsageCostEstimate>;
	balanceSessionTotals: ReadonlyMap<CredentialChannel, number>;
	hasCodingChannel: boolean;
}

export function createCombinedUsageTooltip(
	options: CombinedUsageTooltipOptions,
): vscode.MarkdownString {
	const command = options.hasCodingChannel ? QUERY_USAGE_COMMAND : OPEN_SETTINGS_COMMAND;
	const tooltip = createInteractiveTooltip(
		t('usage.status.combinedTitle'),
		command,
		options.hasCodingChannel ? 'refresh' : 'settings-gear',
	);
	for (const [index, channel] of options.channels.entries()) {
		if (index > 0) {
			tooltip.appendMarkdown('\n\n---\n\n');
		}
		tooltip.appendMarkdown(`**${escapeHtmlText(formatCredentialChannel(channel))}**\n\n`);
		if (isCodingChannel(channel)) {
			const quota = options.quotas.get(channel);
			if (!quota) {
				tooltip.appendMarkdown(t('usage.status.waiting'));
				continue;
			}
			appendQuotaContent(tooltip, quota);
			continue;
		}
		appendBalanceContent(
			tooltip,
			options.lastBalanceEstimates.get(channel),
			options.balanceSessionTotals.get(channel),
		);
	}
	return tooltip;
}

export function createUsageQuotaTooltip(quota: GLMTokenQuotaUsage): vscode.MarkdownString {
	const tooltip = createInteractiveTooltip(t('usage.status.title'), QUERY_USAGE_COMMAND, 'refresh');
	appendQuotaContent(tooltip, quota);
	return tooltip;
}

function appendQuotaContent(tooltip: vscode.MarkdownString, quota: GLMTokenQuotaUsage): void {
	appendQuotaMetric(tooltip, t('usage.status.fiveHours'), quota.fiveHours);
	if (quota.sevenDays) {
		appendQuotaMetric(tooltip, t('usage.status.sevenDays'), quota.sevenDays);
	}
	appendQuotaResetTimes(tooltip, quota);
}

export function createBalanceUsageTooltip(
	estimate: UsageCostEstimate | undefined,
	sessionTotal: number | undefined,
): vscode.MarkdownString {
	const tooltip = createInteractiveTooltip(
		t('usage.balance.title'),
		OPEN_SETTINGS_COMMAND,
		'settings-gear',
	);
	appendBalanceContent(tooltip, estimate, sessionTotal);
	return tooltip;
}

function appendBalanceContent(
	tooltip: vscode.MarkdownString,
	estimate: UsageCostEstimate | undefined,
	sessionTotal: number | undefined,
): void {
	if (!estimate || sessionTotal === undefined) {
		tooltip.appendMarkdown(t('usage.balance.waiting'));
		return;
	}

	tooltip.appendMarkdown(
		`<table width="100%"><tr><td><b>${t('usage.balance.lastRequest')}</b></td><td align="right"><b>${escapeHtmlText(formatMoney(estimate.totalCost, estimate.currency))}</b></td></tr><tr><td>${t('usage.balance.sessionTotal')}</td><td align="right">${escapeHtmlText(formatMoney(sessionTotal, estimate.currency))}</td></tr><tr><td>${t('usage.balance.model')}</td><td align="right">${escapeHtmlText(estimate.modelName)}</td></tr></table>\n\n`,
	);
	tooltip.appendMarkdown(`**${t('usage.balance.pricing')}**\n\n`);
	tooltip.appendMarkdown(
		`<table width="100%"><tr><td>${t('usage.balance.input')}</td><td align="right">${escapeHtmlText(formatMoney(estimate.pricing.cacheMissInput, estimate.currency))}</td></tr><tr><td>${t('usage.balance.cachedInput')}</td><td align="right">${escapeHtmlText(formatMoney(estimate.pricing.cacheHitInput, estimate.currency))}</td></tr><tr><td>${t('usage.balance.output')}</td><td align="right">${escapeHtmlText(formatMoney(estimate.pricing.output, estimate.currency))}</td></tr></table>`,
	);
}

function isCodingChannel(channel: CredentialChannel): boolean {
	return channel.endsWith('-coding');
}

function createInteractiveTooltip(
	title: string,
	command: string,
	icon: string,
): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString('', true);
	tooltip.supportHtml = true;
	tooltip.supportThemeIcons = true;
	tooltip.isTrusted = { enabledCommands: [command] };
	tooltip.appendMarkdown(
		`<table width="100%"><tr><td><b>${title}</b></td><td align="right"><a href="command:${command}">$(${icon})</a></td></tr></table>\n\n---\n\n`,
	);
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

function appendQuotaResetTimes(tooltip: vscode.MarkdownString, quota: GLMTokenQuotaUsage): void {
	const rows = [
		formatResetTimeRow(t('usage.status.fiveHoursResetTime'), quota.fiveHours.nextResetTime),
		formatResetTimeRow(t('usage.status.sevenDaysResetTime'), quota.sevenDays?.nextResetTime),
	].filter((row): row is string => row !== undefined);
	if (rows.length > 0) {
		tooltip.appendMarkdown(`<table width="100%">${rows.join('')}</table>`);
	}
}

function formatResetTimeRow(label: string, value: number | undefined): string | undefined {
	const resetTime = formatResetTime(value);
	return resetTime ? `<tr><td>${label}</td><td align="right">${resetTime}</td></tr>` : undefined;
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

function escapeHtmlText(value: string): string {
	return value
		.replace(/&/gu, '&amp;')
		.replace(/</gu, '&lt;')
		.replace(/>/gu, '&gt;')
		.replace(/"/gu, '&quot;')
		.replace(/'/gu, '&#39;');
}

function clampPercentage(value: number): number {
	return Math.max(0, Math.min(100, value));
}
