import { dirname, join } from 'path';
import vscode from 'vscode';
import { MODELS } from '../consts';
import { logger } from '../logger';

const CHAT_LANGUAGE_MODELS_MIGRATION_KEY =
	'glm-copilot.chatLanguageModels.defaultReasoningEffort.version';
const CHAT_LANGUAGE_MODELS_MIGRATION_VERSION = 1;
const DEFAULT_REASONING_EFFORT = 'max';

interface ChatLanguageModelGroup {
	name?: unknown;
	vendor?: unknown;
	settings?: Record<string, unknown>;
}

interface ChatLanguageModelSetting {
	reasoningEffort?: unknown;
	[key: string]: unknown;
}

export async function seedChatLanguageModelDefaults(
	context: vscode.ExtensionContext,
): Promise<void> {
	const migratedVersion = context.globalState.get<number>(CHAT_LANGUAGE_MODELS_MIGRATION_KEY, 0);
	if (migratedVersion >= CHAT_LANGUAGE_MODELS_MIGRATION_VERSION) {
		return;
	}

	const filePath = getChatLanguageModelsPath(context);
	if (!filePath) {
		logger.warn('Unable to locate chatLanguageModels.json for GLM defaults migration');
		return;
	}

	try {
		const changed = await upsertGLMDefaults(filePath);
		await context.globalState.update(
			CHAT_LANGUAGE_MODELS_MIGRATION_KEY,
			CHAT_LANGUAGE_MODELS_MIGRATION_VERSION,
		);
		if (changed) {
			logger.info(
				`Seeded GLM chat model defaults: file=${filePath} reasoningEffort=${DEFAULT_REASONING_EFFORT}`,
			);
		}
	} catch (error) {
		logger.warn(`Failed to seed GLM chat model defaults: file=${filePath}`, error);
	}
}

function getChatLanguageModelsPath(context: vscode.ExtensionContext): string | undefined {
	if (context.globalStorageUri.scheme !== 'file') {
		return undefined;
	}

	const globalStorageDir = dirname(context.globalStorageUri.fsPath);
	const userDataDir = dirname(globalStorageDir);
	return join(userDataDir, 'chatLanguageModels.json');
}

async function upsertGLMDefaults(filePath: string): Promise<boolean> {
	const raw = await readExistingChatLanguageModels(filePath);
	const parsed: unknown = raw ? JSON.parse(raw) : [];
	if (!Array.isArray(parsed)) {
		throw new Error('chatLanguageModels.json must contain an array');
	}

	const groups = parsed as ChatLanguageModelGroup[];
	const glmGroup = getOrCreateGLMGroup(groups);
	const settings = getOrCreateSettings(glmGroup);
	let changed = false;

	for (const model of MODELS) {
		if (!model.capabilities.thinking) {
			continue;
		}

		const current = settings[model.id];
		if (!current || typeof current !== 'object' || Array.isArray(current)) {
			settings[model.id] = { reasoningEffort: DEFAULT_REASONING_EFFORT };
			changed = true;
			continue;
		}

		const setting = current as ChatLanguageModelSetting;
		if (setting.reasoningEffort === undefined || setting.reasoningEffort === 'high') {
			setting.reasoningEffort = DEFAULT_REASONING_EFFORT;
			changed = true;
		}
	}

	if (!changed) {
		return false;
	}

	await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(filePath)));
	await vscode.workspace.fs.writeFile(
		vscode.Uri.file(filePath),
		new TextEncoder().encode(`${JSON.stringify(groups, null, 4)}\n`),
	);
	return true;
}

async function readExistingChatLanguageModels(filePath: string): Promise<string | undefined> {
	try {
		const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
		return new TextDecoder().decode(content);
	} catch (error) {
		if (isFileNotFoundError(error)) {
			return undefined;
		}
		throw error;
	}
}

function getOrCreateGLMGroup(groups: ChatLanguageModelGroup[]): ChatLanguageModelGroup {
	const existing = groups.find((group) => group.vendor === 'glm');
	if (existing) {
		if (existing.name === undefined) {
			existing.name = 'GLM';
		}
		return existing;
	}

	const created: ChatLanguageModelGroup = {
		name: 'GLM',
		vendor: 'glm',
		settings: {},
	};
	groups.push(created);
	return created;
}

function getOrCreateSettings(group: ChatLanguageModelGroup): Record<string, unknown> {
	if (!group.settings || typeof group.settings !== 'object' || Array.isArray(group.settings)) {
		group.settings = {};
	}
	return group.settings;
}

function isFileNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const code = (error as { code?: unknown }).code;
	return code === 'FileNotFound' || code === 'ENOENT';
}
