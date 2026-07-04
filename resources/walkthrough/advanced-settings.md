## Enable GLM in the Agent window

If GLM shows up in the editor chat but is missing from the new agent window / background agent, allowlist the extension in `settings.json`:

```json
{
  "extensions.supportAgentsWindow": {
    "ikaros.glm-for-vscode-copilot": true
  }
}
```

If the agent still fails with `No utility model is configured for 'copilot-utility-small' while the selected main model is BYOK`, that is a known VS Code Copilot regression ([microsoft/vscode#324007](https://github.com/microsoft/vscode/issues/324007)) — the editor chat keeps working while the upstream issue is open.

## Stabilize Tool List (Experimental)

First, open VS Code's Tools configuration and check how many tools are enabled for chat.

[Configure Tools](command:workbench.action.chat.configureTools)

- 64 or fewer enabled tools: there is usually no need to turn this on unless the tool list still changes across turns.
- More than 128 enabled tools: not recommended. GLM supports at most 128 functions in one `tools` request, so GLM Copilot cannot guarantee a stable `tools` list above that limit. Disable rarely used tools first, then consider enabling this setting.
- Between 64 and 128 enabled tools: consider this setting only if the tools list changes between turns and GLM context-cache hits are poor.

This setting may improve cache hits by making the GLM API `tools` parameter more complete and stable across turns. It may also increase input tokens because more function definitions can be included in each request.

[Open GLM setting](command:workbench.action.openSettings?%5B%22%40id%3Aglm-copilot.experimental.stabilizeToolList%22%5D)
