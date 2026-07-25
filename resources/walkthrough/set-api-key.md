Open the Model Manager to choose the default connection, review model-specific routes, and configure the credentials those routes use.

[Open Model Manager](command:glm-copilot.manageModels)

The **Connections** view lists China/International Coding Plan and Standard API channels. Each credential is stored in the OS keychain; the page receives only whether a key exists.

- `Cmd/Ctrl + Shift + P`: Open the Command Palette
- `GLM: Manage Models and Connections`: Open the manager
- `GLM: Set API Key`: Set or update one channel
- `GLM: Clear API Key`: Remove one channel
- `GLM: Get API Key`: Open the key page for one channel
- `GLM: Query Coding Plan Usage`: Query all active Coding Plan channels

If VS Code 1.128+ reports that no utility model is configured for a BYOK agent, open [GLM: Open BYOK Utility Model Settings](command:glm-copilot.openByokUtilitySettings) and choose `mainAgent` or `copilot`. The extension does not change this host setting automatically.
