<h1 align="center">GLM for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=ikaros.glm-for-vscode-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/umbrella22/glm-for-copilot?style=for-the-badge&label=Version" alt="Version" />
  <img src="https://vsmarketplacebadges.dev/installs-short/ikaros.glm-for-vscode-copilot.svg?style=for-the-badge" alt="Installs" />
</p>

<p align="center">
  English |
  <a href="https://github.com/umbrella22/glm-for-copilot/blob/main/README.zh-cn.md">简体中文</a>
</p>

**Pick GLM from the Copilot Chat model picker — and keep everything else Copilot already gives you.**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="GLM models in the Copilot Chat model picker, with the per-model Thinking Effort dropdown (None / High / Max)" width="800">
</p>

Love GLM's price-performance but don't want to give up GitHub Copilot's agent mode, tool calling, and polished UI? This extension drops **GLM-5.2, GLM-4.6V-Flash, GLM-5V-Turbo, and GLM-5-Turbo** straight into the Copilot Chat model selector — with **vision**, **thinking mode**, and your own API keys.

## Why this extension?

- **Don't replace Copilot — power it up.** No new sidebar, no new chat UI to learn. Just a new model in the picker you already use.
- **Agent mode, tool calling, instructions, MCP, skills — all of it still works.** Copilot's entire stack, now running on GLM.
- **Vision where each model needs it.** GLM-4.6V-Flash and GLM-5V-Turbo receive images directly by default. GLM-5.2 and GLM-5-Turbo use the transparent Vision Proxy, which describes images with GLM-4.6V-Flash before passing text along. You can choose either mode per model.
- **Estimated per-turn cost.** When the GLM API returns usage, the extension estimates the official list-price cost, reports it to Copilot usage metadata, writes it to logs, and shows the latest turn in the status bar.
- **BYOK, pay GLM directly.** Your API key, your bill, your rate limits. Stored in the OS keychain, never on disk.

## Features

### Four GLM models in the model picker

All four models show up alongside GPT-4o, Claude, and friends in Copilot Chat's model selector. Switch models mid-chat without losing history.

### Transparent Vision Proxy

When a model uses `proxy` mode, the automatic proxy asks GLM-4.6V-Flash to describe the screenshot before the selected model receives the prompt. If GLM-4.6V-Flash is unavailable on its configured endpoint, the extension falls back to another installed Copilot/VS Code vision model. You can also force a VS Code model or a custom API endpoint from **GLM: Open Vision Proxy in Model Manager**. GLM-4.6V-Flash and GLM-5V-Turbo use `native` mode by default and receive resized image data directly.

This keeps GLM-5.2 focused on coding/reasoning while GLM-4.6V-Flash handles multimodal extraction.

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="Dropping an image into Copilot Chat and GLM responding to it via the vision proxy" width="800">
</p>

### Thinking Mode with Reasoning Effort Control

Full support for GLM's `reasoning_content`. Use Copilot Chat's native model picker menu to choose `none` (off), `high` (balanced), or `max` (default deep reasoning for hard agent tasks).

### Inherits Every Copilot Capability

Because this plugs into Copilot's native provider API, you get the full stack for free:

- **Agent mode** — autonomous multi-step tasks
- **Tool calling** — file edits, terminal, workspace search, Git, tests
- **Instructions & skills** — all your `.instructions.md`, `AGENTS.md`, and skills just work
- **Prompt caching stats** — GLM's cache hit rate logged in the output channel so you can see the savings

<p align="center">
  <img src="resources/screenshots/04-agent.png" alt="GLM-5.2 running Copilot's agent mode with tool calls" width="800">
</p>

### Secure by Default

New and updated API keys live in VS Code's `SecretStorage` (OS keychain on macOS / Windows / Linux), isolated by region and billing channel. Legacy plaintext settings are read only as an upgrade fallback until they can be migrated; the Model Manager never writes key contents to `settings.json`.

### Cost Visibility

After each completed GLM response, the extension reports usage to Copilot metadata and writes it to logs. The status bar headline follows the active resource's default channel; its tooltip combines active Coding Plan quotas and Standard API costs. Estimates use CNY for domestic BigModel endpoints and USD for Z.ai endpoints.

### Zero Runtime Dependencies

Pure VS Code API + Node.js built-ins. No Python, no Docker, no local proxy server to babysit.

## Getting Started

### Prerequisites

- VS Code 1.116 or later. This extension relies on non-public Copilot Chat APIs that may break on newer VS Code versions — [report an issue](https://github.com/umbrella22/glm-for-copilot/issues) if you hit one.
- GitHub Copilot subscription (Free / Pro / Enterprise — the free tier works)
- A GLM API key or Coding Plan token for each connection channel you use. Configure them from the Model Manager's **Connections** view or the Set/Get/Clear API Key commands.

### Installation

Install from the registry used by your editor:

1. **Microsoft VS Code** — install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=umbrella22.glm-for-copilot).
2. **Editors that use Open VSX** — install from [Open VSX](https://open-vsx.org/extension/umbrella22/glm-for-copilot).

### Usage

1. Run **GLM: Manage Models and Connections** from the Command Palette (`Cmd+Shift+P`)
2. In **Connections**, choose the default endpoint and configure the credential channels you use
3. In **Models**, review the API model ID, route, and image mode for each model
4. Open Copilot Chat, click the model picker, and pick a GLM model
5. That's it — chat away

## Models

| Model              | Best For                                           |
| ------------------ | -------------------------------------------------- |
| **GLM-5.2**        | Complex refactors, agent tasks, deep reasoning     |
| **GLM-4.6V-Flash** | Multimodal questions, screenshots, visual context  |
| **GLM-5V-Turbo**   | High-capacity native multimodal tasks via Standard API |
| **GLM-5-Turbo**    | Fast everyday coding, quick edits, cheap iteration |

All four support optional thinking mode and tool calling. GLM-5V-Turbo is available through the pay-as-you-go Standard API only; by default it follows the global endpoint region while using that region's Standard API key. GLM-4.6V-Flash and GLM-5V-Turbo receive images natively.

## Model Manager

Run **GLM: Manage Models and Connections** to configure the extension. The page uses three focused views:

- **Models** — API model IDs, official connection routes, image modes, and custom model definitions. GLM-5V-Turbo offers Standard API routes only.
- **Connections** — the default endpoint, optional compatible Base URL, four credential channels, and key status. OpenAI and Anthropic Coding Plan endpoints in the same region use the same Coding Plan credential.
- **Vision Proxy** — the backend and prompt used when a model is configured for `proxy` image mode. **GLM: Open Vision Proxy in Model Manager** opens this view for compatibility with the existing command.

The scope selector applies model configuration at User, Workspace, or Workspace Folder scope. The page shows inherited values and their source; Vision Proxy settings remain user-scoped. Folder settings follow the active editor's workspace folder, fall back to the only folder in a single-root workspace, and do not guess when a multi-root workspace has no active editor. Credentials remain in VS Code `SecretStorage`; the manager never displays key contents.

A custom Base URL is an optional compatibility override for models using the `default` route. Explicit official routes and `same-region-standard` always use their official GLM endpoints. The manager does not automatically fall back between Coding Plan and Standard API.

### Advanced settings

| Setting | Default | Description |
| --- | --- | --- |
| `glm-copilot.modelManagement` | `{ "version": 1 }` | Versioned manager state. Normal edits belong in **GLM: Manage Models and Connections**. The object supports `defaultConnection`, per-model `models` entries (`apiModelId`, `endpointRoute`, `visionMode`), and a `customModels` map. Values merge from User to Workspace to Workspace Folder; `customModels[id] = null` removes an inherited custom model. |
| `glm-copilot.maxTokens` | `0` | Max output tokens (`0` = no limit). Useful for cost control. |
| `glm-copilot.debugMode` | `minimal` | Diagnostic mode: token usage only, privacy-preserving metadata, or verbose request dumps under extension global storage. |
| `glm-copilot.visionModel` | _(auto)_ | Compatibility value managed from the Vision Proxy view. New saves use `vendor/id`; legacy bare model IDs remain readable. |
| `glm-copilot.visionPrompt` | _(built-in)_ | Prompt used to describe image attachments in proxy mode. |
| `glm-copilot.experimental.stabilizeToolList` | `false` | Pre-activates available tools to make the GLM `tools` parameter more stable across turns. It can increase input tokens. |

Thinking Effort is configured from Copilot Chat's model picker for each GLM model.

The manager writes the canonical object below. This example is useful for automation or recovery; the manager is the normal editing surface:

```json
{
  "glm-copilot.modelManagement": {
    "version": 1,
    "defaultConnection": {
      "endpoint": "china-coding",
      "baseUrl": "https://proxy.example.com/v1"
    },
    "models": {
      "glm-5v-turbo": {
        "apiModelId": "glm-5v-turbo",
        "endpointRoute": "same-region-standard",
        "visionMode": "native"
      },
      "team-coder": {
        "apiModelId": "provider-team-coder-id",
        "endpointRoute": "default",
        "visionMode": "proxy"
      }
    },
    "customModels": {
      "team-coder": {
        "name": "Team Coder",
        "contextWindowTokens": 200000,
        "maxOutputTokens": 131072,
        "toolCalling": true,
        "thinking": true
      }
    }
  }
}
```

### Image Input Modes

`proxy` keeps the existing transparent Vision Proxy: a vision model turns image attachments into text, then the selected model receives that text. It works with text-only endpoints but adds a request and cannot preserve every visual detail.

`native` resizes images with VS Code's Copilot-compatible image command before Base64 encoding and applies a 2.5 MiB binary context budget, prioritizing the newest messages. Images over budget are replaced with a notice while the text request continues. Use it only with a model and endpoint that support image input. Native requests fail directly without switching to the proxy. Image bytes are never stored in replay markers, diagnostics, or request dumps.

## Troubleshooting

### GLM models are missing from the agent / background agent model picker

Recent VS Code versions gate custom providers from the background agent and the new agent window. If you can pick GLM in the editor chat but not in the agent window, add the extension to the allowlist in `settings.json`:

```json
{
  "extensions.supportUntrustedWorkspaces": true,
  "extensions.supportAgentsWindow": {
    "ikaros.glm-for-vscode-copilot": true
  }
}
```

If the agent still refuses to start with `No utility model is configured for 'copilot-utility-small' while the selected main model is BYOK`, that is a known VS Code Copilot regression — see [microsoft/vscode#324007](https://github.com/microsoft/vscode/issues/324007). Switching the editor chat to GLM usually works while the upstream issue is open.

### HTTP 400 `Invalid schema for function '...'` from a proxy or relay

This extension targets the official GLM endpoints (BigModel Coding Plan, Z.ai, and the documented BigModel/Z.ai standard API). VS Code/Copilot generates the tool schemas verbatim from its own tool definitions and forwards them as-is. Third-party relays or proxies (e.g. New API, OneAPI) often enforce stricter OpenAI-schema validation than the official endpoint and reject schemas that contain `default: null`, certain `anyOf`/`oneOf` shapes, or other minor deviations — the most common symptom is `Invalid schema for function 'get_errors': null is not of type "array"`.

This is **not** something this extension sanitizes, by design:

- We forward exactly what VS Code/Copilot produces, so any compatibility fix that works on the official endpoint is preserved.
- Maintaining per-relay quirks would create an ever-growing patch surface that can mask real upstream bugs.

If you hit this on a relay, the supported options are:

- Open **GLM: Manage Models and Connections**. In **Connections**, clear the compatible Base URL and select an official default endpoint, or in **Models** assign an official route to the affected model.
- Open a request dump with **GLM: Open Request Dumps Folder** and inspect the offending tool schema, then report the strict-validation bug to your relay.
- The error is also written to the GLM output channel — you can copy the full server response from there.

## Compared to alternatives

|                           | This extension | Local proxy (e.g. LiteLLM) | Standalone GLM extensions |
| ------------------------- | -------------- | -------------------------- | ------------------------- |
| Works inside Copilot Chat | ✅             | ✅                         | ❌ separate UI            |
| Agent mode, tools, skills | ✅             | ✅                         | ⚠️ reimplemented          |
| Vision support            | ✅ proxied     | ❌                         | ❌                        |
| No extra process to run   | ✅             | ❌                         | ✅                        |
| One-click install         | ✅             | ❌                         | ✅                        |
| API key in OS keychain    | ✅             | ❌                         | ⚠️ varies                 |

## Acknowledgements

This project references ideas and implementation patterns from [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot), [KiwiGaze/glm-for-copilot](https://github.com/KiwiGaze/glm-for-copilot), and [selfagency/z-models-vscode](https://github.com/selfagency/z-models-vscode). Thanks to the original authors. Where applicable, redistribution and derivative work should preserve the original MIT License notices.

## License

[MIT](LICENSE)
