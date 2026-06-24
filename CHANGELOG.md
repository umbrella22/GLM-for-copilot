# Changelog

## 0.2.0 - 2026-06-24

### Added

- Added VitePlus/Vitest tests covering endpoint routing, pricing/currency, model metadata, request conversion, tool handling, routing, and Vision Proxy resolution.
- Added GitHub Actions CI for test, lint, format check, compile, and VSIX packaging.
- Updated CI and release workflows to use Node 24-runtime GitHub Actions and explicit Corepack pnpm activation.
- Updated release workflow to package and upload the VSIX artifact before creating the GitHub Release, then reuse that artifact for marketplace publishing and release assets.
- Added `glm-copilot.apiMode` and `glm-copilot.region` endpoint presets:
  - `coding-plan` or `standard`
  - `china` or `international`
- Added `glm-copilot.customModels` for extra GLM-compatible models in the Copilot Chat model picker.
- Added custom model normalization for string IDs and object entries with optional display name, token limits, tool calling, and thinking support.
- Added generic `glm-copilot.modelIdOverrides` support for built-in and custom model IDs.

### Changed

- Changed `glm-copilot.baseUrl` default to an empty string. When empty, the extension resolves the endpoint from `apiMode` and `region`; when non-empty, `baseUrl` still has highest priority.
- Preserved the default resolved endpoint as domestic GLM Coding Plan: `https://open.bigmodel.cn/api/coding/paas/v4`.
- Updated `GLM: Get API Key` to open the API key or plan page matching the configured `apiMode` and `region`.
- Switched provider picker and request preparation to a shared model registry: built-in models plus normalized custom models.
- Kept the `chatLanguageModels` default reasoning-effort migration scoped to built-in models only.
- Updated package configuration schema, English and Chinese setting strings, and README setting tables.
- Excluded tests from VSIX packaging.

### Vision Policy

- Custom models always expose `imageInput: true` to Copilot Chat, but this means image attachments are allowed to enter the existing Vision Proxy.
- Custom models do not bypass the Vision Proxy and do not enable native vision/image requests.
- The built-in Vision Proxy flow remains unchanged: image attachments are converted to text before the final chat request.

### Acknowledgements

- The endpoint preset and custom model direction was informed by [KiwiGaze/glm-for-copilot](https://github.com/KiwiGaze/glm-for-copilot), an MIT-licensed GLM Copilot Chat extension.
- The Z.ai/Coding Plan product surface and endpoint configuration comparison was informed by [selfagency/z-models-vscode](https://github.com/selfagency/z-models-vscode), an MIT-licensed VS Code extension.
- This project remains MIT-licensed, and these credits are included to make the lineage and inspiration explicit.
