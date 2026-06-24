<h1 align="center">GLM for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=ikaros.glm-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/ikaros/glm-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="Install from Open VSX"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/umbrella22/glm-for-copilot?style=for-the-badge&label=Version" alt="Version" />
  <img src="https://vsmarketplacebadges.dev/installs-short/ikaros.glm-for-copilot.svg?style=for-the-badge" alt="Installs" />
</p>

<p align="center">
  English |
  <a href="https://github.com/umbrella22/glm-for-copilot/blob/main/README.zh-cn.md">简体中文</a>
</p>

**Pick GLM from the Copilot Chat model picker — and keep everything else Copilot already gives you.**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="GLM-5.2, GLM-4.6V-Flash, and GLM-5-Turbo in the Copilot Chat model picker, with the per-model Thinking Effort dropdown (None / High / Max)" width="800">
</p>

Love GLM's price-performance but don't want to give up GitHub Copilot's agent mode, tool calling, and polished UI? This extension drops **GLM-5.2, GLM-4.6V-Flash, and GLM-5-Turbo** straight into the Copilot Chat model selector — with **vision**, **thinking mode**, and your own API key.

## Why this extension?

- **Don't replace Copilot — power it up.** No new sidebar, no new chat UI to learn. Just a new model in the picker you already use.
- **Agent mode, tool calling, instructions, MCP, skills — all of it still works.** Copilot's entire stack, now running on GLM.
- **Vision where each model needs it.** For GLM-5.2 and GLM-5-Turbo, images are transparently described by GLM-4.6V-Flash first, then passed along as text. If GLM-4.6V-Flash is unavailable, the extension falls back to another Copilot/VS Code vision model.
- **Estimated per-turn cost.** When the GLM API returns usage, the extension estimates the official list-price cost, reports it to Copilot usage metadata, writes it to logs, and shows the latest turn in the status bar.
- **BYOK, pay GLM directly.** Your API key, your bill, your rate limits. Stored in the OS keychain, never on disk.

## Features

### GLM-5.2, GLM-4.6V-Flash, and GLM-5-Turbo in the model picker

All three models show up alongside GPT-4o, Claude, and friends in Copilot Chat's model selector. Switch models mid-chat without losing history.

### Transparent Vision Proxy

Drop a screenshot into chat and the automatic proxy asks GLM-4.6V-Flash to describe it before the selected GLM model receives the prompt. If GLM-4.6V-Flash is unavailable on the current endpoint or plan, the extension falls back to another installed Copilot/VS Code vision model. You can also force a VS Code model or a custom API endpoint from **GLM: Configure Vision Proxy**.

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

API key lives in VS Code's `SecretStorage` (OS keychain on macOS / Windows / Linux). Never in `settings.json`, never in your Git history.

### Cost Visibility

After each completed GLM response, the extension reports usage to Copilot metadata and writes it to logs. The status bar shows the latest turn and session total. Estimates use the official GLM list prices for the current endpoint currency: CNY for domestic BigModel endpoints and USD for Z.ai endpoints. Coding Plan requests also show an approximate list-price equivalent when token usage is returned.

### Zero Runtime Dependencies

Pure VS Code API + Node.js built-ins. No Python, no Docker, no local proxy server to babysit.

## Getting Started

### Prerequisites

- VS Code 1.116 or later. This extension relies on non-public Copilot Chat APIs that may break on newer VS Code versions — [report an issue](https://github.com/umbrella22/glm-for-copilot/issues) if you hit one.
- GitHub Copilot subscription (Free / Pro / Enterprise — the free tier works)
- GLM API key or Coding Plan token. Run **GLM: Get API Key** to open the page matching your `glm-copilot.apiMode` and `glm-copilot.region`, or use a compatible provider token when using a custom `glm-copilot.baseUrl`

### Installation

Install from the registry used by your editor:

1. **Microsoft VS Code** — install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=umbrella22.glm-for-copilot).
2. **Editors that use Open VSX** — install from [Open VSX](https://open-vsx.org/extension/umbrella22/glm-for-copilot).

### Usage

1. Run **GLM: Set API Key** from the Command Palette (`Cmd+Shift+P`)
2. Paste your GLM API key, Coding Plan token, or compatible provider token
3. Open Copilot Chat, click the model picker, pick **GLM-5.2**, **GLM-4.6V-Flash**, or **GLM-5-Turbo**
4. That's it — chat away

## Models

| Model              | Best For                                           |
| ------------------ | -------------------------------------------------- |
| **GLM-5.2**        | Complex refactors, agent tasks, deep reasoning     |
| **GLM-4.6V-Flash** | Multimodal questions, screenshots, visual context  |
| **GLM-5-Turbo**    | Fast everyday coding, quick edits, cheap iteration |

All three support optional thinking mode and tool calling. GLM-5.2 is the best fit for long-context or high-reasoning tasks; GLM-4.6V-Flash is used automatically as the first vision proxy for image attachments.

## Settings

| Setting                                      | Default                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glm-copilot.baseUrl`                        | empty                                         | Optional API endpoint override. Leave empty to use `apiMode` + `region`; any non-empty value has highest priority. The default resolved endpoint is domestic Coding Plan: `https://open.bigmodel.cn/api/coding/paas/v4`                                                                                                                                                                                                                                                                                                      |
| `glm-copilot.region`                         | `china`                                       | Endpoint preset region when `baseUrl` is empty: `china` for BigModel or `international` for Z.ai                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `glm-copilot.apiMode`                        | `coding-plan`                                 | Endpoint preset mode when `baseUrl` is empty: `coding-plan` or `standard`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `glm-copilot.maxTokens`                      | `0`                                           | Max output tokens (`0` = no limit). Useful for cost control                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `glm-copilot.modelIdOverrides`               | prefilled official ID map                     | API model IDs to send for built-in or custom models. The GLM-4.6V-Flash override is also used by automatic vision proxy mode. Change only for compatible endpoints with different model names                                                                                                                                                                                                                                                                                                                                 |
| `glm-copilot.customModels`                   | `[]`                                          | Extra GLM-compatible models for the picker. Accepts string IDs or objects with `id`, optional `name`, token limits, `toolCalling`, and `thinking`. Custom IDs override built-ins. Images still go through the current Vision Proxy; custom models do not bypass it for native vision                                                                                                                                                                                                                                         |
| `glm-copilot.debugMode`                      | `minimal`                                     | Diagnostic mode: `minimal` for token usage only, `metadata` for privacy-preserving logs, or `verbose` for full request dumps and pipeline snapshots under extension global storage. Full dumps may include sensitive prompt text, tool schemas, file snippets, and image descriptions. Use `GLM: Open Request Dumps Folder` to open the dump location                                                                                                                                                                         |
| `glm-copilot.visionModel`                    | _(auto)_                                      | VS Code vision model used as fallback when automatic GLM-4.6V-Flash vision is unavailable. Configure from `GLM: Configure Vision Proxy`; new saves use `vendor/id`, while legacy bare model IDs are still read                                                                                                                                                                                                                                                                                                                |
| `glm-copilot.visionPrompt`                   | _(built-in)_                                  | Prompt used to describe image attachments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `glm-copilot.experimental.stabilizeToolList` | `false`                                       | Experimental. Tries to pre-activate VS Code/Copilot virtual tools so the GLM API `tools` parameter is more complete and stable across turns. May improve context-cache hit rate when enabled tools change between turns. Can increase input tokens because more function definitions may be included; cache-hit input tokens are cheaper but still count toward usage. Usually leave it off with 64 or fewer enabled tools unless the tool list still changes across turns; do not enable it with more than 128 enabled tools |

Thinking Effort is configured from Copilot Chat's model picker for each GLM model.

Example `settings.json` override for compatible API proxies:

```json
{
  "glm-copilot.baseUrl": "https://proxy.example.com/v1",
  "glm-copilot.customModels": [
    "my-glm-model",
    {
      "id": "team-coder",
      "name": "Team Coder",
      "maxInputTokens": 200000,
      "maxOutputTokens": 131072,
      "toolCalling": true,
      "thinking": true
    }
  ],
  "glm-copilot.modelIdOverrides": {
    "glm-5.2": "your-glm-5.2-model-id",
    "glm-4.6v-flash": "your-glm-4.6v-flash-model-id",
    "glm-5-turbo": "your-glm-5-turbo-model-id",
    "team-coder": "provider-team-coder-id"
  }
}
```

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
