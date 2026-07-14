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

export class LanguageModelDataPart {
	constructor(
		readonly data: Uint8Array,
		readonly mimeType: string,
	) {}
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
const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
let openedExternal: Uri | undefined;
let lastStatusBarItem: Record<string, unknown> | undefined;

export function __setConfigurationValue(key: string, value: unknown): void {
	configurationValues.set(key, value);
}

export function __clearConfigurationValues(): void {
	configurationValues.clear();
}

export function __getOpenedExternal(): Uri | undefined {
	return openedExternal;
}

export function __resetCommandState(): void {
	registeredCommands.clear();
	openedExternal = undefined;
	lastStatusBarItem = undefined;
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

export const workspace = {
	getConfiguration(section?: string, _resource?: unknown) {
		const scopedKey = (key: string) => (section ? `${section}.${key}` : key);
		return {
			get<T>(key: string, fallback?: T): T | undefined {
				const full = scopedKey(key);
				if (configurationValues.has(full)) {
					return configurationValues.get(full) as T;
				}
				if (configurationValues.has(key)) {
					return configurationValues.get(key) as T;
				}
				return fallback;
			},
			inspect<T>(key: string): { globalValue?: T } | undefined {
				const full = scopedKey(key);
				// The mock stores every value as a "global" value, which is the
				// only scope the migration helpers read at Global target.
				if (configurationValues.has(full)) {
					return { globalValue: configurationValues.get(full) as T };
				}
				return undefined;
			},
			async update(key: string, value: unknown, _target?: unknown): Promise<void> {
				const full = scopedKey(key);
				if (value === undefined) {
					configurationValues.delete(full);
				} else {
					configurationValues.set(full, value);
				}
			},
		};
	},
};

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
};

export const StatusBarAlignment = {
	Right: 2,
};

const vscode = {
	env,
	workspace,
	window,
	commands,
	StatusBarAlignment,
	ConfigurationTarget,
	Uri,
	EventEmitter,
	LanguageModelChatMessageRole,
	LanguageModelTextPart,
	LanguageModelThinkingPart,
	LanguageModelDataPart,
	MarkdownString,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	ThemeIcon,
};

export default vscode;
