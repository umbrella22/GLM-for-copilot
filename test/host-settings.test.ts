import { beforeEach, describe, expect, it } from 'vitest';
import { getByokUtilitySettings, normalizeByokUtilityModelDefault } from '../src/host-settings';
import {
	__clearConfigurationValues,
	__setConfigurationDefaultValue,
	__setConfigurationValue,
} from './support/vscode.mock';

describe('BYOK utility host settings', () => {
	beforeEach(() => {
		__clearConfigurationValues();
	});

	it.each([
		['none', 'none'],
		['mainAgent', 'mainAgent'],
		['copilot', 'copilot'],
		['old-version', 'unknown'],
		[undefined, 'unknown'],
	] as const)('normalizes %s to %s', (value, expected) => {
		expect(normalizeByokUtilityModelDefault(value)).toBe(expected);
	});

	it('reads explicit utility models without treating defaults as user configuration', () => {
		__setConfigurationDefaultValue('chat.utilityModel', 'copilot-utility');
		__setConfigurationDefaultValue('chat.utilitySmallModel', 'copilot-utility-small');
		__setConfigurationValue('chat.byokUtilityModelDefault', 'none');
		__setConfigurationValue('chat.utilityModel', 'glm/utility');
		expect(getByokUtilitySettings()).toEqual({
			defaultMode: 'none',
			utilityModelConfigured: true,
			utilitySmallModelConfigured: false,
		});

		__clearConfigurationValues();
		__setConfigurationValue('chat.byokUtilityModelDefault', 'mainAgent');
		expect(getByokUtilitySettings()).toEqual({
			defaultMode: 'mainAgent',
			utilityModelConfigured: false,
			utilitySmallModelConfigured: false,
		});
	});

	it('does not write configuration', () => {
		__setConfigurationValue('chat.byokUtilityModelDefault', 'none');
		getByokUtilitySettings();
		expect(getByokUtilitySettings().defaultMode).toBe('none');
	});
});
