import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MCP_SERVERS } from '../../src/mcp/builtin';
import { DEFAULT_IMAGE_HANDLING_INSTRUCTION } from '../../src/provider/request';
import { DEFAULT_IMAGE_STORED_PROMPT } from '../../src/provider/vision/image-store';
import type { ModelVisionMode } from '../../src/types';

/**
 * [FORK] PR #15 Finding 4: keep the public package.json JSON Schema for
 * `modelManagement.<id>.visionMode` in sync with the TypeScript union
 * `ModelVisionMode` and the runtime values the config normalizer /
 * model-management commands accept. Earlier only `proxy`/`native` were in the
 * schema while `mcp` was already valid at runtime, so a saved `mcp` value
 * showed as an illegal value in Settings. This test fails the build if the
 * two ever drift again.
 */
describe('package.json visionMode schema sync (PR #15 F4)', () => {
	const pkgPath = join(process.cwd(), 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;

	/**
	 * visionMode lives nested inside the modelManagement additionalProperties
	 * schema (its property name is the bare `visionMode` key, not a dotted
	 * top-level key), so we recursively walk the contributes.configuration
	 * tree looking for a node that is an object with a `visionMode` child whose
	 * value has an `enum`. Returns the first enum found, or undefined.
	 */
	function findVisionModeEnum(): unknown {
		const stack: unknown[] = [pkg.contributes];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node || typeof node !== 'object') {
				continue;
			}
			const obj = node as Record<string, unknown>;
			// Case 1: this node has properties.visionMode.enum
			const visionMode = obj.visionMode;
			if (visionMode && typeof visionMode === 'object') {
				const enumValue = (visionMode as { enum?: unknown }).enum;
				if (Array.isArray(enumValue)) {
					return enumValue;
				}
			}
			// Recurse into all object/array children.
			for (const value of Object.values(obj)) {
				if (value && typeof value === 'object') {
					stack.push(value);
				}
			}
		}
		return undefined;
	}

	it('package.json declares a visionMode enum', () => {
		const enumValue = findVisionModeEnum();
		expect(enumValue, 'visionMode enum must exist in package.json').toBeDefined();
		expect(Array.isArray(enumValue)).toBe(true);
	});

	it('package.json visionMode enum contains every runtime ModelVisionMode value', () => {
		const enumValue = findVisionModeEnum() as string[] | undefined;
		expect(enumValue).toBeDefined();
		// The runtime union is the source of truth. Hardcoded here so a change
		// to the union without updating the schema (or vice versa) fails loudly.
		const runtimeModes: ModelVisionMode[] = ['proxy', 'native', 'mcp'];
		for (const mode of runtimeModes) {
			expect(enumValue, `enum missing runtime mode "${mode}"`).toContain(mode);
		}
	});

	it('package.json visionMode enum has no extra values beyond the runtime union', () => {
		const enumValue = findVisionModeEnum() as string[] | undefined;
		expect(enumValue).toBeDefined();
		const runtimeModes = new Set<ModelVisionMode>(['proxy', 'native', 'mcp']);
		for (const declared of enumValue!) {
			expect(
				runtimeModes.has(declared as ModelVisionMode),
				`enum has unexpected value "${declared}"`,
			).toBe(true);
		}
	});
});

describe('package.json mcp.servers schema contract (PR #15 F3)', () => {
	const pkgPath = join(process.cwd(), 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
	const properties = (
		pkg.contributes as {
			configuration: { properties: Record<string, unknown> };
		}
	).configuration.properties;
	const serversSetting = properties['glm-copilot.mcp.servers'] as {
		default?: unknown;
		scope?: string;
		patternProperties?: Record<string, SchemaBranch>;
		additionalProperties?: { oneOf?: SchemaBranch[]; anyOf?: SchemaBranch[] };
	};

	interface SchemaBranch {
		required?: string[];
		additionalProperties?: unknown;
		properties?: Record<string, { minLength?: number } | unknown>;
	}

	it('keeps built-ins out of manifest defaults and reads this setting only at application scope', () => {
		expect(serversSetting.default).toEqual({});
		expect(serversSetting.scope).toBe('application');
	});

	it('limits partial definitions to the exact built-in ids', () => {
		const patterns = Object.keys(serversSetting.patternProperties ?? {});
		expect(patterns).toHaveLength(1);
		const builtinPattern = new RegExp(patterns[0]!);
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			expect(builtinPattern.test(id), `pattern must accept built-in ${id}`).toBe(true);
		}
		expect(builtinPattern.test('my-custom-server')).toBe(false);
		const partialSchema = serversSetting.patternProperties?.[patterns[0]!];
		expect(partialSchema?.required).toBeUndefined();
		expect(partialSchema?.additionalProperties).toBe(false);
	});

	it('requires complete stdio/http definitions for every custom id', () => {
		const branches = serversSetting.additionalProperties?.oneOf ?? [];
		expect(serversSetting.additionalProperties?.anyOf).toBeUndefined();
		expect(branches).toHaveLength(2);
		const stdioBranch = branches.find(
			(b) => Array.isArray(b.required) && b.required!.includes('command'),
		);
		const httpBranch = branches.find(
			(b) => Array.isArray(b.required) && b.required!.includes('url'),
		);
		expect(stdioBranch, 'stdio complete-shape branch must exist').toBeDefined();
		expect(httpBranch, 'http complete-shape branch must exist').toBeDefined();
		if (!stdioBranch || !httpBranch) {
			throw new Error('complete MCP schema branches are missing');
		}
		expect(stdioBranch!.required).toEqual(expect.arrayContaining(['type', 'label', 'command']));
		expect(httpBranch!.required).toEqual(expect.arrayContaining(['type', 'label', 'url']));
		expect(stdioBranch!.properties?.env).toBeDefined();
		expect(stdioBranch!.properties?.cwd).toBeDefined();
		expect(httpBranch!.properties?.headers, 'http branch must declare headers').toBeDefined();
		const stdioProperties = stdioBranch.properties ?? {};
		const httpProperties = httpBranch.properties ?? {};
		expect((stdioProperties.label as { minLength?: number }).minLength).toBe(1);
		expect((stdioProperties.command as { minLength?: number }).minLength).toBe(1);
		expect((httpProperties.url as { minLength?: number }).minLength).toBe(1);
	});

	it('keeps credential-bearing built-in enable switches at application scope', () => {
		for (const id of Object.keys(BUILTIN_MCP_SERVERS)) {
			const setting = properties[`glm-copilot.mcp.${id}.enabled`] as { scope?: string };
			expect(setting.scope, `${id} enable switch scope`).toBe('application');
		}
	});
});

describe('package.json MCP prompt defaults', () => {
	const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
		contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
	};
	const properties = pkg.contributes.configuration.properties;

	it('matches the runtime image-handling instruction exactly', () => {
		expect(properties['glm-copilot.imageHandlingPrompt']?.default).toBe(
			DEFAULT_IMAGE_HANDLING_INSTRUCTION,
		);
	});

	it('matches the runtime per-image prompt exactly', () => {
		expect(properties['glm-copilot.imageStoredPrompt']?.default).toBe(DEFAULT_IMAGE_STORED_PROMPT);
	});

	it('does not document the obsolete double-underscore MCP tool id format', () => {
		for (const file of ['package.nls.json', 'package.nls.zh-cn.json']) {
			const messages = JSON.parse(readFileSync(join(process.cwd(), file), 'utf-8')) as Record<
				string,
				string
			>;
			expect(messages['glm-copilot.config.mcp.imageCapableTools.description']).not.toContain(
				'mcp__',
			);
		}
	});
});
