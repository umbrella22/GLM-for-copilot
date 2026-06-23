import vscode from 'vscode';
import type { PricingCurrency } from '../../types';
import { formatMoney, formatUsageCostEstimate, type UsageCostEstimate } from './usage';

export class UsageCostStatus implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly sessionTotals = new Map<PricingCurrency, number>();

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 92);
		this.item.name = 'GLM estimated cost';
		this.item.command = 'glm-copilot.showLogs';
	}

	report(estimate: UsageCostEstimate): void {
		const sessionTotal = (this.sessionTotals.get(estimate.currency) ?? 0) + estimate.totalCost;
		this.sessionTotals.set(estimate.currency, sessionTotal);

		this.item.text = `$(credit-card) GLM ${formatMoney(estimate.totalCost, estimate.currency)}`;
		this.item.tooltip = [
			'GLM estimated cost',
			`Last turn: ${formatUsageCostEstimate(estimate)}`,
			`Session total: ${formatMoney(sessionTotal, estimate.currency)}`,
			`Model: ${estimate.modelName}`,
			`Pricing: input ${formatMoney(estimate.pricing.cacheMissInput, estimate.currency)} / cached ${formatMoney(estimate.pricing.cacheHitInput, estimate.currency)} / output ${formatMoney(estimate.pricing.output, estimate.currency)} per 1M tokens`,
			estimate.pricing.tierLabel ? `Tier: ${estimate.pricing.tierLabel}` : undefined,
			'Click to open GLM logs.',
		]
			.filter((line): line is string => typeof line === 'string')
			.join('\n');
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
	}
}
