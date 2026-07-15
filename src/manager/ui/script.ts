export function getModelManagerScript(initialState: string, initialStrings: string): string {
	return `
		(() => {
			const vscode = acquireVsCodeApi();
			let state = ${initialState};
			const strings = ${initialStrings};
				let selectedModelId = state.selectedModelId;
				let creatingModel = false;
				let nextVisionTestId = 1;
				let pendingVisionTestId;
				let inspectorOpener;

				const appRoot = document.getElementById('appRoot');
				const viewRoot = document.getElementById('viewRoot');
			const scopeControl = document.getElementById('scopeControl');
			const scopeSelect = document.getElementById('scopeSelect');
			const refreshButton = document.getElementById('refreshButton');
			const inspector = document.getElementById('inspector');
			const inspectorBackdrop = document.getElementById('inspectorBackdrop');
			const inspectorHeading = document.getElementById('inspectorHeading');
			const inspectorBody = document.getElementById('inspectorBody');
			const inspectorClose = document.getElementById('inspectorClose');
				const globalStatus = document.getElementById('globalStatus');
				const busyMask = document.getElementById('busyMask');
				const viewTabs = Array.from(document.querySelectorAll('.view-tab'));

			function post(type, value) {
				vscode.postMessage(value === undefined ? { type } : { type, value });
			}

			function element(tag, className, text) {
				const node = document.createElement(tag);
				if (className) {
					node.className = className;
				}
				if (text !== undefined) {
					node.textContent = text;
				}
				return node;
			}

			function button(label, className, onClick) {
				const node = element('button', className || '', label);
				node.type = 'button';
				node.disabled = Boolean(state.busy);
				node.addEventListener('click', onClick);
				return node;
			}

			function format(value) {
				const args = Array.prototype.slice.call(arguments, 1);
				return value.replace(/\\{(\\d+)\\}/g, (match, index) => {
					const replacement = args[Number(index)];
					return replacement === undefined ? match : String(replacement);
				});
			}

			function showStatus(status) {
				globalStatus.textContent = status && status.label ? status.label : '';
				globalStatus.className = 'global-status';
				if (status && status.label) {
					globalStatus.classList.add('visible', status.tone || 'info');
				}
			}

			function announceError(message) {
				showStatus({ label: message, tone: 'error' });
			}

			function setBusy(isBusy) {
				busyMask.hidden = !isBusy;
				refreshButton.disabled = isBusy;
				scopeSelect.disabled = isBusy;
				viewRoot.setAttribute('aria-busy', String(isBusy));
			}

			function renderChrome() {
				scopeControl.hidden = state.activeView === 'vision';
					let activeTab;
					viewTabs.forEach((tab) => {
						const active = tab.dataset.view === state.activeView;
						tab.setAttribute('aria-selected', String(active));
						tab.tabIndex = active ? 0 : -1;
						if (active) {
							activeTab = tab;
						}
					});
					if (activeTab) {
						viewRoot.setAttribute('aria-labelledby', activeTab.id);
					}
				scopeSelect.replaceChildren();
				state.scopes.forEach((scope) => {
					const option = element('option', '', scope.label);
					option.value = scope.id;
					option.selected = scope.id === state.selectedScope;
					if (scope.detail) {
						option.title = scope.detail;
					}
					scopeSelect.append(option);
				});
				setBusy(Boolean(state.busy));
				showStatus(state.status);
			}

			function render() {
				renderChrome();
				viewRoot.replaceChildren();
				if (state.activeView === 'connections') {
					renderConnectionsView();
				} else if (state.activeView === 'vision') {
					renderVisionView();
				} else {
					renderModelsView();
				}
				renderInspector();
			}

			function createViewHeader(title, description, action) {
				const header = element('header', 'view-header');
				const copy = element('div');
				copy.append(element('h2', 'view-heading', title));
				copy.append(element('p', 'view-description', description));
				header.append(copy);
				if (action) {
					header.append(action);
				}
				return header;
			}

			function appendCell(row, content, className) {
				const cell = element('td', className || '');
				if (typeof content === 'string') {
					cell.textContent = content;
				} else if (content) {
					cell.append(content);
				}
				row.append(cell);
				return cell;
			}

			function statusNode(status) {
				const wrapper = element('span', 'status-inline');
				const dot = element('span', 'status-dot ' + (status.tone || 'info'));
				dot.setAttribute('aria-hidden', 'true');
				wrapper.append(dot, element('span', '', status.label));
				if (status.detail) {
					wrapper.title = status.detail;
				}
				return wrapper;
			}

				function renderModelsView() {
					const add = button(strings.addModel, 'secondary', () => {
						inspectorOpener = add;
						creatingModel = true;
					selectedModelId = undefined;
						renderModelsSelection();
					});
					add.id = 'addModelButton';
					viewRoot.append(createViewHeader(strings.modelsHeading, strings.modelsDescription, add));

				if (!state.models.length) {
					viewRoot.append(element('div', 'empty-state', strings.noModels));
					return;
				}

				const scroll = element('div', 'table-scroll');
				const table = element('table', 'models-table');
					const head = element('thead');
					const headRow = element('tr');
					[strings.model, strings.apiModelId, strings.connection, strings.imageMode, strings.status].forEach(
						(label) => {
							const header = element('th', '', label);
							header.scope = 'col';
							headRow.append(header);
						},
					);
				head.append(headRow);
				const body = element('tbody');
				state.models.forEach((model) => {
					const row = element('tr');
					row.tabIndex = 0;
						row.dataset.modelId = model.id;
						row.setAttribute('aria-selected', String(model.id === selectedModelId && !creatingModel));
						row.setAttribute('aria-label', model.name + ', ' + model.apiModelId);
						row.setAttribute('aria-controls', 'inspector');
						row.setAttribute('aria-haspopup', 'dialog');
					const name = element('div');
					name.append(element('div', 'primary-cell', model.name));
					name.append(element('div', 'secondary-line monospace', model.id));
					appendCell(row, name);
					appendCell(row, model.apiModelId, 'monospace');
					appendCell(row, model.connectionLabel);
					appendCell(row, model.visionModeLabel);
					appendCell(row, statusNode(model.status));
						const activate = () => {
							inspectorOpener = row;
							creatingModel = false;
						selectedModelId = model.id;
						renderModelsSelection();
					};
					row.addEventListener('click', activate);
					row.addEventListener('keydown', (event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							activate();
						}
					});
					body.append(row);
				});
				table.append(head, body);
				scroll.append(table);
				viewRoot.append(scroll);
			}

			function renderModelsSelection() {
				document.querySelectorAll('.models-table tbody tr').forEach((row) => {
					row.setAttribute(
						'aria-selected',
						String(!creatingModel && row.dataset.modelId === selectedModelId),
					);
				});
				renderInspector();
			}

				function getFocusableElements(container) {
					return Array.from(
						container.querySelectorAll(
							'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
						),
					).filter(
						(node) =>
							!node.hidden &&
							node.getAttribute('aria-hidden') !== 'true' &&
							!node.closest('[hidden], [aria-hidden="true"], [inert]'),
					);
				}

				function focusInspector() {
					const target = getFocusableElements(inspectorBody)[0] || inspectorClose;
					target.focus();
				}

				function openInspector() {
					appRoot.inert = true;
					inspector.inert = false;
					inspector.classList.add('open');
					inspectorBackdrop.classList.add('open');
					inspector.setAttribute('aria-hidden', 'false');
					queueMicrotask(() => {
						if (inspector.classList.contains('open')) {
							focusInspector();
						}
					});
				}

				function closeInspector() {
					const wasOpen = inspector.classList.contains('open');
					const opener = inspectorOpener;
					const openerId = opener && opener.id;
					const openerModelId = opener && opener.dataset ? opener.dataset.modelId : undefined;
					selectedModelId = undefined;
					creatingModel = false;
					inspector.classList.remove('open');
					inspectorBackdrop.classList.remove('open');
					inspector.setAttribute('aria-hidden', 'true');
					inspector.inert = true;
					appRoot.inert = false;
					document.querySelectorAll('.models-table tbody tr').forEach((row) => {
						row.setAttribute('aria-selected', 'false');
					});
					if (wasOpen) {
						inspectorOpener = undefined;
						queueMicrotask(() => {
							const replacement = openerModelId
								? Array.from(document.querySelectorAll('.models-table tbody tr')).find(
										(row) => row.dataset.modelId === openerModelId,
									)
								: openerId
									? document.getElementById(openerId)
									: undefined;
							const target =
								opener && opener.isConnected
									? opener
									: replacement || document.getElementById('addModelButton') || viewRoot;
							target.focus();
						});
					}
				}

			function createField(label, control, hint) {
				const field = element('div', 'field');
				const labelNode = element('label', '', label);
					if (control.id) {
						labelNode.htmlFor = control.id;
					}
					if (control.id && control.getAttribute('role') === 'radiogroup') {
						labelNode.id = control.id + 'Label';
						labelNode.removeAttribute('for');
						control.setAttribute('aria-labelledby', labelNode.id);
					}
				field.append(labelNode, control);
				if (hint) {
					field.append(element('div', 'hint', hint));
				}
				return field;
			}

			function createTextInput(id, value, type) {
				const input = element('input');
				input.id = id;
				input.type = type || 'text';
				input.value = value === undefined || value === null ? '' : String(value);
				input.disabled = Boolean(state.busy);
				return input;
			}

			function createSelect(id, value, options) {
				const select = element('select');
				select.id = id;
				select.disabled = Boolean(state.busy);
				options.forEach((item) => {
					const option = element('option', '', item.label);
					option.value = item.value;
					option.selected = item.value === value;
					option.disabled = Boolean(item.disabled);
					option.title = item.disabledReason || item.description || '';
					select.append(option);
				});
				return select;
			}

			function createCheckbox(id, label, checked) {
				const wrapper = element('label', 'checkbox-field');
				const input = element('input');
				input.id = id;
				input.type = 'checkbox';
				input.checked = Boolean(checked);
				input.disabled = Boolean(state.busy);
				wrapper.append(input, element('span', '', label));
				return { wrapper, input };
			}

				function createVisionModeControl(value) {
					const group = element('div', 'segmented');
					group.id = 'modelVisionMode';
					group.setAttribute('role', 'radiogroup');
				[
					{ value: 'proxy', label: strings.visionProxy },
					{ value: 'native', label: strings.nativeImages },
				].forEach((item) => {
					const label = element('label', 'segmented-option');
					const input = element('input');
					input.type = 'radio';
					input.name = 'modelVisionMode';
					input.value = item.value;
					input.checked = item.value === value;
					input.disabled = Boolean(state.busy);
					label.append(input, element('span', '', item.label));
					group.append(label);
				});
				return group;
			}

			function optionalPositiveInteger(input) {
				const value = input.value.trim();
				if (!value) {
					return undefined;
				}
				const number = Number(value);
				if (!Number.isSafeInteger(number) || number <= 0) {
					throw new Error(strings.invalidNumber);
				}
				return number;
			}

			function renderInspector() {
				const model = state.models.find((item) => item.id === selectedModelId);
				const template = state.newModelTemplate;
				if (!model && (!creatingModel || !template)) {
					closeInspector();
					return;
				}

				const draft = model ? model.draft : template.draft;
				const routes = model ? model.allowedRoutes : template.allowedRoutes;
				inspectorHeading.textContent = model ? model.name : strings.customModelTitle;
				inspectorBody.replaceChildren();

				let customIdInput;
				if (!model) {
					customIdInput = createTextInput('inspectorModelId', '');
					inspectorBody.append(createField(strings.modelId, customIdInput, strings.customModelIdHint));
				}

				const nameInput = createTextInput('inspectorModelName', draft.name);
				nameInput.disabled = Boolean(state.busy) || Boolean(model && !model.isCustom);
				const apiIdInput = createTextInput('inspectorApiModelId', draft.apiModelId);
				const routeSelect = createSelect('inspectorRoute', draft.endpointRoute, routes);
				const visionMode = createVisionModeControl(draft.visionMode);
				const routeHint = element('div', 'hint');
				const updateRouteHint = () => {
					const route = routes.find((item) => item.value === routeSelect.value);
					routeHint.textContent = route ? route.description || route.disabledReason || '' : '';
					routeHint.hidden = !routeHint.textContent;
				};
				routeSelect.addEventListener('change', updateRouteHint);
				updateRouteHint();
				const routeField = createField(strings.endpointRoute, routeSelect);
				routeField.append(routeHint);
				const visionHint = element('div', 'hint');
				const updateVisionHint = () => {
					const selected = visionMode.querySelector('input[name="modelVisionMode"]:checked');
					visionHint.textContent =
						selected && selected.value === 'native'
							? strings.nativeBudgetHint
							: strings.visionProxyHint;
				};
				visionMode.querySelectorAll('input[name="modelVisionMode"]').forEach((input) => {
					input.addEventListener('change', updateVisionHint);
				});
				updateVisionHint();
				const visionField = createField(strings.visionMode, visionMode);
				visionField.append(visionHint);
				inspectorBody.append(
					createField(strings.modelName, nameInput),
					createField(strings.apiModelId, apiIdInput),
					routeField,
					visionField,
				);

				let contextInput;
				let outputInput;
				let toolCallingInput;
				let thinkingInput;
				if (!model || model.isCustom) {
					contextInput = createTextInput('inspectorContextWindow', draft.contextWindowTokens, 'number');
					contextInput.min = '1';
					outputInput = createTextInput('inspectorMaxOutput', draft.maxOutputTokens, 'number');
					outputInput.min = '1';
					toolCallingInput = createCheckbox(
						'inspectorToolCalling',
						strings.toolCalling,
						draft.toolCalling,
					);
					thinkingInput = createCheckbox('inspectorThinking', strings.thinking, draft.thinking);
					inspectorBody.append(
						createField(strings.contextWindow, contextInput),
						createField(strings.maxOutput, outputInput),
						toolCallingInput.wrapper,
						thinkingInput.wrapper,
					);
				}

				if (model && model.valueSourceLabel) {
					const source = element('div', 'field');
					source.append(
						element('div', 'field-label', strings.valueSource),
						element('div', 'hint', model.valueSourceLabel),
					);
					inspectorBody.append(source);
				}

				const actions = element('div', 'inspector-actions');
				actions.append(
					button(strings.saveChanges, '', () => {
						try {
							const name = nameInput.value.trim();
							const apiModelId = apiIdInput.value;
							if (!name || !apiModelId.trim()) {
								throw new Error(strings.fieldRequired);
							}
							if (apiModelId !== apiModelId.trim()) {
								throw new Error(strings.nonCanonicalModelId);
							}
							const selectedVision = inspectorBody.querySelector(
								'input[name="modelVisionMode"]:checked',
							);
							const nextDraft = {
								name,
								apiModelId,
								endpointRoute: routeSelect.value,
								visionMode: selectedVision ? selectedVision.value : 'proxy',
							};
							if (contextInput) {
								nextDraft.contextWindowTokens = optionalPositiveInteger(contextInput);
								nextDraft.maxOutputTokens = optionalPositiveInteger(outputInput);
								nextDraft.toolCalling = toolCallingInput.input.checked;
								nextDraft.thinking = thinkingInput.input.checked;
							}
							if (model) {
								showStatus({ label: strings.working, tone: 'info' });
								post('saveModel', {
									revision: state.revision,
									scope: state.selectedScope,
									modelId: model.id,
									draft: nextDraft,
								});
							} else {
								const id = customIdInput.value;
								if (!id.trim()) {
									throw new Error(strings.fieldRequired);
								}
								if (id !== id.trim()) {
									throw new Error(strings.nonCanonicalModelId);
								}
								showStatus({ label: strings.working, tone: 'info' });
								post('createModel', {
									revision: state.revision,
									scope: state.selectedScope,
									id,
									draft: nextDraft,
								});
							}
						} catch (error) {
							announceError(error instanceof Error ? error.message : String(error));
						}
					}),
				);
				if (model && model.canReset) {
					actions.append(
						button(strings.resetOverride, 'secondary', () => {
							showStatus({ label: strings.working, tone: 'info' });
							post('resetModel', {
								revision: state.revision,
								scope: state.selectedScope,
								modelId: model.id,
							});
						}),
					);
				}
				if (model && model.isCustom) {
					actions.append(
						button(strings.deleteModel, 'danger', () => {
							post('deleteModel', {
								revision: state.revision,
								scope: state.selectedScope,
								modelId: model.id,
							});
						}),
					);
				}
				inspectorBody.append(actions);
					openInspector();
			}

			function renderConnectionsView() {
				viewRoot.append(
					createViewHeader(strings.connectionsHeading, strings.connectionsDescription),
				);
				const editor = element('section', 'connection-editor');
				const form = element('div', 'form-grid');
				const endpoint = createSelect(
					'connectionEndpoint',
					state.defaultConnection.endpoint,
					state.defaultConnection.allowedEndpoints,
				);
				const customToggle = createCheckbox(
					'useCustomBaseUrl',
					strings.customBaseUrl,
					state.defaultConnection.usesCustomBaseUrl,
				);
				const customUrl = createTextInput(
					'customBaseUrl',
					state.defaultConnection.customBaseUrl || '',
					'url',
				);
				customUrl.disabled = Boolean(state.busy) || !customToggle.input.checked;
				customToggle.input.addEventListener('change', () => {
					customUrl.disabled = Boolean(state.busy) || !customToggle.input.checked;
					if (!customUrl.disabled) {
						customUrl.focus();
					}
				});
				form.append(
					createField(strings.defaultEndpoint, endpoint),
					customToggle.wrapper,
					createField(strings.customBaseUrl, customUrl, strings.customBaseUrlHint),
				);
				editor.append(form);

				const definitions = element('dl', 'definition-list');
				const connectionDetails = [
					[strings.resolvedUrl, state.defaultConnection.resolvedBaseUrl, 'monospace'],
					[strings.protocol, state.defaultConnection.protocolLabel],
					[strings.credentialChannel, state.defaultConnection.credentialLabel],
					[
						strings.apiKey,
						state.defaultConnection.hasApiKey ? strings.keyConfigured : strings.keyMissing,
					],
				];
				if (state.defaultConnection.valueSourceLabel) {
					connectionDetails.push([
						strings.valueSource,
						state.defaultConnection.valueSourceLabel,
					]);
				}
				connectionDetails.forEach((entry) => {
					definitions.append(element('dt', '', entry[0]), element('dd', entry[2] || '', entry[1]));
				});
				editor.append(definitions);
				const saveActions = element('div', 'actions');
				saveActions.append(
					button(strings.saveConnection, '', () => {
						const customBaseUrl = customUrl.value.trim();
						if (customToggle.input.checked && !customBaseUrl) {
							announceError(strings.fieldRequired);
							return;
						}
						showStatus({ label: strings.working, tone: 'info' });
						post('saveConnection', {
							revision: state.revision,
							scope: state.selectedScope,
							endpoint: endpoint.value,
							usesCustomBaseUrl: customToggle.input.checked,
							customBaseUrl: customToggle.input.checked ? customBaseUrl : undefined,
						});
					}),
				);
				editor.append(saveActions);
				viewRoot.append(editor);

				const credentials = element('section', 'section-block');
				credentials.append(
					element('h3', 'section-heading', strings.credentialsHeading),
					element('p', 'section-description', strings.credentialsDescription),
				);
				const scroll = element('div', 'table-scroll');
				const table = element('table', 'credentials-table');
					const head = element('thead');
					const headRow = element('tr');
					[strings.credentialChannel, strings.status, strings.modelsUsing, ''].forEach((label) => {
						const header = element('th', '', label);
						header.scope = 'col';
						headRow.append(header);
					});
				head.append(headRow);
				const body = element('tbody');
				state.credentials.forEach((credential) => {
					const row = element('tr');
					const name = element('div');
					name.append(element('div', 'primary-cell', credential.label));
					if (credential.description || credential.protocolsLabel) {
						name.append(
							element(
								'div',
								'secondary-line',
								credential.description || credential.protocolsLabel,
							),
						);
					}
					appendCell(row, name);
					appendCell(
						row,
						statusNode({
							label: credential.hasApiKey ? strings.keyConfigured : strings.keyMissing,
							tone: credential.hasApiKey ? 'success' : 'warning',
						}),
					);
					appendCell(row, String(credential.modelCount));
					const actions = element('div', 'row-actions');
					actions.append(
						button(
							credential.hasApiKey ? strings.replaceKey : strings.setKey,
							'secondary',
							() => post('setCredentialKey', { channel: credential.channel }),
						),
						button(strings.getKey, 'ghost', () =>
							post('openCredentialKeyUrl', { channel: credential.channel }),
						),
					);
					if (credential.hasApiKey) {
						actions.append(
							button(strings.clearKey, 'danger', () =>
								post('clearCredentialKey', { channel: credential.channel }),
							),
						);
					}
					appendCell(row, actions);
					body.append(row);
				});
				table.append(head, body);
				scroll.append(table);
				credentials.append(scroll);
				viewRoot.append(credentials);
			}

				function createVisionSourceControl() {
					const group = element('div', 'segmented');
					group.id = 'visionSource';
					group.setAttribute('role', 'radiogroup');
					group.setAttribute('aria-labelledby', 'visionSourceLabel');
				[
					{ value: 'auto', label: strings.visionAuto },
					{ value: 'vscode-lm', label: strings.visionVscodeLm },
					{ value: 'api-endpoint', label: strings.visionApiEndpoint },
				].forEach((item) => {
					const label = element('label', 'segmented-option');
					const input = element('input');
					input.type = 'radio';
					input.name = 'visionSource';
					input.value = item.value;
					input.checked = item.value === state.vision.source;
					input.disabled = Boolean(state.busy);
					label.append(input, element('span', '', item.label));
					group.append(label);
				});
				return group;
			}

			function createEndpointTypeSelect(value) {
				return createSelect('visionEndpointType', value || '', [
					{ value: '', label: strings.selectEndpointType },
					{ value: 'openai-chat-completions', label: strings.endpointOpenAIChat },
					{ value: 'openai-responses', label: strings.endpointOpenAIResponses },
					{ value: 'anthropic-messages', label: strings.endpointAnthropic },
				]);
			}

			function parseJsonObject(value, label) {
				const trimmed = value.trim();
				if (!trimmed) {
					return undefined;
				}
				let parsed;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					throw new Error(format(strings.invalidJson, label));
				}
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					throw new Error(format(strings.invalidJson, label));
				}
				return trimmed;
			}

			function getVisionFormValue() {
				const sourceInput = viewRoot.querySelector('input[name="visionSource"]:checked');
				const source = sourceInput ? sourceInput.value : 'auto';
				const value = {
					source,
					lmModelKey: undefined,
					endpoint: undefined,
				};
				if (source === 'vscode-lm') {
					const model = document.getElementById('visionLmModel');
					value.lmModelKey = model.value || undefined;
					return value;
				}
				if (source !== 'api-endpoint') {
					return value;
				}

				const url = document.getElementById('visionEndpointUrl').value.trim();
				const endpointType = document.getElementById('visionEndpointType').value || undefined;
				const modelId = document.getElementById('visionModelId').value.trim();
				const apiKey = document.getElementById('visionApiKey').value.trim() || undefined;
				const headers = document.getElementById('visionHeaders').value;
				const extraBody = document.getElementById('visionExtraBody').value;
				if (!url || !modelId) {
					throw new Error(strings.fieldRequired);
				}
				value.endpoint = {
					url,
					endpointType,
					modelId,
					replacementHeadersJson: parseJsonObject(headers, strings.customHeaders),
					extraBodyJson: parseJsonObject(extraBody, strings.extraBody) || '{}',
					apiKey,
				};
				return value;
			}

			function renderVisionView() {
				viewRoot.append(createViewHeader(strings.visionHeading, strings.visionDescription));
				const editor = element('section', 'vision-editor');
				const summary = element('div', 'summary-line');
				summary.append(element('span', 'status-dot success'));
				const summaryContent = element('div', 'summary-content');
				summaryContent.append(
					element('div', 'summary-title', state.vision.summaryTitle),
					element('div', 'summary-detail', state.vision.summaryDetail),
				);
				summary.append(summaryContent);
				editor.append(summary);

					const sourceField = element('div', 'field');
					const sourceLabel = element('div', 'field-label', strings.visionSource);
					sourceLabel.id = 'visionSourceLabel';
					sourceField.append(
						sourceLabel,
						createVisionSourceControl(),
				);
				editor.append(sourceField);

				const lmSection = element('div', 'form-grid one-column');
				lmSection.id = 'visionLmSection';
				const lmOptions = state.vision.lmModels.map((model) => ({
					value: model.key,
					label: model.label,
					description: model.description || model.costDescription,
				}));
				const lmSelect = createSelect(
					'visionLmModel',
					state.vision.selectedLmModelKey || '',
					lmOptions,
				);
				const selectedLm = state.vision.lmModels.find(
					(model) => model.key === state.vision.selectedLmModelKey,
				);
				lmSection.append(
					createField(
						strings.visionModel,
						lmSelect,
						selectedLm && (selectedLm.costDescription || selectedLm.description),
					),
				);
				editor.append(lmSection);

				const apiSection = element('div', 'form-grid');
				apiSection.id = 'visionApiSection';
				const endpointUrl = createTextInput(
					'visionEndpointUrl',
					state.vision.endpoint.url,
					'url',
				);
				const endpointType = createEndpointTypeSelect(state.vision.endpoint.endpointType);
				const modelId = createTextInput('visionModelId', state.vision.endpoint.modelId);
				const apiKey = createTextInput('visionApiKey', '', 'password');
				apiKey.autocomplete = 'off';
				apiKey.placeholder = state.vision.endpoint.hasApiKey ? strings.keyConfigured : '';
				const headers = element('textarea');
				headers.id = 'visionHeaders';
				headers.spellcheck = false;
				headers.disabled = Boolean(state.busy);
				if (state.vision.endpoint.hasCustomHeaders) {
					headers.placeholder = '{}';
				}
				const headerHint = state.vision.endpoint.hasCustomHeaders
					? format(
							strings.customHeadersConfiguredHint,
							state.vision.endpoint.customHeaderNames.join(', '),
						)
					: strings.customHeadersEmptyHint;
				const extraBody = element('textarea');
				extraBody.id = 'visionExtraBody';
				extraBody.spellcheck = false;
				extraBody.disabled = Boolean(state.busy);
				extraBody.value = state.vision.endpoint.extraBodyJson || '{}';
				apiSection.append(
					createField(strings.endpointUrl, endpointUrl),
					createField(strings.endpointType, endpointType),
					createField(strings.modelId, modelId),
					createField(
						strings.apiKey,
						apiKey,
						state.vision.endpoint.hasApiKey
							? strings.apiKeyConfiguredHint
							: strings.apiKeyMissingHint,
					),
					createField(strings.customHeaders, headers, headerHint),
					createField(strings.extraBody, extraBody),
				);
				editor.append(apiSection);

				const updateSections = () => {
					const checked = editor.querySelector('input[name="visionSource"]:checked');
					const source = checked ? checked.value : 'auto';
					lmSection.hidden = source !== 'vscode-lm';
					apiSection.hidden = source !== 'api-endpoint';
				};
				editor.querySelectorAll('input[name="visionSource"]').forEach((input) => {
					input.addEventListener('change', updateSections);
				});
				updateSections();

					const actions = element('div', 'actions');
					const saveVisionButton = button(strings.saveVision, '', () => {
							try {
								const value = getVisionFormValue();
							showStatus({ label: strings.working, tone: 'info' });
							post('saveVision', { revision: state.revision, ...value });
							} catch (error) {
								announceError(error instanceof Error ? error.message : String(error));
							}
						});
					const testVisionButton = button(strings.testConnection, 'secondary', () => {
							try {
								const value = getVisionFormValue();
								const testId = nextVisionTestId++;
								pendingVisionTestId = testId;
								testVisionButton.disabled = true;
								state.vision.test = { testId, status: 'running', message: strings.working };
								viewRoot.querySelector('.test-result')?.remove();
								renderVisionTestResult();
								post('testVision', { testId, ...value });
								showStatus({ label: strings.working, tone: 'info' });
							} catch (error) {
								announceError(error instanceof Error ? error.message : String(error));
							}
						});
					testVisionButton.id = 'visionTestButton';
					testVisionButton.disabled = Boolean(state.busy) || pendingVisionTestId !== undefined;
					actions.append(saveVisionButton, testVisionButton);
				if (state.vision.endpoint.hasApiKey) {
					actions.append(
						button(strings.clearVisionKey, 'danger', () => post('clearVisionApiKey')),
					);
				}
				editor.append(actions);
				viewRoot.append(editor);
				renderVisionTestResult();
			}

			function renderVisionTestResult() {
				const test = state.vision.test;
				if (!test || test.status === 'idle') {
					return;
				}
				const section = element('section', 'test-result');
				section.append(statusNode({
					label: test.message || strings.working,
					tone: test.status === 'success' ? 'success' : test.status === 'error' ? 'error' : 'info',
				}));
				if (test.imageDataUrl || test.response) {
					const grid = element('div', 'test-result-grid');
					if (test.imageDataUrl) {
						const pane = element('div', 'test-result-pane');
						pane.append(element('div', 'test-result-label', strings.testImage));
						const image = element('img', 'test-image');
						image.src = test.imageDataUrl;
						image.alt = strings.testImage;
						pane.append(image);
						grid.append(pane);
					}
					if (test.response) {
						const pane = element('div', 'test-result-pane');
						pane.append(element('div', 'test-result-label', strings.testResponse));
						pane.append(element('pre', 'test-response', test.response));
						grid.append(pane);
					}
					section.append(grid);
				}
				viewRoot.append(section);
			}

				function activateViewTab(tab) {
						const view = tab.dataset.view;
						if (view === state.activeView) {
							return;
						}
						if (state.activeView === 'vision') {
							pendingVisionTestId = undefined;
						}
						state.activeView = view;
						closeInspector();
						render();
						post('setView', { view });
				}

				viewTabs.forEach((tab, index) => {
					tab.addEventListener('click', () => activateViewTab(tab));
					tab.addEventListener('keydown', (event) => {
						let targetIndex;
						if (event.key === 'ArrowRight') {
							targetIndex = (index + 1) % viewTabs.length;
						} else if (event.key === 'ArrowLeft') {
							targetIndex = (index - 1 + viewTabs.length) % viewTabs.length;
						} else if (event.key === 'Home') {
							targetIndex = 0;
						} else if (event.key === 'End') {
							targetIndex = viewTabs.length - 1;
						} else {
							return;
						}
						event.preventDefault();
						const target = viewTabs[targetIndex];
						target.focus();
						activateViewTab(target);
					});
				});

			scopeSelect.addEventListener('change', () => {
				state.selectedScope = scopeSelect.value;
				closeInspector();
				post('setScope', { scope: scopeSelect.value });
			});
			refreshButton.addEventListener('click', () => post('refresh'));
			inspectorClose.addEventListener('click', closeInspector);
			inspectorBackdrop.addEventListener('click', closeInspector);
				document.addEventListener('keydown', (event) => {
					if (!inspector.classList.contains('open')) {
						return;
					}
					if (event.key === 'Escape') {
						event.preventDefault();
						closeInspector();
						return;
					}
					if (event.key === 'Tab') {
						const focusable = getFocusableElements(inspector);
						const first = focusable[0] || inspectorClose;
						const last = focusable[focusable.length - 1] || inspectorClose;
						const active = document.activeElement;
						if (event.shiftKey && (active === first || !inspector.contains(active))) {
							event.preventDefault();
							last.focus();
						} else if (!event.shiftKey && (active === last || !inspector.contains(active))) {
							event.preventDefault();
							first.focus();
						}
					}
				});

			window.addEventListener('message', (event) => {
				const message = event.data;
				if (!message || typeof message !== 'object') {
					return;
				}
					if (message.type === 'state' && message.value) {
						state = message.value;
						if (state.activeView !== 'vision') {
							pendingVisionTestId = undefined;
						}
					if (selectedModelId && !state.models.some((model) => model.id === selectedModelId)) {
						selectedModelId = undefined;
					}
					render();
					} else if (message.type === 'status' && message.value) {
						showStatus(message.value);
					} else if (message.type === 'visionTestResult' && message.value) {
						if (
							pendingVisionTestId === undefined ||
							message.value.testId !== pendingVisionTestId
						) {
							return;
						}
						pendingVisionTestId = undefined;
						if (state.activeView !== 'vision') {
							return;
						}
						state.vision.test = message.value;
						viewRoot.querySelector('.test-result')?.remove();
						renderVisionTestResult();
						const testButton = document.getElementById('visionTestButton');
						if (testButton) {
							testButton.disabled = Boolean(state.busy);
						}
					}
			});

			render();
			post('ready');
		})();
	`;
}
