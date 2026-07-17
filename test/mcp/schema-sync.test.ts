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

/**
 * [FORK] PR #15 Finding 3: the public package.json JSON Schema for
 * `glm-copilot.mcp.servers` must accept the SAME shapes the runtime
 * sanitizer (config.ts) accepts. The earlier schema used `oneOf` with two
 * branches that both REQUIRED `type` + `label` + (`command`/`url`), so a
 * built-in id partial override like `{ "web-reader": { "url": "..." } }`
 * parsed fine at runtime but showed a red squiggle in Settings JSON — the
 * public contract contradicted the parse capability.
 *
 * The fix switched `oneOf` → `anyOf` and added a third "override" branch
 * with NO required fields (but `additionalProperties: false` so typos are
 * still caught). This test pins that contract: if someone reverts to `oneOf`
 * or drops the override branch / the env-cwd-headers declarations, the build
 * fails loudly.
 *
 * We do NOT assert per-id required differences here — VS Code JSON Schema
 * cannot distinguish built-in ids from user-defined ones by key name, so the
 * override branch necessarily also accepts incomplete standalone shapes
 * (e.g. `{ type:'stdio', label:'X' }` without command). Runtime
 * sanitizeStandaloneServer is the backstop that rejects those for non-built-in
 * ids; the schema's job is just to stop rejecting legitimate overrides.
 */
describe('package.json mcp.servers schema contract (PR #15 F3)', () => {
	const pkgPath = join(process.cwd(), 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
	const serversSchema = (
		(
			pkg.contributes as {
				configuration: { properties: Record<string, unknown> };
			}
		).configuration.properties['glm-copilot.mcp.servers'] as {
			additionalProperties?: { anyOf?: unknown[]; oneOf?: unknown[] };
		}
	).additionalProperties;

	it('uses anyOf (not oneOf) so a partial override can coexist with complete shapes', () => {
		expect(serversSchema, 'additionalProperties must be defined').toBeDefined();
		// anyOf = "at least one branch matches", which lets a built-in partial
		// override (only `url`) match the override branch even though it fails
		// the complete-shape branches. oneOf = "exactly one" and would still
		// reject partials because they match zero complete branches.
		expect(Array.isArray(serversSchema!.anyOf), 'must use anyOf').toBe(true);
		expect(
			Array.isArray(serversSchema!.oneOf),
			'must NOT use oneOf (it cannot accept partial overrides)',
		).toBe(false);
	});

	interface SchemaBranch {
		required?: string[];
		additionalProperties?: unknown;
		properties?: Record<string, unknown>;
	}
	const branches = (serversSchema!.anyOf as SchemaBranch[]) ?? [];

	it('has a partial-override branch with NO required fields', () => {
		// The branch that lets `{ "web-reader": { "url": "..." } }` through.
		// It must not require type/label/command/url.
		const overrideBranch = branches.find(
			(b) => !Array.isArray(b.required) || b.required!.length === 0,
		);
		expect(overrideBranch, 'a no-required override branch must exist').toBeDefined();
	});

	it('partial-override branch rejects unknown fields (additionalProperties: false)', () => {
		// Typos must still be caught: a field name the extension does not know
		// should produce a squiggle, so the user notices a misspelled key.
		const overrideBranch = branches.find(
			(b) => !Array.isArray(b.required) || b.required!.length === 0,
		);
		expect(
			overrideBranch!.additionalProperties,
			'override branch must set additionalProperties',
		).toBe(false);
	});

	it('stdio complete-shape branch declares env + cwd (PR #15 F3 forwarded fields)', () => {
		// config.ts forwards these to McpStdioServerDefinition; the schema must
		// declare them so users writing them don't see a squiggle.
		const stdioBranch = branches.find(
			(b) => Array.isArray(b.required) && b.required!.includes('command'),
		);
		expect(stdioBranch, 'stdio complete-shape branch must exist').toBeDefined();
		const props = stdioBranch!.properties ?? {};
		expect(props.env, 'stdio branch must declare env').toBeDefined();
		expect(props.cwd, 'stdio branch must declare cwd').toBeDefined();
	});

	it('http complete-shape branch declares headers (PR #15 F3 forwarded field)', () => {
		// config.ts forwards headers to McpHttpServerDefinition.
		const httpBranch = branches.find(
			(b) => Array.isArray(b.required) && b.required!.includes('url'),
		);
		expect(httpBranch, 'http complete-shape branch must exist').toBeDefined();
		expect(httpBranch!.properties?.headers, 'http branch must declare headers').toBeDefined();
	});
});
