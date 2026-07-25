## Enable GLM in the Agent window

If GLM shows up in the editor chat but is missing from the new agent window / background agent, allowlist the extension in `settings.json`:

```json
{
  "extensions.supportAgentsWindow": {
    "ikaros.glm-for-vscode-copilot": true
  }
}
```

For VS Code 1.128+ errors such as `No utility model is configured for 'copilot-utility-small' while the selected main model is BYOK`, set the host utility policy explicitly. Use [GLM: Open BYOK Utility Model Settings](command:glm-copilot.openByokUtilitySettings), or add:

```json
{
  "chat.byokUtilityModelDefault": "mainAgent"
}
```

`mainAgent` uses the selected GLM for utility requests and may add BYOK usage. `copilot` uses the Copilot utility model. Explicit `chat.utilityModel` and `chat.utilitySmallModel` values take precedence. The extension does not write this host setting or change `isBYOK`.

## Manage models and connections

The Model Manager combines the model ID, connection route, image mode, credentials, and Vision Proxy controls that affect GLM requests.

- **Models**: configure API model IDs, official endpoint routes, image modes, and custom models.
- **Connections**: choose the default endpoint, manage four credential channels, and optionally set a compatible Base URL.
- **Vision Proxy**: select and test the backend used when a model's image mode is `proxy`.

The scope selector writes model configuration to User, Workspace, or Workspace Folder settings. A custom Base URL applies only to models using the `default` route. Explicit official routes and `same-region-standard` use official GLM endpoints, and Coding Plan and Standard API requests never fall back to each other automatically.

[Open Model Manager](command:glm-copilot.manageModels)

## Stabilize Tool List (Experimental)

First, open VS Code's Tools configuration and check how many tools are enabled for chat.

[Configure Tools](command:workbench.action.chat.configureTools)

- 64 or fewer enabled tools: there is usually no need to turn this on unless the tool list still changes across turns.
- More than 128 enabled tools: not recommended. GLM supports at most 128 functions in one `tools` request, so GLM Copilot cannot guarantee a stable `tools` list above that limit. Disable rarely used tools first, then consider enabling this setting.
- Between 64 and 128 enabled tools: consider this setting only if the tools list changes between turns and GLM context-cache hits are poor.

This setting may improve cache hits by making the GLM API `tools` parameter more complete and stable across turns. It may also increase input tokens because more function definitions can be included in each request.

[Open GLM setting](command:workbench.action.openSettings?%5B%22%40id%3Aglm-copilot.experimental.stabilizeToolList%22%5D)
