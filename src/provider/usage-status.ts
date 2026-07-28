import vscode from 'vscode';
import { CREDENTIAL_CHANNELS, formatCredentialChannel } from '../auth';
import { t } from '../i18n';
import type { CredentialChannel } from '../types';
import { formatMoney, type UsageCostEstimate } from './pricing/usage';
import type { GLMCountQuotaMetric, GLMTokenQuotaMetric, GLMTokenQuotaUsage } from './usage';

const STATUS_BAR_PRIORITY = 92;
const PROGRESS_BAR_WIDTH = 320;
const PROGRESS_BAR_HEIGHT = 6;
const QUERY_USAGE_COMMAND = 'glm-copilot.queryUsage';
const OPEN_SETTINGS_COMMAND = 'glm-copilot.openSettings';

export class UsageStatus implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly quotas = new Map<CredentialChannel, GLMTokenQuotaUsage>();
	private readonly quotaUpdatedAt = new Map<CredentialChannel, number>();
	private readonly balanceSessionTotals = new Map<CredentialChannel, number>();
	private readonly lastBalanceEstimates = new Map<CredentialChannel, UsageCostEstimate>();
	private readonly balanceUpdatedAt = new Map<CredentialChannel, number>();
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
		this.quotaUpdatedAt.set(channel, Date.now());
		this.activeChannels.add(channel);
		this.render();
	}

	clearQuota(channel: CredentialChannel): void {
		this.quotas.delete(channel);
		this.quotaUpdatedAt.delete(channel);
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
		this.balanceUpdatedAt.set(channel, Date.now());
		this.activeChannels.add(channel);
		this.render();
	}

	hide(): void {
		this.item.hide();
	}

	reset(): void {
		this.quotas.clear();
		this.quotaUpdatedAt.clear();
		this.balanceSessionTotals.clear();
		this.lastBalanceEstimates.clear();
		this.balanceUpdatedAt.clear();
		this.activeChannels.clear();
		this.hide();
	}

	/** Reset active connection/quota state without losing session PAYG totals. */
	resetConnections(): void {
		this.quotas.clear();
		this.quotaUpdatedAt.clear();
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
			quotaUpdatedAt: this.quotaUpdatedAt,
			lastBalanceEstimates: this.lastBalanceEstimates,
			balanceSessionTotals: this.balanceSessionTotals,
			balanceUpdatedAt: this.balanceUpdatedAt,
			hasCodingChannel,
		});
		this.item.show();
	}
}

interface CombinedUsageTooltipOptions {
	channels: readonly CredentialChannel[];
	quotas: ReadonlyMap<CredentialChannel, GLMTokenQuotaUsage>;
	quotaUpdatedAt: ReadonlyMap<CredentialChannel, number>;
	lastBalanceEstimates: ReadonlyMap<CredentialChannel, UsageCostEstimate>;
	balanceSessionTotals: ReadonlyMap<CredentialChannel, number>;
	balanceUpdatedAt: ReadonlyMap<CredentialChannel, number>;
	hasCodingChannel: boolean;
}

export function createCombinedUsageTooltip(
	options: CombinedUsageTooltipOptions,
): vscode.MarkdownString {
	const command = options.hasCodingChannel ? QUERY_USAGE_COMMAND : OPEN_SETTINGS_COMMAND;
	const tooltip = createInteractiveTooltip(
		t('usage.status.name'),
		command,
		options.hasCodingChannel ? 'refresh' : 'settings-gear',
		options.hasCodingChannel ? t('usage.tooltip.refresh') : t('usage.tooltip.settings'),
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
			appendQuotaContent(tooltip, quota, options.quotaUpdatedAt.get(channel));
			continue;
		}
		appendBalanceContent(
			tooltip,
			options.lastBalanceEstimates.get(channel),
			options.balanceSessionTotals.get(channel),
		);
		appendLastUpdated(tooltip, options.balanceUpdatedAt.get(channel));
	}
	return tooltip;
}

export function createUsageQuotaTooltip(quota: GLMTokenQuotaUsage): vscode.MarkdownString {
	const tooltip = createInteractiveTooltip(
		t('usage.status.title'),
		QUERY_USAGE_COMMAND,
		'refresh',
		t('usage.tooltip.refresh'),
	);
	appendQuotaContent(tooltip, quota);
	return tooltip;
}

function appendQuotaContent(
	tooltip: vscode.MarkdownString,
	quota: GLMTokenQuotaUsage,
	updatedAt?: number,
): void {
	appendPlanSummary(tooltip, quota);
	appendPercentageMetric(
		tooltip,
		t('usage.status.session'),
		t('usage.status.window.fiveHours'),
		quota.fiveHours,
	);
	if (quota.sevenDays) {
		appendPercentageMetric(
			tooltip,
			t('usage.status.weekly'),
			t('usage.status.window.sevenDays'),
			quota.sevenDays,
		);
	}
	if (quota.mcpMonthlyQuota) {
		appendCountMetric(tooltip, quota.mcpMonthlyQuota);
	}
	appendLastUpdated(tooltip, updatedAt);
}

export function createBalanceUsageTooltip(
	estimate: UsageCostEstimate | undefined,
	sessionTotal: number | undefined,
): vscode.MarkdownString {
	const tooltip = createInteractiveTooltip(
		t('usage.balance.title'),
		OPEN_SETTINGS_COMMAND,
		'settings-gear',
		t('usage.tooltip.settings'),
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
	actionLabel: string,
): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString('', true);
	tooltip.supportHtml = true;
	tooltip.supportThemeIcons = true;
	tooltip.isTrusted = { enabledCommands: [command] };
	tooltip.appendMarkdown(
		`<table width="100%"><tr><td><b>${escapeHtmlText(title)}</b></td><td align="right"><a href="command:${command}">$(${icon})&nbsp; ${escapeHtmlText(actionLabel)}</a></td></tr></table>\n\n---\n\n`,
	);
	return tooltip;
}

function appendPlanSummary(tooltip: vscode.MarkdownString, quota: GLMTokenQuotaUsage): void {
	const rows = [
		quota.planName
			? `<tr><td>${escapeHtmlText(t('usage.tooltip.plan'))}</td><td align="right"><b>${escapeHtmlText(quota.planName)}</b></td></tr>`
			: undefined,
		quota.renewsAt
			? `<tr><td>${escapeHtmlText(t('usage.tooltip.renews'))}</td><td align="right">${escapeHtmlText(formatSubscriptionDate(quota.renewsAt))}</td></tr>`
			: undefined,
	].filter((row): row is string => row !== undefined);
	if (rows.length > 0) {
		tooltip.appendMarkdown(`<table width="100%">${rows.join('')}</table>\n\n`);
	}
}

function appendPercentageMetric(
	tooltip: vscode.MarkdownString,
	label: string,
	window: string,
	metric: GLMTokenQuotaMetric,
): void {
	const percentage = clampPercentage(metric.percentage);
	appendQuotaMetric(
		tooltip,
		label,
		window,
		formatPercentage(percentage),
		percentage,
		metric.nextResetTime,
	);
}

function appendCountMetric(tooltip: vscode.MarkdownString, metric: GLMCountQuotaMetric): void {
	const percentage = clampPercentage(metric.limit > 0 ? (metric.used / metric.limit) * 100 : 0);
	appendQuotaMetric(
		tooltip,
		t('usage.status.mcpMonthlyQuota'),
		t('usage.status.window.monthly'),
		`${formatCount(metric.used)} / ${formatCount(metric.limit)}`,
		percentage,
		metric.nextResetTime,
	);
}

function appendQuotaMetric(
	tooltip: vscode.MarkdownString,
	label: string,
	window: string,
	valueLabel: string,
	percentage: number,
	nextResetTime: number | undefined,
): void {
	const progressBarUri = createProgressBarDataUri(percentage);
	const resetLabel = formatResetCountdown(nextResetTime);
	tooltip.appendMarkdown(
		`<table width="100%"><tr><td><b>${escapeHtmlText(label)}</b></td><td align="right">${escapeHtmlText(window)}</td></tr><tr><td colspan="2"><img src="${progressBarUri}" width="100%" height="${PROGRESS_BAR_HEIGHT}" /></td></tr><tr><td colspan="2"><b>${escapeHtmlText(valueLabel)}</b>${resetLabel ? `<br>${escapeHtmlText(resetLabel)}` : ''}</td></tr></table>\n\n`,
	);
}

function appendLastUpdated(tooltip: vscode.MarkdownString, value: number | undefined): void {
	if (value === undefined) {
		return;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return;
	}
	tooltip.appendMarkdown(
		`\n\n---\n\n${escapeHtmlText(t('usage.tooltip.lastUpdated', date.toLocaleTimeString()))}`,
	);
}

function createProgressBarDataUri(percentage: number): string {
	const filledWidth = Math.round((percentage / 100) * PROGRESS_BAR_WIDTH);
	const radius = PROGRESS_BAR_HEIGHT / 2;
	const fill =
		filledWidth > 0
			? `<rect x="0" y="0" width="${filledWidth}" height="${PROGRESS_BAR_HEIGHT}" rx="${radius}" fill="#3794ff" />`
			: '';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PROGRESS_BAR_WIDTH}" height="${PROGRESS_BAR_HEIGHT}" viewBox="0 0 ${PROGRESS_BAR_WIDTH} ${PROGRESS_BAR_HEIGHT}"><rect x="0" y="0" width="${PROGRESS_BAR_WIDTH}" height="${PROGRESS_BAR_HEIGHT}" rx="${radius}" fill="#808080" fill-opacity="0.35" />${fill}</svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function formatPercentage(value: number): string {
	return `${Math.round(clampPercentage(value))}%`;
}

function formatResetCountdown(value: number | undefined, now = Date.now()): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Number.isFinite(value)) {
		return undefined;
	}
	const remaining = value - now;
	if (remaining <= 0) {
		return t('usage.tooltip.resetNow');
	}
	return t('usage.tooltip.resetsIn', formatDuration(remaining));
}

function formatDuration(milliseconds: number): string {
	const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
	const days = Math.floor(totalMinutes / 1_440);
	const hours = Math.floor((totalMinutes % 1_440) / 60);
	const minutes = totalMinutes % 60;
	const parts: string[] = [];
	if (days > 0) {
		parts.push(t('usage.tooltip.duration.days', days));
	}
	if (hours > 0) {
		parts.push(t('usage.tooltip.duration.hours', hours));
	}
	if (minutes > 0 && days === 0) {
		parts.push(t('usage.tooltip.duration.minutes', minutes));
	}
	return parts.join(' ');
}

function formatSubscriptionDate(value: string): string {
	if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		return value;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function formatCount(value: number): string {
	return new Intl.NumberFormat(vscode.env.language, { maximumFractionDigits: 2 }).format(value);
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
	return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}
