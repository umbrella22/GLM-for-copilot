import { Script } from 'node:vm';
import type vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import {
	getModelManagerHtml,
	getModelManagerStyle,
	isManagerWebviewMessage,
	type ManagerPanelState,
} from '../../src/manager/ui';

function createState(): ManagerPanelState {
	return {
		activeView: 'models',
		revision: 4,
		selectedScope: 'global',
		scopes: [{ id: 'global', label: 'User' }],
		defaultConnection: {
			endpoint: 'china-coding',
			endpointLabel: 'China Coding Plan',
			allowedEndpoints: [{ value: 'china-coding', label: 'China Coding Plan' }],
			resolvedBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
			protocolLabel: 'OpenAI',
			credentialChannel: 'china-coding',
			credentialLabel: 'China Coding Plan',
			hasApiKey: true,
			usesCustomBaseUrl: false,
		},
		models: [
			{
				id: 'glm-5.2',
				name: 'GLM-5.2 </script><script>fail()</script>',
				apiModelId: 'glm-5.2',
				connectionLabel: 'Follow default',
				visionMode: 'proxy',
				visionModeLabel: 'Vision proxy',
				status: { label: 'Ready', tone: 'success' },
				isCustom: false,
				draft: {
					name: 'GLM-5.2',
					apiModelId: 'glm-5.2',
					endpointRoute: 'default',
					visionMode: 'proxy',
				},
				allowedRoutes: [{ value: 'default', label: 'Follow default' }],
			},
		],
		credentials: [
			{
				channel: 'china-coding',
				label: 'China Coding Plan',
				hasApiKey: true,
				modelCount: 1,
			},
		],
		vision: {
			source: 'auto',
			summaryTitle: 'Automatic',
			summaryDetail: 'GLM first, VS Code fallback',
			lmModels: [],
			endpoint: {
				url: '',
				modelId: '',
				hasApiKey: false,
				hasCustomHeaders: false,
				customHeaderNames: [],
				extraBodyJson: '{}',
			},
			test: { status: 'idle' },
		},
	};
}

function createHtml(): string {
	return getModelManagerHtml(
		{ cspSource: 'vscode-webview://manager' } as vscode.Webview,
		createState(),
	);
}

describe('model manager UI', () => {
	it('escapes initial state and emits a nonce-only CSP', () => {
		const html = createHtml();

		expect(html).toContain('default-src &#39;none&#39;');
		expect(html).toContain('script-src &#39;nonce-');
		expect(html).toContain('img-src vscode-webview://manager data:');
		expect(html).not.toContain('</script><script>fail()');
		expect(html).toContain('GLM-5.2 \\u003c/script>\\u003cscript>fail()\\u003c/script>');
	});

	it('keeps interactive motion explicit and accessible', () => {
		const style = getModelManagerStyle();

		expect(style).not.toMatch(/transition(?:-property)?:\s*all/u);
		expect(style).toContain('scale: 0.96');
		expect(style).toContain('min-width: 40px');
		expect(style).toContain('min-height: 40px');
		expect(style).toContain('-webkit-font-smoothing: antialiased');
		expect(style).toContain('font-variant-numeric: tabular-nums');
		expect(style).toContain('text-wrap: balance');
		expect(style).toContain('text-wrap: pretty');
		expect(style).toContain('transition-property: scale, background-color, color, opacity');
		expect(style).toContain('.segmented-option input:disabled + span');
	});

	it('wires accessible tabs, modal focus containment, and named radio groups', () => {
		const html = createHtml();

		expect(html).toContain('id="modelsTab"');
		expect(html).toContain('aria-controls="viewRoot"');
		expect(html).toContain('role="tabpanel"');
		expect(html).toContain("viewRoot.setAttribute('aria-labelledby', activeTab.id)");
		expect(html).toContain('aria-hidden="true" inert');
		expect(html).toContain("event.key === 'ArrowRight'");
		expect(html).toContain("event.key === 'ArrowLeft'");
		expect(html).toContain("event.key === 'Home'");
		expect(html).toContain("event.key === 'End'");
		expect(html).toContain('appRoot.inert = true');
		expect(html).toContain('inspector.inert = true');
		expect(html).toContain("add.id = 'addModelButton'");
		expect(html).toContain("row.setAttribute('aria-controls', 'inspector')");
		expect(html).toContain("row.setAttribute('aria-haspopup', 'dialog')");
		expect(html).toContain("header.scope = 'col'");
		expect(html).toContain('row.dataset.modelId === openerModelId');
		expect(html).toContain("event.key === 'Tab'");
		expect(html).toContain('!node.closest(\'[hidden], [aria-hidden="true"], [inert]\')');
		expect(html).toContain("control.setAttribute('aria-labelledby', labelNode.id)");
		expect(html).toContain("group.setAttribute('aria-labelledby', 'visionSourceLabel')");
		expect(html).toContain('apiModelId !== apiModelId.trim()');
		expect(html).toContain('id !== id.trim()');
		expect(html).toContain('strings.nonCanonicalModelId');
	});

	it('correlates incremental Vision Proxy tests without rebuilding the form', () => {
		const html = createHtml();

		expect(html).toContain('pendingVisionTestId = testId');
		expect(html).toContain('pendingVisionTestId === undefined');
		expect(html).toContain('message.value.testId !== pendingVisionTestId');
		expect(html).toContain("state.activeView !== 'vision'");
		expect(html).toContain("viewRoot.querySelector('.test-result')?.remove()");
	});

	it('uses the VS Code theme for native controls and stacks segmented controls on narrow screens', () => {
		const style = getModelManagerStyle();

		expect(style).toContain('body.vscode-light');
		expect(style).toContain('body.vscode-dark');
		expect(style).toContain('color-scheme: light');
		expect(style).toContain('color-scheme: dark');
		expect(style).toContain('grid-template-columns: minmax(0, 1fr)');
		expect(style).toContain('margin-left: 0');
	});

	it('emits syntactically valid inline JavaScript', () => {
		const html = createHtml();
		const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u)?.[1];

		if (!script) throw new Error('Expected an inline manager script.');
		expect(() => new Script(script)).not.toThrow();
	});

	it('accepts known message envelopes and leaves payload validation to the host', () => {
		expect(
			isManagerWebviewMessage({
				type: 'saveModel',
				value: 'host validates this',
			}),
		).toBe(true);
		expect(isManagerWebviewMessage({ type: 'refresh' })).toBe(true);
		expect(isManagerWebviewMessage({ type: 'unknown' })).toBe(false);
		expect(isManagerWebviewMessage(null)).toBe(false);
	});
});
