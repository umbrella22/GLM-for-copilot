const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
	const extensionTestsPath = path.resolve(__dirname, 'suite.cjs');
	const version = process.env.VSCODE_VERSION || 'stable';

	try {
		await runTests({
			version,
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-extensions', '--disable-gpu', '--no-sandbox'],
		});
	} catch (error) {
		console.error(`VS Code compatibility smoke test failed (${version}):`, error);
		process.exit(1);
	}
}

void main();
