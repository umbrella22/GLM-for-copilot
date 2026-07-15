export function getModelManagerStyle(): string {
	return `
		:root {
			color-scheme: light dark;
			--manager-header-height: 104px;
			--manager-inspector-width: 388px;
			--manager-fast: 120ms;
			--manager-panel: 140ms;
		}
		* {
			box-sizing: border-box;
		}
		html {
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
			body {
				margin: 0;
			min-width: 320px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
				line-height: 1.45;
			}
			body.vscode-light,
			body.vscode-high-contrast-light {
				color-scheme: light;
			}
			body.vscode-dark,
			body.vscode-high-contrast {
				color-scheme: dark;
			}
		button,
		input,
		select,
		textarea {
			font: inherit;
		}
		button,
		select,
		input[type='checkbox'],
		input[type='radio'] {
			cursor: pointer;
		}
		button:disabled,
		select:disabled,
		input:disabled,
		textarea:disabled {
			cursor: default;
			opacity: 0.55;
		}
		button:focus-visible,
		input:focus-visible,
		select:focus-visible,
		textarea:focus-visible,
		[tabindex='0']:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 1px;
		}
		button {
			min-width: 40px;
			min-height: 40px;
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 3px;
			padding: 7px 14px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			transition-property: scale, background-color, color, opacity;
			transition-duration: var(--manager-fast);
			transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
		}
		button:hover:not(:disabled) {
			background: var(--vscode-button-hoverBackground);
		}
		button:active:not(:disabled) {
			scale: 0.96;
		}
		button.secondary {
			color: var(--vscode-button-secondaryForeground);
			background: var(--vscode-button-secondaryBackground);
		}
		button.secondary:hover:not(:disabled) {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		button.ghost {
			color: var(--vscode-foreground);
			background: transparent;
			border-color: transparent;
		}
		button.ghost:hover:not(:disabled) {
			background: var(--vscode-toolbar-hoverBackground);
		}
		button.danger {
			color: var(--vscode-errorForeground);
			background: transparent;
			border-color: var(--vscode-input-border, transparent);
		}
		button.danger:hover:not(:disabled) {
			background: var(--vscode-inputValidation-errorBackground, var(--vscode-toolbar-hoverBackground));
		}
		input[type='text'],
		input[type='url'],
		input[type='password'],
		input[type='number'],
		select,
		textarea {
			width: 100%;
			min-height: 40px;
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 2px;
			padding: 8px 10px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			transition-property: opacity;
			transition-duration: var(--manager-fast);
			transition-timing-function: ease-out;
		}
		textarea {
			min-height: 96px;
			resize: vertical;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
		}
		input[type='number'] {
			font-variant-numeric: tabular-nums;
		}
		input[type='checkbox'],
		input[type='radio'] {
			accent-color: var(--vscode-focusBorder);
		}
		[hidden] {
			display: none !important;
		}
		.app {
			min-height: 100vh;
		}
		.page-header {
			position: sticky;
			z-index: 20;
			top: 0;
			background: var(--vscode-editor-background);
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.header-top {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			min-height: 56px;
			padding: 8px 20px 7px;
		}
		.page-title {
			min-width: 0;
			margin: 0;
			font-size: 18px;
			font-weight: 600;
			letter-spacing: 0;
			text-wrap: balance;
		}
		.header-controls {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: 8px;
			min-width: 0;
		}
		.scope-control {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}
		.scope-control label {
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}
		.scope-control select {
			width: min(240px, 30vw);
		}
		.refresh-button {
			min-width: 40px;
			padding-inline: 12px;
		}
		.view-tabs {
			display: flex;
			align-items: stretch;
			gap: 2px;
			min-height: 47px;
			padding: 0 20px;
		}
		.view-tab {
			position: relative;
			min-width: 92px;
			border: 0;
			border-radius: 0;
			padding: 0 12px;
			color: var(--vscode-descriptionForeground);
			background: transparent;
			font-weight: 500;
		}
		.view-tab:hover:not(:disabled) {
			color: var(--vscode-foreground);
			background: var(--vscode-toolbar-hoverBackground);
		}
		.view-tab[aria-selected='true'] {
			color: var(--vscode-foreground);
		}
		.view-tab[aria-selected='true']::after {
			content: '';
			position: absolute;
			left: 10px;
			right: 10px;
			bottom: -1px;
			height: 2px;
			background: var(--vscode-focusBorder);
		}
		.page-content {
			padding: 20px;
		}
		.view-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 20px;
			margin-bottom: 18px;
		}
		.view-heading {
			margin: 0;
			font-size: 16px;
			font-weight: 600;
			letter-spacing: 0;
			text-wrap: balance;
		}
		.view-description {
			max-width: 760px;
			margin: 4px 0 0;
			color: var(--vscode-descriptionForeground);
			text-wrap: pretty;
		}
		.section-heading {
			margin: 0;
			font-size: 14px;
			font-weight: 600;
			letter-spacing: 0;
			text-wrap: balance;
		}
		.section-description {
			margin: 3px 0 0;
			color: var(--vscode-descriptionForeground);
			text-wrap: pretty;
		}
		.table-scroll {
			overflow-x: auto;
			border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-variant-numeric: tabular-nums;
		}
		.models-table {
			min-width: 720px;
		}
		.credentials-table {
			min-width: 690px;
		}
		th {
			height: 38px;
			padding: 7px 12px;
			color: var(--vscode-descriptionForeground);
			background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
			font-size: 12px;
			font-weight: 600;
			text-align: left;
			white-space: nowrap;
		}
		td {
			height: 44px;
			padding: 7px 12px;
			border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			vertical-align: middle;
		}
		tbody tr {
			transition-property: background-color, color;
			transition-duration: var(--manager-fast);
			transition-timing-function: ease-out;
		}
		.models-table tbody tr {
			cursor: pointer;
		}
		.models-table tbody tr:hover,
		.models-table tbody tr[aria-selected='true'] {
			background: var(--vscode-list-hoverBackground);
		}
		.models-table tbody tr[aria-selected='true'] {
			color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
			box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
		}
		.primary-cell {
			font-weight: 600;
			text-wrap: pretty;
		}
		.secondary-line {
			margin-top: 2px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}
		.monospace {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
		}
		.status-inline {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			min-width: 0;
		}
		.status-dot {
			flex: 0 0 auto;
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--vscode-descriptionForeground);
		}
		.status-dot.success {
			background: var(--vscode-testing-iconPassed, #73c991);
		}
		.status-dot.warning {
			background: var(--vscode-testing-iconQueued, #cca700);
		}
		.status-dot.error {
			background: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
		}
		.empty-state {
			padding: 36px 12px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
			text-wrap: pretty;
		}
		.connection-editor,
		.vision-editor {
			padding-bottom: 24px;
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.form-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 16px;
			max-width: 900px;
			margin-top: 16px;
		}
		.form-grid.one-column {
			grid-template-columns: minmax(0, 620px);
		}
		.field {
			display: grid;
			align-content: start;
			gap: 6px;
			min-width: 0;
		}
		.field.full {
			grid-column: 1 / -1;
		}
		.field > label,
		.field-label {
			font-weight: 600;
		}
		.hint {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			line-height: 1.45;
			text-wrap: pretty;
		}
		.checkbox-field {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 40px;
			font-weight: 600;
		}
		.checkbox-field input {
			flex: 0 0 auto;
			width: 18px;
			height: 18px;
		}
		.definition-list {
			display: grid;
			grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
			max-width: 900px;
			margin: 18px 0 0;
			border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.definition-list dt,
		.definition-list dd {
			min-height: 36px;
			margin: 0;
			padding: 8px 10px;
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.definition-list dt {
			color: var(--vscode-descriptionForeground);
		}
		.definition-list dd {
			min-width: 0;
			overflow-wrap: anywhere;
			font-variant-numeric: tabular-nums;
		}
		.section-block {
			padding-top: 24px;
		}
		.actions,
		.row-actions {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
		}
		.actions {
			margin-top: 18px;
		}
		.row-actions {
			justify-content: flex-end;
		}
		.row-actions button {
			padding-inline: 10px;
		}
		.segmented {
			display: inline-flex;
			align-items: stretch;
			flex-wrap: wrap;
		}
		.segmented-option {
			position: relative;
			font-weight: 400;
		}
		.segmented-option input {
			position: absolute;
			width: 1px;
			height: 1px;
			opacity: 0;
			pointer-events: none;
		}
		.segmented-option span {
			display: flex;
			align-items: center;
			justify-content: center;
			min-width: 40px;
			min-height: 40px;
			padding: 7px 13px;
			border: 1px solid var(--vscode-radio-inactiveBorder, var(--vscode-button-border, transparent));
			color: var(--vscode-radio-inactiveForeground, var(--vscode-foreground));
			background: var(--vscode-radio-inactiveBackground, var(--vscode-button-secondaryBackground));
			user-select: none;
			transition-property: scale, background-color, color, border-color, opacity;
			transition-duration: var(--manager-fast);
			transition-timing-function: ease-out;
		}
		.segmented-option:first-child span {
			border-radius: 3px 0 0 3px;
		}
		.segmented-option:last-child span {
			border-radius: 0 3px 3px 0;
		}
		.segmented-option + .segmented-option span {
			margin-left: -1px;
		}
		.segmented-option input:checked + span {
			position: relative;
			z-index: 1;
			border-color: var(--vscode-radio-activeBorder, var(--vscode-focusBorder));
			color: var(--vscode-radio-activeForeground, var(--vscode-button-foreground));
			background: var(--vscode-radio-activeBackground, var(--vscode-button-background));
		}
		.segmented-option:active input:not(:disabled) + span {
			scale: 0.96;
		}
		.segmented-option input:disabled + span {
			cursor: default;
			opacity: 0.55;
		}
		.segmented-option input:focus-visible + span {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 1px;
		}
		.summary-line {
			display: flex;
			align-items: flex-start;
			gap: 9px;
			max-width: 900px;
			margin: 14px 0 0;
			padding: 10px 0;
			border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.summary-content {
			min-width: 0;
		}
		.summary-title {
			font-weight: 600;
			text-wrap: balance;
		}
		.summary-detail {
			margin-top: 2px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			text-wrap: pretty;
		}
		.test-result {
			max-width: 900px;
			margin-top: 18px;
			padding-top: 18px;
			border-top: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.test-result-grid {
			display: grid;
			grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
			gap: 16px;
			margin-top: 12px;
		}
		.test-result-pane {
			min-width: 0;
		}
		.test-result-label {
			margin-bottom: 6px;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			text-wrap: pretty;
		}
		.test-image {
			display: block;
			max-width: 180px;
			height: auto;
			outline: 1px solid rgba(255, 255, 255, 0.1);
			outline-offset: -1px;
			background: var(--vscode-input-background);
		}
		.test-response {
			max-height: 220px;
			margin: 0;
			overflow: auto;
			padding: 10px;
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 2px;
			color: var(--vscode-editor-foreground);
			background: var(--vscode-editor-background);
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
			white-space: pre-wrap;
			word-break: break-word;
		}
		.inspector-backdrop {
			position: fixed;
			z-index: 39;
			inset: 0;
			background: rgba(0, 0, 0, 0.12);
			opacity: 0;
			pointer-events: none;
			transition-property: opacity;
			transition-duration: var(--manager-panel);
			transition-timing-function: ease-out;
		}
		.inspector-backdrop.open {
			opacity: 1;
			pointer-events: auto;
		}
		.inspector {
			position: fixed;
			z-index: 40;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(var(--manager-inspector-width), calc(100vw - 24px));
			overflow-y: auto;
			border-left: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			box-shadow: -10px 0 24px rgba(0, 0, 0, 0.16);
			opacity: 0;
			transform: translateX(18px);
			pointer-events: none;
			transition-property: transform, opacity;
			transition-duration: var(--manager-panel);
			transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
		}
		.inspector.open {
			opacity: 1;
			transform: translateX(0);
			pointer-events: auto;
		}
		.inspector-header {
			position: sticky;
			z-index: 2;
			top: 0;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 56px;
			padding: 8px 14px 8px 18px;
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
		}
		.inspector-heading {
			min-width: 0;
			margin: 0;
			font-size: 15px;
			font-weight: 600;
			letter-spacing: 0;
			text-wrap: balance;
		}
		.inspector-close {
			flex: 0 0 40px;
			width: 40px;
			padding: 0;
			font-size: 18px;
			line-height: 1;
		}
		.inspector-body {
			display: grid;
			gap: 16px;
			padding: 18px;
		}
		.inspector-actions {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
			padding-top: 4px;
		}
		.global-status {
			position: fixed;
			z-index: 60;
			left: 20px;
			bottom: 16px;
			max-width: min(560px, calc(100vw - 40px));
			min-height: 0;
			padding: 8px 11px;
			border-radius: 3px;
			color: var(--vscode-notifications-foreground, var(--vscode-foreground));
			background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
			box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 5px 18px rgba(0, 0, 0, 0.18);
			text-wrap: pretty;
			opacity: 0;
			transform: translateY(8px);
			pointer-events: none;
			transition-property: transform, opacity;
			transition-duration: var(--manager-panel);
			transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
		}
		.global-status.visible {
			opacity: 1;
			transform: translateY(0);
		}
		.global-status.error {
			color: var(--vscode-errorForeground);
		}
		.global-status.success {
			color: var(--vscode-testing-iconPassed, #73c991);
		}
		.global-status.warning {
			color: var(--vscode-testing-iconQueued, #cca700);
		}
		.busy-mask {
			position: fixed;
			z-index: 55;
			inset: 0;
			cursor: progress;
			background: transparent;
		}
		body.vscode-light .test-image,
		body.vscode-high-contrast-light .test-image {
			outline-color: rgba(0, 0, 0, 0.1);
		}
		body.vscode-light .inspector-backdrop,
		body.vscode-high-contrast-light .inspector-backdrop {
			background: rgba(0, 0, 0, 0.08);
		}
		body.vscode-light .global-status,
		body.vscode-high-contrast-light .global-status {
			box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 5px 18px rgba(0, 0, 0, 0.12);
		}
		@media (max-width: 820px) {
			:root {
				--manager-header-height: 148px;
			}
			.header-top {
				align-items: flex-start;
				flex-direction: column;
				gap: 8px;
				padding-inline: 14px;
			}
			.header-controls {
				width: 100%;
			}
			.scope-control {
				flex: 1 1 auto;
			}
			.scope-control select {
				width: 100%;
			}
			.view-tabs {
				overflow-x: auto;
				padding-inline: 14px;
			}
			.page-content {
				padding: 16px 14px 72px;
			}
			.view-header {
				align-items: stretch;
				flex-direction: column;
				gap: 12px;
			}
			.form-grid {
				grid-template-columns: minmax(0, 1fr);
			}
			.field.full {
				grid-column: auto;
			}
			.test-result-grid {
				grid-template-columns: minmax(0, 1fr);
			}
			.definition-list {
				grid-template-columns: minmax(105px, 140px) minmax(0, 1fr);
			}
		}
			@media (max-width: 520px) {
			.header-controls,
			.scope-control {
				align-items: stretch;
				flex-direction: column;
			}
				.refresh-button {
					width: 100%;
				}
				.segmented {
					display: grid;
					grid-template-columns: minmax(0, 1fr);
					width: 100%;
				}
				.segmented-option span {
					width: 100%;
					border-radius: 0;
				}
				.segmented-option:first-child span {
					border-radius: 3px 3px 0 0;
				}
				.segmented-option:last-child span {
					border-radius: 0 0 3px 3px;
				}
				.segmented-option + .segmented-option span {
					margin-top: -1px;
					margin-left: 0;
				}
				.definition-list {
				grid-template-columns: minmax(0, 1fr);
			}
			.definition-list dt {
				padding-bottom: 2px;
				border-bottom: 0;
			}
			.definition-list dd {
				padding-top: 2px;
			}
		}
		@media (prefers-reduced-motion: reduce) {
			*,
			*::before,
			*::after {
				transition-duration: 0.01ms !important;
				scroll-behavior: auto !important;
			}
		}
	`;
}
