import vscode from 'vscode';
import { resolveDefaultConnection } from './config';
import { API_KEY_SECRET, API_KEY_SECRETS, CONFIG_SECTION } from './consts';
import { t } from './i18n';
import { logger } from './logger';
import type { CredentialChannel } from './types';
import { getActiveWorkspaceFolderResource } from './workspace';

export const CREDENTIAL_CHANNELS: readonly CredentialChannel[] = [
	'china-coding',
	'china-standard',
	'international-coding',
	'international-standard',
];

/**
 * Manages GLM API key via VS Code SecretStorage (secure) with
 * fallback to extension settings (less secure, for CI/automation).
 */
export class AuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	/**
	 * Get API key. Tries SecretStorage first, then falls back to settings.
	 */
	async getApiKey(channel: CredentialChannel, resource?: vscode.Uri): Promise<string | undefined> {
		const secretKey = (await this.secretStorage.get(API_KEY_SECRETS[channel]))?.trim();
		if (secretKey) {
			return secretKey;
		}

		if (channel !== resolveDefaultConnection(resource).credentialChannel) {
			return undefined;
		}

		const legacySecret = (await this.secretStorage.get(API_KEY_SECRET))?.trim();
		return legacySecret || getLegacySettingsApiKey(resource);
	}

	/**
	 * Store API key in SecretStorage.
	 */
	async setApiKey(channel: CredentialChannel, apiKey: string): Promise<void> {
		await this.secretStorage.store(API_KEY_SECRETS[channel], apiKey.trim());
	}

	/**
	 * Delete stored API key.
	 */
	async deleteApiKey(channel: CredentialChannel, resource?: vscode.Uri): Promise<void> {
		await this.secretStorage.delete(API_KEY_SECRETS[channel]);
		if (channel !== resolveDefaultConnection(resource).credentialChannel) {
			return;
		}
		await this.secretStorage.delete(API_KEY_SECRET);
		await Promise.all(
			getVisibleLegacySettingsApiKeySources(resource).map((source) =>
				source.config.update('apiKey', undefined, source.target),
			),
		);
	}

	/**
	 * Check if an API key is configured.
	 */
	async hasApiKey(channel: CredentialChannel, resource?: vscode.Uri): Promise<boolean> {
		const key = await this.getApiKey(channel, resource);
		return key !== undefined && key.length > 0;
	}

	/**
	 * Prompt user to enter API key via input box.
	 */
	async promptForApiKey(channel: CredentialChannel): Promise<boolean> {
		const apiKey = await vscode.window.showInputBox({
			prompt: t('auth.promptForChannel', formatCredentialChannel(channel)),
			placeHolder: t('auth.placeholder'),
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return t('auth.emptyValidation');
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(channel, apiKey);
			vscode.window.showInformationMessage(
				t('auth.savedForChannel', formatCredentialChannel(channel)),
			);
			return true;
		}

		return false;
	}
}

export function formatCredentialChannel(channel: CredentialChannel): string {
	return t(`auth.channel.${channel}`);
}

/** Bind the pre-routing API key to the credential channel selected at upgrade time. */
export async function migrateLegacyApiKey(context: vscode.ExtensionContext): Promise<void> {
	const resource = getActiveWorkspaceFolderResource();
	const legacySecret = (await context.secrets.get(API_KEY_SECRET))?.trim();
	const settingsSource = getLegacySettingsApiKeySource(resource);
	const settingsKey = settingsSource?.value;
	const legacyKey = legacySecret || settingsKey;
	if (!legacyKey) {
		return;
	}

	const channel = resolveDefaultConnection(resource).credentialChannel;
	const targetSecret = API_KEY_SECRETS[channel];
	const current = (await context.secrets.get(targetSecret))?.trim();
	if (current && current !== legacyKey) {
		logger.warn(
			`Legacy API key migration skipped: credential channel ${channel} already contains a different key.`,
		);
		return;
	}

	if (!current) {
		try {
			await context.secrets.store(targetSecret, legacyKey);
		} catch (error) {
			logger.warn(
				`Legacy API key migration could not store credentialChannel=${channel}; preserving fallback credentials.`,
				error,
			);
			return;
		}
	}

	try {
		await context.secrets.delete(API_KEY_SECRET);
	} catch (error) {
		logger.warn(
			'Legacy API key secret cleanup failed; the migrated channel key remains active.',
			error,
		);
	}
	if (settingsSource?.value === legacyKey) {
		await clearLegacySettingsApiKeySource(settingsSource);
	}
	logger.info(`Migrated legacy API key to credentialChannel=${channel}`);
}

function getLegacySettingsApiKey(resource?: vscode.Uri): string | undefined {
	return getLegacySettingsApiKeySource(resource)?.value;
}

interface LegacySettingsApiKeySource {
	config: vscode.WorkspaceConfiguration;
	target: vscode.ConfigurationTarget;
	value: string;
}

function getLegacySettingsApiKeySource(
	resource?: vscode.Uri,
): LegacySettingsApiKeySource | undefined {
	return getVisibleLegacySettingsApiKeySources(resource).find((source) => source.value.length > 0);
}

function getVisibleLegacySettingsApiKeySources(
	resource?: vscode.Uri,
): LegacySettingsApiKeySource[] {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const inspection = config.inspect<unknown>('apiKey');
	const sources: LegacySettingsApiKeySource[] = [];
	for (const [target, value] of [
		[vscode.ConfigurationTarget.WorkspaceFolder, inspection?.workspaceFolderValue],
		[vscode.ConfigurationTarget.Workspace, inspection?.workspaceValue],
		[vscode.ConfigurationTarget.Global, inspection?.globalValue],
	] as const) {
		if (typeof value === 'string') {
			sources.push({ config, target, value: value.trim() });
		}
	}
	return sources;
}

async function clearLegacySettingsApiKeySource(source: LegacySettingsApiKeySource): Promise<void> {
	try {
		await source.config.update('apiKey', undefined, source.target);
	} catch (error) {
		logger.warn(`Legacy settings API key cleanup failed for target=${source.target}.`, error);
	}
}
