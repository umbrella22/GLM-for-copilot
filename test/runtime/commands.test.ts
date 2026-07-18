import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
	__setWarningMessageButton,
	__getWindowMessages,
} from '../support/vscode.mock';

// Mock cleanupAllStoredImages so the cleanup command can be tested without
// initializing the real image store. The spy records the call count.
const cleanupAllStoredImagesMock = vi.fn(async () => 0);
vi.mock('../../src/provider/vision/image-store', () => ({
	cleanupAllStoredImages: (...args: unknown[]) => cleanupAllStoredImagesMock(...args),
}));

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

describe('runtime commands — cleanupStoredImages (FORK)', () => {
	beforeEach(() => {
		__clearConfigurationValues();
		__resetCommandState();
		cleanupAllStoredImagesMock.mockClear();
	});

	it('does nothing when the user dismisses the confirmation dialog', async () => {
		__setWarningMessageButton(undefined);
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.cleanupStoredImages');
		expect(cleanupAllStoredImagesMock).not.toHaveBeenCalled();
	});

	it('calls cleanupAllStoredImages when confirmed and reports the count', async () => {
		cleanupAllStoredImagesMock.mockResolvedValueOnce(7);
		__setWarningMessageButton('Delete');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.cleanupStoredImages');
		expect(cleanupAllStoredImagesMock).toHaveBeenCalledTimes(1);
		// Success message includes the deleted count.
		expect(__getWindowMessages().information.join(' ')).toMatch(/7/);
	});

	it('shows an error message when cleanup throws', async () => {
		cleanupAllStoredImagesMock.mockRejectedValueOnce(new Error('fs error'));
		__setWarningMessageButton('Delete');
		registerCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
		await vscode.commands.executeCommand('glm-copilot.cleanupStoredImages');
		expect(cleanupAllStoredImagesMock).toHaveBeenCalledTimes(1);
		// An error message was surfaced (not silently swallowed).
		expect(__getWindowMessages().error.length).toBeGreaterThan(0);
	});
});
