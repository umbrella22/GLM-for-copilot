import * as vscode from 'vscode';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerCommands } from '../../src/runtime/commands';
import { formatCredentialChannel } from '../../src/auth';
import {
	GLM_CN_CODING_API_KEY_URL,
	GLM_CN_GENERAL_API_KEY_URL,
	GLM_INTERNATIONAL_CODING_API_KEY_URL,
	GLM_INTERNATIONAL_GENERAL_API_KEY_URL,
} from '../../src/endpoint';
import {
	__clearConfigurationValues,
	__getOpenedExternal,
	__resetCommandState,
	__setConfigurationValue,
	__setQuickPickSelectionLabel,
} from '../support/vscode.mock';

describe('runtime commands', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
	});

	it.each([
		['coding-plan', 'china', 'china-coding', GLM_CN_CODING_API_KEY_URL],
		['standard', 'china', 'china-standard', GLM_CN_GENERAL_API_KEY_URL],
		['coding-plan', 'international', 'international-coding', GLM_INTERNATIONAL_CODING_API_KEY_URL],
		['standard', 'international', 'international-standard', GLM_INTERNATIONAL_GENERAL_API_KEY_URL],
	] as const)('opens the API key page for %s/%s', async (apiMode, region, channel, expectedUrl) => {
		__setConfigurationValue('glm-copilot.apiMode', apiMode);
		__setConfigurationValue('glm-copilot.region', region);
		__setQuickPickSelectionLabel(formatCredentialChannel(channel));
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);

		await vscode.commands.executeCommand('glm-copilot.getApiKey');

		expect(__getOpenedExternal()?.toString()).toBe(expectedUrl);
	});
});
