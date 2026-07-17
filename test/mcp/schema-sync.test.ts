import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
