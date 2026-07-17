type Disposable = { dispose(): void };

export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
}

export enum LanguageModelChatToolMode {
	Auto = 1,
	Required = 2,
}

export class LanguageModelTextPart {
	constructor(readonly value: string) {}
}

export class LanguageModelThinkingPart {
	constructor(readonly value: string | string[]) {}
}

export class LanguageModelPromptTsxPart {
	constructor(readonly value: unknown) {}
}

export class LanguageModelDataPart {
	constructor(
		readonly data: Uint8Array,
		readonly mimeType: string,
	) {}
}

export class CancellationError extends Error {
	constructor() {
		super('Canceled');
		this.name = 'Canceled';
	}
}

export class MarkdownString {
	value: string;
	isTrusted: boolean | { enabledCommands: readonly string[] } | undefined;
	supportHtml = false;
	supportThemeIcons = false;

	constructor(value = '', _supportThemeIcons = false) {
		this.value = value;
	}

	appendMarkdown(value: string): MarkdownString {
		this.value += value;
		return this;
	}
}

export class LanguageModelToolCallPart {
	constructor(
		readonly callId: string,
		readonly name: string,
		readonly input: unknown,
	) {}
}

export class LanguageModelToolResultPart {
	constructor(
		readonly callId: string,
		readonly content: readonly LanguageModelTextPart[],
	) {}
}

export class ThemeIcon {
	constructor(readonly id: string) {}
}

/**
 * Minimal mock of VS Code's MCP server definitions.
 *
 * The real classes support `instanceof` checks against their class identity;
 * the mock preserves that so `resolveServerDefinition` can branch on
 * `definition instanceof McpStdioServerDefinition` / `McpHttpServerDefinition`.
 * `env` and `headers` are mutable plain objects to mirror the real classes'
 * in-place credential injection contract.
 *
 * Constructor signatures match what `buildServerDefinitions` calls:
 *   new McpStdioServerDefinition(label, command, args, env, version)
 *   new McpHttpServerDefinition(label, uri, headers, version)
 */
export class McpStdioServerDefinition {
	constructor(
		readonly label: string,
		readonly command: string,
		readonly args: readonly string[],
		public env: Record<string, string>,
		readonly version?: string,
	) {}
}

export class McpHttpServerDefinition {
	constructor(
		readonly label: string,
		readonly uri: Uri,
		public headers: Record<string, string>,
		readonly version?: string,
	) {}
}

export class EventEmitter<T = void> {
	private readonly listeners = new Set<(value: T) => void>();

	readonly event = (listener: (value: T) => void): Disposable => {
		this.listeners.add(listener);
		return {
			dispose: () => this.listeners.delete(listener),
		};
	};

	fire(value: T): void {
		for (const listener of this.listeners) {
			listener(value);
		}
	}

	dispose(): void {
		this.listeners.clear();
	}
}

const configurationValues = new Map<string, unknown>();
const workspaceConfigurationValues = new Map<string, unknown>();
const workspaceFolderConfigurationValues = new Map<string, Map<string, unknown>>();
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
let openedExternal: Uri | undefined;
let lastStatusBarItem: Record<string, unknown> | undefined;
let quickPickSelectionLabel: string | undefined;
let inputBoxValue: string | undefined;
let activeTextEditorUri: Uri | undefined;
// When set, showWarningMessage returns this value (simulates the user
// clicking a specific button on a modal warning, e.g. the 'Apply' button on
// the Coding Plan preset confirmation). When undefined, returns undefined
// (simulates dismissing the dialog without choosing a button).
let warningMessageButton: string | undefined;
const activeTextEditorEmitter = new EventEmitter<{ document: { uri: Uri } } | undefined>();
const workspaceFoldersEmitter = new EventEmitter<unknown>();
let lastWebviewPanel: MockWebviewPanel | undefined;
const informationMessages: string[] = [];
const warningMessages: string[] = [];
const errorMessages: string[] = [];

export function __setConfigurationValue(key: string, value: unknown): void {
	configurationValues.set(key, value);
}

export function __clearConfigurationValues(): void {
	configurationValues.clear();
	workspaceConfigurationValues.clear();
	workspaceFolderConfigurationValues.clear();
	mockWorkspaceFolders = undefined;
	mockWorkspaceFile = undefined;
	configurationUpdateFailure = undefined;
}

export function __getOpenedExternal(): Uri | undefined {
	return openedExternal;
}

export function __setQuickPickSelectionLabel(label: string | undefined): void {
	quickPickSelectionLabel = label;
}

export function __setInputBoxValue(value: string | undefined): void {
	inputBoxValue = value;
}

export function __setWarningMessageButton(button: string | undefined): void {
	warningMessageButton = button;
}

export function __getWindowMessages(): {
	information: readonly string[];
	warning: readonly string[];
	error: readonly string[];
} {
	return {
		information: informationMessages,
		warning: warningMessages,
		error: errorMessages,
	};
}

export function __resetCommandState(): void {
	registeredCommands.clear();
	openedExternal = undefined;
	lastStatusBarItem = undefined;
	quickPickSelectionLabel = undefined;
	inputBoxValue = undefined;
	warningMessageButton = undefined;
	activeTextEditorUri = undefined;
	lastWebviewPanel = undefined;
	informationMessages.length = 0;
	warningMessages.length = 0;
	errorMessages.length = 0;
}

export function __setActiveTextEditorUri(uri: Uri | undefined): void {
	activeTextEditorUri = uri;
	activeTextEditorEmitter.fire(uri ? { document: { uri } } : undefined);
}

export function __getLastWebviewPanel(): MockWebviewPanel | undefined {
	return lastWebviewPanel;
}

export async function __emitWebviewMessage(message: unknown): Promise<void> {
	await lastWebviewPanel?.webview.receiveMessage(message);
}

export function __getLastStatusBarItem(): Record<string, unknown> | undefined {
	return lastStatusBarItem;
}

export class Uri {
	private constructor(
		readonly fsPath: string,
		private readonly value: string,
	) {}

	static parse(value: string): Uri {
		return new Uri(value, value);
	}

	static file(fsPath: string): Uri {
		return new Uri(fsPath, `file://${fsPath}`);
	}

	static joinPath(base: Uri, ...pathSegments: string[]): Uri {
		return Uri.file([base.fsPath, ...pathSegments].join('/'));
	}

	toString(): string {
		return this.value;
	}
}

export const env = {
	language: 'en',
	async openExternal(uri: Uri): Promise<boolean> {
		openedExternal = uri;
		return true;
	},
};

/**
 * Minimal subset of VS Code's ConfigurationTarget enum, used by migration
 * helpers that walk configuration scopes. Values mirror the real enum so code
 * that compares against `ConfigurationTarget.Global` etc. keeps working.
 */
export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

let mockWorkspaceFolders: Array<{ uri: Uri }> | undefined;
let mockWorkspaceFile: Uri | undefined;
let configurationUpdateFailure:
	| { key: string; target?: ConfigurationTarget; message: string }
	| undefined;

export function __setWorkspaceFolders(uris: readonly Uri[]): void {
	mockWorkspaceFolders = uris.map((uri) => ({ uri }));
	workspaceFoldersEmitter.fire(undefined);
}

export function __setWorkspaceFile(uri: Uri | undefined): void {
	mockWorkspaceFile = uri;
}

export function __setConfigurationValueAtScope(
	key: string,
	value: unknown,
	target: ConfigurationTarget,
	resource?: Uri,
): void {
	const values = getConfigurationValuesForTarget(target, resource);
	if (value === undefined) {
		values.delete(key);
	} else {
		values.set(key, value);
	}
}

export function __getConfigurationValueAtScope(
	key: string,
	target: ConfigurationTarget,
	resource?: Uri,
): unknown {
	return getConfigurationValuesForTarget(target, resource).get(key);
}

export function __setConfigurationUpdateFailure(
	key: string,
	target?: ConfigurationTarget,
	message = 'Configuration update failed',
): void {
	configurationUpdateFailure = { key, target, message };
}

function getConfigurationValuesForTarget(
	target: ConfigurationTarget,
	resource?: Uri,
): Map<string, unknown> {
	if (target === ConfigurationTarget.Global) {
		return configurationValues;
	}
	if (target === ConfigurationTarget.Workspace) {
		return workspaceConfigurationValues;
	}
	if (!resource) {
		throw new Error('WorkspaceFolder configuration requires a resource URI.');
	}
	const resourceKey = resource.toString();
	let values = workspaceFolderConfigurationValues.get(resourceKey);
	if (!values) {
		values = new Map<string, unknown>();
		workspaceFolderConfigurationValues.set(resourceKey, values);
	}
	return values;
}

function getConfigurationMapValue(
	values: Map<string, unknown> | undefined,
	fullKey: string,
	shortKey: string,
): { found: boolean; value?: unknown } {
	if (values?.has(fullKey)) {
		return { found: true, value: values.get(fullKey) };
	}
	if (values?.has(shortKey)) {
		return { found: true, value: values.get(shortKey) };
	}
	return { found: false };
}

export const workspace = {
	get workspaceFolders(): Array<{ uri: Uri }> | undefined {
		return mockWorkspaceFolders;
	},
	get workspaceFile(): Uri | undefined {
		return mockWorkspaceFile;
	},
	getWorkspaceFolder(resource: Uri): { uri: Uri; name: string } | undefined {
		const folder = mockWorkspaceFolders?.find((entry) =>
			resource.toString().startsWith(entry.uri.toString()),
		);
		return folder
			? { ...folder, name: folder.uri.fsPath.split('/').pop() ?? folder.uri.fsPath }
			: undefined;
	},
	onDidChangeConfiguration(): Disposable {
		return { dispose() {} };
	},
	onDidChangeWorkspaceFolders: workspaceFoldersEmitter.event,
	getConfiguration(section?: string, resource?: unknown) {
		const scopedKey = (key: string) => (section ? `${section}.${key}` : key);
		const uri = resource instanceof Uri ? resource : undefined;
		const folderValues = uri ? workspaceFolderConfigurationValues.get(uri.toString()) : undefined;
		return {
			get<T>(key: string, fallback?: T): T | undefined {
				const full = scopedKey(key);
				for (const values of [folderValues, workspaceConfigurationValues, configurationValues]) {
					const stored = getConfigurationMapValue(values, full, key);
					if (stored.found) {
						return stored.value as T;
					}
				}
				return fallback;
			},
			inspect<T>(
				key: string,
			): { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T } | undefined {
				const full = scopedKey(key);
				const globalValue = getConfigurationMapValue(configurationValues, full, key);
				const workspaceValue = getConfigurationMapValue(workspaceConfigurationValues, full, key);
				const workspaceFolderValue = getConfigurationMapValue(folderValues, full, key);
				if (!globalValue.found && !workspaceValue.found && !workspaceFolderValue.found) {
					return undefined;
				}
				return {
					...(globalValue.found ? { globalValue: globalValue.value as T } : {}),
					...(workspaceValue.found ? { workspaceValue: workspaceValue.value as T } : {}),
					...(workspaceFolderValue.found
						? { workspaceFolderValue: workspaceFolderValue.value as T }
						: {}),
				};
			},
			async update(key: string, value: unknown, target?: ConfigurationTarget): Promise<void> {
				const full = scopedKey(key);
				if (
					configurationUpdateFailure?.key === full &&
					(configurationUpdateFailure.target === undefined ||
						configurationUpdateFailure.target === target)
				) {
					throw new Error(configurationUpdateFailure.message);
				}
				const values = getConfigurationValuesForTarget(target ?? ConfigurationTarget.Global, uri);
				if (value === undefined) {
					values.delete(full);
				} else {
					values.set(full, value);
				}
			},
		};
	},
};

class MockWebview {
	html = '';
	readonly cspSource = 'vscode-webview://model-manager';
	readonly postedMessages: unknown[] = [];
	private receiver: ((message: unknown) => unknown) | undefined;

	onDidReceiveMessage(listener: (message: unknown) => unknown): Disposable {
		this.receiver = listener;
		return { dispose: () => (this.receiver = undefined) };
	}

	async postMessage(message: unknown): Promise<boolean> {
		this.postedMessages.push(message);
		return true;
	}

	async receiveMessage(message: unknown): Promise<void> {
		await this.receiver?.(message);
	}
}

export class MockWebviewPanel {
	readonly webview = new MockWebview();
	visible = true;
	private disposeListener: (() => void) | undefined;

	onDidDispose(listener: () => void): Disposable {
		this.disposeListener = listener;
		return { dispose: () => (this.disposeListener = undefined) };
	}

	reveal(): void {
		this.visible = true;
	}

	dispose(): void {
		this.visible = false;
		this.disposeListener?.();
	}
}

export const commands = {
	registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable {
		registeredCommands.set(command, callback);
		return {
			dispose() {
				registeredCommands.delete(command);
			},
		};
	},
	async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
		return registeredCommands.get(command)?.(...args);
	},
};

export const window = {
	get activeTextEditor(): { document: { uri: Uri } } | undefined {
		return activeTextEditorUri ? { document: { uri: activeTextEditorUri } } : undefined;
	},
	onDidChangeActiveTextEditor: activeTextEditorEmitter.event,
	async showQuickPick<T extends { label: string }>(items: readonly T[]): Promise<T | undefined> {
		return items.find((item) => item.label === quickPickSelectionLabel);
	},
	async showInputBox(): Promise<string | undefined> {
		return inputBoxValue;
	},
	async showInformationMessage(message: string): Promise<string | undefined> {
		informationMessages.push(message);
		return undefined;
	},
	async showWarningMessage(message: string): Promise<string | undefined> {
		warningMessages.push(message);
		return warningMessageButton;
	},
	async showErrorMessage(message: string): Promise<string | undefined> {
		errorMessages.push(message);
		return undefined;
	},
	createOutputChannel() {
		return {
			info() {},
			warn() {},
			error() {},
			debug() {},
			show() {},
			dispose() {},
		};
	},
	createStatusBarItem() {
		lastStatusBarItem = {
			name: '',
			text: '',
			tooltip: '',
			command: '',
			visible: false,
			show() {
				this.visible = true;
			},
			hide() {
				this.visible = false;
			},
			dispose() {
				this.visible = false;
			},
		};
		return lastStatusBarItem;
	},
	createWebviewPanel(): MockWebviewPanel {
		lastWebviewPanel = new MockWebviewPanel();
		return lastWebviewPanel;
	},
};

export const lm = {
	async selectChatModels(): Promise<unknown[]> {
		return [];
	},
};

export const ViewColumn = {
	Active: 1,
};

export const StatusBarAlignment = {
	Right: 2,
};

const vscode = {
	env,
	workspace,
	window,
	commands,
	lm,
	ViewColumn,
	StatusBarAlignment,
	ConfigurationTarget,
	Uri,
	EventEmitter,
	LanguageModelChatMessageRole,
	LanguageModelTextPart,
	LanguageModelThinkingPart,
	LanguageModelPromptTsxPart,
	LanguageModelDataPart,
	CancellationError,
	MarkdownString,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	ThemeIcon,
	McpStdioServerDefinition,
	McpHttpServerDefinition,
};

export default vscode;
