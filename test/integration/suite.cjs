const assert = require('node:assert');
const vscode = require('vscode');

const EXTENSION_ID = 'ikaros.glm-for-vscode-copilot';
const REQUIRED_COMMANDS = [
	'glm-copilot.manageModels',
	'glm-copilot.setApiKey',
	'glm-copilot.setVisionModel',
];

/**
 * Runs inside the downloaded VS Code instance. Keep this suite dependency-free:
 * it only verifies that the extension activates and that the non-public model
 * provider API still registers models on the target VS Code build.
 */
async function run() {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
	await extension.activate();
	assert.strictEqual(extension.isActive, true, 'extension did not activate');

	const commands = await vscode.commands.getCommands(true);
	for (const command of REQUIRED_COMMANDS) {
		assert.ok(commands.includes(command), `command ${command} is not registered`);
	}

	const models = await vscode.lm.selectChatModels({ vendor: 'glm' });
	assert.ok(models.length > 0, 'no GLM models were registered with vscode.lm');
	assert.ok(
		models.every((model) => model.vendor === 'glm'),
		'vscode.lm returned a non-GLM model for the glm vendor query',
	);
}

module.exports = { run };
