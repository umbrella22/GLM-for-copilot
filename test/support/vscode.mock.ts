type Disposable = { dispose(): void };

export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
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

export const workspace = {
	getConfiguration(section?: string) {
		return {
			get<T>(key: string, fallback?: T): T | undefined {
				const scopedKey = section ? `${section}.${key}` : key;
				if (configurationValues.has(scopedKey)) {
					return configurationValues.get(scopedKey) as T;
				}
				if (configurationValues.has(key)) {
					return configurationValues.get(key) as T;
				}
				return fallback;
			},
			inspect() {
				return undefined;
			},
			async update() {
				return undefined;
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
		return {
			name: '',
			text: '',
			tooltip: '',
			command: '',
			show() {},
			dispose() {},
		};
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
	Uri,
	EventEmitter,
	LanguageModelChatMessageRole,
	LanguageModelTextPart,
	LanguageModelThinkingPart,
	LanguageModelDataPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	ThemeIcon,
};

export default vscode;
