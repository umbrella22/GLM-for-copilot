import { randomBytes } from 'crypto';
import vscode from 'vscode';
import { getModelManagerScript } from './script';
import { getModelManagerStrings } from './strings';
import { getModelManagerStyle } from './style';
import type { ManagerPanelState } from './types';

export function getModelManagerHtml(webview: vscode.Webview, state: ManagerPanelState): string {
	const nonce = randomBytes(16).toString('base64');
	const strings = getModelManagerStrings();
	const initialState = escapeScriptJson(state);
	const initialStrings = escapeScriptJson(strings);
	const htmlLang = vscode.env.language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en';
	const csp = [
		"default-src 'none'",
		`style-src 'nonce-${nonce}'`,
		`script-src 'nonce-${nonce}'`,
		`img-src ${webview.cspSource} data:`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(strings.title)}</title>
	<style nonce="${nonce}">${getModelManagerStyle()}</style>
</head>
<body>
		<div id="appRoot" class="app">
		<header class="page-header">
			<div class="header-top">
				<h1 class="page-title">${escapeHtml(strings.title)}</h1>
				<div class="header-controls">
					<div id="scopeControl" class="scope-control">
						<label for="scopeSelect">${escapeHtml(strings.scope)}</label>
						<select id="scopeSelect"></select>
					</div>
					<button id="refreshButton" class="secondary refresh-button" type="button">${escapeHtml(strings.refresh)}</button>
				</div>
			</div>
			<nav class="view-tabs" role="tablist" aria-label="${escapeHtml(strings.title)}">
				<button id="modelsTab" class="view-tab" type="button" role="tab" aria-controls="viewRoot" data-view="models">${escapeHtml(strings.viewModels)}</button>
				<button id="connectionsTab" class="view-tab" type="button" role="tab" aria-controls="viewRoot" data-view="connections">${escapeHtml(strings.viewConnections)}</button>
				<button id="visionTab" class="view-tab" type="button" role="tab" aria-controls="viewRoot" data-view="vision">${escapeHtml(strings.viewVision)}</button>
			</nav>
		</header>
		<main id="viewRoot" class="page-content" role="tabpanel" tabindex="0"></main>
	</div>
	<div id="inspectorBackdrop" class="inspector-backdrop" aria-hidden="true"></div>
	<aside id="inspector" class="inspector" role="dialog" aria-modal="true" aria-labelledby="inspectorHeading" aria-hidden="true" inert>
		<header class="inspector-header">
			<h2 id="inspectorHeading" class="inspector-heading">${escapeHtml(strings.inspectorTitle)}</h2>
			<button id="inspectorClose" class="ghost inspector-close" type="button" aria-label="${escapeHtml(strings.close)}" title="${escapeHtml(strings.close)}">&times;</button>
		</header>
		<div id="inspectorBody" class="inspector-body"></div>
	</aside>
	<div id="globalStatus" class="global-status" role="status" aria-live="polite" aria-atomic="true"></div>
	<div id="busyMask" class="busy-mask" aria-label="${escapeHtml(strings.working)}" hidden></div>
	<script nonce="${nonce}">${getModelManagerScript(initialState, initialStrings)}</script>
</body>
</html>`;
}

function escapeScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll('<', '\\u003c')
		.replaceAll('\u2028', '\\u2028')
		.replaceAll('\u2029', '\\u2029');
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
