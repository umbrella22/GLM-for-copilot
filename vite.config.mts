import { defineConfig } from 'vite-plus';

export default defineConfig({
	pack: {
		entry: {
			extension: 'src/extension.ts',
		},
		outDir: 'out',
		format: 'cjs',
		platform: 'node',
		target: 'node24.11',
		fixedExtension: false,
		sourcemap: true,
		dts: true,
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
