import vscode from 'vscode';
import { setErrorActionUrl, type ErrorActionUrls } from '../client';
import {
	CONFIGURE_API_KEY_URI_PATH,
	SET_VISION_MODEL_URI_PATH,
	SHOW_LOGS_URI_PATH,
} from '../consts';
import { logger } from '../logger';
import {
	setProviderNoticeShowLogsUrl,
	setVisionProxyConfigurationUrl,
} from '../provider/tools/notices';

interface ActionUrlDefinition {
	key?: keyof ErrorActionUrls;
	path: string;
	handle: () => void | Thenable<unknown>;
	resolveFailureMessage: string;
	setUrl?: (url: string) => void;
	externalize?: boolean;
}

const ACTION_URLS: readonly ActionUrlDefinition[] = [
	{
		key: 'configureApiKey',
		path: CONFIGURE_API_KEY_URI_PATH,
		handle: () => vscode.commands.executeCommand('glm-copilot.setApiKey'),
		resolveFailureMessage: 'Failed to resolve GLM set API key URI',
	},
	{
		key: 'showLogs',
		path: SHOW_LOGS_URI_PATH,
		handle: () => logger.show(),
		resolveFailureMessage: 'Failed to resolve GLM show logs URI',
		setUrl: setProviderNoticeShowLogsUrl,
	},
	{
		path: SET_VISION_MODEL_URI_PATH,
		handle: () => vscode.commands.executeCommand('glm-copilot.setVisionModel'),
		resolveFailureMessage: 'Failed to resolve GLM set vision model URI',
		setUrl: setVisionProxyConfigurationUrl,
	},
];

export function registerActionUrls(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri(uri) {
				const action = ACTION_URLS.find((item) => item.path === uri.path);
				if (action) {
					void Promise.resolve(action.handle()).catch((error) => {
						logger.warn(`Failed to handle GLM URI action: ${uri.path}`, error);
					});
					return;
				}
				logger.warn(`Unhandled GLM URI: ${uri.toString(true)}`);
			},
		}),
	);

	for (const action of ACTION_URLS) {
		resolveActionUrl(context, action);
	}
}

function resolveActionUrl(context: vscode.ExtensionContext, action: ActionUrlDefinition): void {
	const rawUri = vscode.Uri.from({
		scheme: vscode.env.uriScheme,
		authority: context.extension.id,
		path: action.path,
	});
	setActionUrl(action, rawUri.toString());
	if (action.externalize === false) {
		return;
	}

	void vscode.env.asExternalUri(rawUri).then(
		(uri) => setActionUrl(action, uri.toString()),
		(error) => logger.warn(action.resolveFailureMessage, error),
	);
}

function setActionUrl(action: ActionUrlDefinition, url: string): void {
	if (action.key) {
		setErrorActionUrl(action.key, url);
	}
	action.setUrl?.(url);
}
