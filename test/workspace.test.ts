import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveWorkspaceFolderResource } from '../src/workspace';
import {
	Uri,
	__resetCommandState,
	__setActiveTextEditorUri,
	__setWorkspaceFolders,
} from './support/vscode.mock';

describe('workspace configuration resource', () => {
	beforeEach(() => {
		__resetCommandState();
		__setWorkspaceFolders([]);
	});

	it('uses the active editor workspace folder in a multi-root workspace', () => {
		const app = Uri.file('/workspace/app');
		const docs = Uri.file('/workspace/docs');
		__setWorkspaceFolders([app, docs]);
		__setActiveTextEditorUri(Uri.file('/workspace/docs/readme.md'));

		expect(getActiveWorkspaceFolderResource()?.toString()).toBe(docs.toString());
	});

	it('falls back to the only workspace folder when no editor is active', () => {
		const app = Uri.file('/workspace/app');
		__setWorkspaceFolders([app]);

		expect(getActiveWorkspaceFolderResource()?.toString()).toBe(app.toString());
	});

	it('does not guess between multiple folders without an active editor', () => {
		__setWorkspaceFolders([Uri.file('/workspace/app'), Uri.file('/workspace/docs')]);

		expect(getActiveWorkspaceFolderResource()).toBeUndefined();
	});
});
