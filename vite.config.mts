import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

const vscodeMockPath = fileURLToPath(new URL('./test/support/vscode.mock.ts', import.meta.url));

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		globals: false,
		alias: {
			vscode: vscodeMockPath,
		},
	},
	pack: {
		entry: {
			extension: 'src/extension.ts',
		},
		outDir: 'out',
		format: 'cjs',
		platform: 'node',
		target: 'node24.11',
		fixedExtension: false,
		sourcemap: false,
		// VS Code loads the bundled extension entrypoint; no public declaration bundle is consumed.
		dts: false,
		clean: true,
		checks: {
			legacyCjs: false,
		},
		deps: {
			neverBundle: ['vscode'],
		},
	},
	fmt: {
		singleQuote: true,
		useTabs: true,
		tabWidth: 2,
		ignorePatterns: [],
	},
	lint: {
		plugins: ['typescript', 'import', 'unicorn', 'oxc'],
		rules: {
			'typescript/no-unused-vars': 'error',
		},
	},
	run: {
		tasks: {
			'build-extension': {
				command: 'vp pack',
				cache: false,
			},
			'prepare-marketplace-readme': {
				command: 'bash .github/scripts/prepare-marketplace-readme.sh',
				cache: false,
			},
			vsix: {
				command: 'vsce package --readme-path dist/README.marketplace.md -o dist/',
				dependsOn: ['build-extension', 'prepare-marketplace-readme'],
				cache: false,
			},
		},
	},
});
