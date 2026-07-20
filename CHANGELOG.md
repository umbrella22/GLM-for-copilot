# Changelog

## [0.8.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.7.0...v0.8.0) (2026-07-20)


### Features

* **vision,mcp:** strip image-capable MCP tools for non-mcp vision modes ([13914cb](https://github.com/umbrella22/GLM-for-copilot/commit/13914cb0d23c0d8083d2eabbcf5279b6369f0b3b))
* **vision,mcp:** strip image-capable MCP tools for non-mcp vision modes ([#18](https://github.com/umbrella22/GLM-for-copilot/issues/18)) ([5248209](https://github.com/umbrella22/GLM-for-copilot/commit/5248209279c3ec1e9ac4788c2be01160c930f28e))


### Bug Fixes

* update remaining [#17](https://github.com/umbrella22/GLM-for-copilot/issues/17) references to [#18](https://github.com/umbrella22/GLM-for-copilot/issues/18) in comments ([#18](https://github.com/umbrella22/GLM-for-copilot/issues/18)) ([8812ccd](https://github.com/umbrella22/GLM-for-copilot/commit/8812ccd6d71fdc83cc559fc6652aff2311c15b15))

## [0.7.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.6.0...v0.7.0) (2026-07-18)


### Features

* **mcp:** add MCP server provider + mcp vision mode ([339d0d1](https://github.com/umbrella22/GLM-for-copilot/commit/339d0d1001b6e0f61ce889791438d5d3776e0de3))


### Bug Fixes

* **mcp:** address [#15](https://github.com/umbrella22/GLM-for-copilot/issues/15) review findings F1-F7 ([b9eb154](https://github.com/umbrella22/GLM-for-copilot/commit/b9eb154bbf2f95291e5aacd313630e68519efb4d))
* **mcp:** align public schema with parse capability ([#15](https://github.com/umbrella22/GLM-for-copilot/issues/15) F3) ([6fb3812](https://github.com/umbrella22/GLM-for-copilot/commit/6fb381220b99400b6810e76b4c6f95a402a82ce4))
* **mcp:** correct MCP tool id format in image-capable detection ([#15](https://github.com/umbrella22/GLM-for-copilot/issues/15) F2 runtime) ([969773b](https://github.com/umbrella22/GLM-for-copilot/commit/969773b5d746371421fa1cb5c19c80575a0f87a2))
* **mcp:** harden server and vision boundaries ([bb53f52](https://github.com/umbrella22/GLM-for-copilot/commit/bb53f52163d8d5e055a8a89829f0b446fe11980a))

## [0.6.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.5.2...v0.6.0) (2026-07-16)


### Features

* Add GLM API pattern recognition and usage status update functionality ([d3761d2](https://github.com/umbrella22/GLM-for-copilot/commit/d3761d2ca85277dcc4635b70d663e1beb4e3ccf2))
* add vision proxy panel styles and implement action URL handling ([0101028](https://github.com/umbrella22/GLM-for-copilot/commit/0101028586e9533742f2d21c499736bcab3024d7))
* enhance configuration and command handling ([5b03555](https://github.com/umbrella22/GLM-for-copilot/commit/5b03555e11ddbfddd3582c16110f8ade892d4f15))
* Enhance GLM usage tracking and reporting ([83339eb](https://github.com/umbrella22/GLM-for-copilot/commit/83339eb15fc6001d7a8c3e5555489f5f87cf6b65))
* update ([008f641](https://github.com/umbrella22/GLM-for-copilot/commit/008f6419f233946b5fa80449fbeda99be0d65d76))


### Bug Fixes

* Add GLM business error code handling and related internationalization support ([74f1e92](https://github.com/umbrella22/GLM-for-copilot/commit/74f1e92dc825ea5b13632716a67edc7ab1a5f0a7))
* enhance context usage reporting and diagnostics ([0c84b80](https://github.com/umbrella22/GLM-for-copilot/commit/0c84b8007e6e572b4c111fc38331fb97f2a3618d))
* enhance message conversion logic and refactor currency handling in GLMChatProvider ([0195560](https://github.com/umbrella22/GLM-for-copilot/commit/01955600685d51899e40825c64400732d59f1bbd))
* enhance replay marker handling and segment tracing ([1d7b9a2](https://github.com/umbrella22/GLM-for-copilot/commit/1d7b9a23a3eec08da41c4048dbb2f868ab84e5f0))
* improve code formatting and structure in multiple files ([1922986](https://github.com/umbrella22/GLM-for-copilot/commit/1922986a2ef280886ab723a7e2e9ae98b092ee8c))
* Refactor stream handling and diagnostics migration ([f390e36](https://github.com/umbrella22/GLM-for-copilot/commit/f390e3693cffc723b356e7fccded59577cd0ef03))
* revert version to 0.1.0 in package.json and release-please-manifest.json ([c1d749c](https://github.com/umbrella22/GLM-for-copilot/commit/c1d749c2b74bf02342a19baf0c14a4afb5978377))
* update default values for publish options in rescue workflow ([a3907b0](https://github.com/umbrella22/GLM-for-copilot/commit/a3907b058455acf41b0fddd568d5e37cf92f8c82))
* update devDependencies for @vscode/vsce and ovsx, and add minimumReleaseAgeExclude for ovsx ([096e96e](https://github.com/umbrella22/GLM-for-copilot/commit/096e96e92c09f80c7645ab56b9be3485858f2511))
* update GitHub Actions workflows to use latest action versions an… ([eaba3af](https://github.com/umbrella22/GLM-for-copilot/commit/eaba3af43fc5eaf7b5038fcd88d3b453a86a1b37))
* update GitHub Actions workflows to use latest action versions and improve pnpm setup ([9c2a4fe](https://github.com/umbrella22/GLM-for-copilot/commit/9c2a4fedeef46577ac576451e763da75d1a601e3))
* update publisher name in package.json to 'ikaros' ([6967284](https://github.com/umbrella22/GLM-for-copilot/commit/69672845cacb75d1ed31e36411b2decb821bc8b1))
* update workflows to use latest action versions and improve VSIX packaging process ([f32825e](https://github.com/umbrella22/GLM-for-copilot/commit/f32825e02c5e2c17ed84c2bfb02d3e38a9a2df75))

## [0.5.1](https://github.com/umbrella22/GLM-for-copilot/compare/v0.5.0...v0.5.1) (2026-07-14)


### Bug Fixes

* enhance context usage reporting and diagnostics ([0c84b80](https://github.com/umbrella22/GLM-for-copilot/commit/0c84b8007e6e572b4c111fc38331fb97f2a3618d))
* enhance replay marker handling and segment tracing ([1d7b9a2](https://github.com/umbrella22/GLM-for-copilot/commit/1d7b9a23a3eec08da41c4048dbb2f868ab84e5f0))

## [0.5.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.4.1...v0.5.0) (2026-07-14)


### Features

* Add GLM API pattern recognition and usage status update functionality ([d3761d2](https://github.com/umbrella22/GLM-for-copilot/commit/d3761d2ca85277dcc4635b70d663e1beb4e3ccf2))
* add vision proxy panel styles and implement action URL handling ([0101028](https://github.com/umbrella22/GLM-for-copilot/commit/0101028586e9533742f2d21c499736bcab3024d7))
* enhance configuration and command handling ([5b03555](https://github.com/umbrella22/GLM-for-copilot/commit/5b03555e11ddbfddd3582c16110f8ade892d4f15))
* Enhance GLM usage tracking and reporting ([83339eb](https://github.com/umbrella22/GLM-for-copilot/commit/83339eb15fc6001d7a8c3e5555489f5f87cf6b65))


### Bug Fixes

* Add GLM business error code handling and related internationalization support ([74f1e92](https://github.com/umbrella22/GLM-for-copilot/commit/74f1e92dc825ea5b13632716a67edc7ab1a5f0a7))
* enhance message conversion logic and refactor currency handling in GLMChatProvider ([0195560](https://github.com/umbrella22/GLM-for-copilot/commit/01955600685d51899e40825c64400732d59f1bbd))
* improve code formatting and structure in multiple files ([1922986](https://github.com/umbrella22/GLM-for-copilot/commit/1922986a2ef280886ab723a7e2e9ae98b092ee8c))
* Refactor stream handling and diagnostics migration ([f390e36](https://github.com/umbrella22/GLM-for-copilot/commit/f390e3693cffc723b356e7fccded59577cd0ef03))
* revert version to 0.1.0 in package.json and release-please-manifest.json ([c1d749c](https://github.com/umbrella22/GLM-for-copilot/commit/c1d749c2b74bf02342a19baf0c14a4afb5978377))
* update default values for publish options in rescue workflow ([a3907b0](https://github.com/umbrella22/GLM-for-copilot/commit/a3907b058455acf41b0fddd568d5e37cf92f8c82))
* update devDependencies for @vscode/vsce and ovsx, and add minimumReleaseAgeExclude for ovsx ([096e96e](https://github.com/umbrella22/GLM-for-copilot/commit/096e96e92c09f80c7645ab56b9be3485858f2511))
* update GitHub Actions workflows to use latest action versions an… ([eaba3af](https://github.com/umbrella22/GLM-for-copilot/commit/eaba3af43fc5eaf7b5038fcd88d3b453a86a1b37))
* update GitHub Actions workflows to use latest action versions and improve pnpm setup ([9c2a4fe](https://github.com/umbrella22/GLM-for-copilot/commit/9c2a4fedeef46577ac576451e763da75d1a601e3))
* update publisher name in package.json to 'ikaros' ([6967284](https://github.com/umbrella22/GLM-for-copilot/commit/69672845cacb75d1ed31e36411b2decb821bc8b1))
* update workflows to use latest action versions and improve VSIX packaging process ([f32825e](https://github.com/umbrella22/GLM-for-copilot/commit/f32825e02c5e2c17ed84c2bfb02d3e38a9a2df75))

## [0.4.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.3.2...v0.4.0) (2026-07-13)


### Features

* Add GLM API pattern recognition and usage status update functionality ([d3761d2](https://github.com/umbrella22/GLM-for-copilot/commit/d3761d2ca85277dcc4635b70d663e1beb4e3ccf2))
* Enhance GLM usage tracking and reporting ([83339eb](https://github.com/umbrella22/GLM-for-copilot/commit/83339eb15fc6001d7a8c3e5555489f5f87cf6b65))

## [0.3.2](https://github.com/umbrella22/GLM-for-copilot/compare/v0.3.1...v0.3.2) (2026-07-05)


### Bug Fixes

* Add GLM business error code handling and related internationalization support ([74f1e92](https://github.com/umbrella22/GLM-for-copilot/commit/74f1e92dc825ea5b13632716a67edc7ab1a5f0a7))

## [0.3.1](https://github.com/umbrella22/GLM-for-copilot/compare/v0.3.0...v0.3.1) (2026-07-02)


### Bug Fixes

* improve code formatting and structure in multiple files ([1922986](https://github.com/umbrella22/GLM-for-copilot/commit/1922986a2ef280886ab723a7e2e9ae98b092ee8c))

## [0.3.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.2.1...v0.3.0) (2026-06-30)

### Features

- Added new endpoint resolution logic for Anthropic and improved existing endpoint functions. ([7867606](https://github.com/umbrella22/GLM-for-copilot/commit/78676063e5f7af7880a8b6182f402e23cdf0016d))

- Normalized whitespace and trailing slashes in URL handling functions. ([7867606](https://github.com/umbrella22/GLM-for-copilot/commit/78676063e5f7af7880a8b6182f402e23cdf0016d))

### Bug Fixes

- Refactor stream handling and diagnostics migration ([f390e36](https://github.com/umbrella22/GLM-for-copilot/commit/f390e3693cffc723b356e7fccded59577cd0ef03))

## [0.2.1](https://github.com/umbrella22/GLM-for-copilot/compare/v0.2.0...v0.2.1) (2026-06-26)

### Bug Fixes

- enhance message conversion logic and refactor currency handling in GLMChatProvider ([0195560](https://github.com/umbrella22/GLM-for-copilot/commit/01955600685d51899e40825c64400732d59f1bbd))

## [0.2.0](https://github.com/umbrella22/GLM-for-copilot/compare/v0.1.0...v0.2.0) (2026-06-24)

### Features

- add vision proxy panel styles and implement action URL handling ([0101028](https://github.com/umbrella22/GLM-for-copilot/commit/0101028586e9533742f2d21c499736bcab3024d7))
- enhance configuration and command handling ([5b03555](https://github.com/umbrella22/GLM-for-copilot/commit/5b03555e11ddbfddd3582c16110f8ade892d4f15))

### Bug Fixes

- revert version to 0.1.0 in package.json and release-please-manifest.json ([c1d749c](https://github.com/umbrella22/GLM-for-copilot/commit/c1d749c2b74bf02342a19baf0c14a4afb5978377))
- update default values for publish options in rescue workflow ([a3907b0](https://github.com/umbrella22/GLM-for-copilot/commit/a3907b058455acf41b0fddd568d5e37cf92f8c82))
- update devDependencies for @vscode/vsce and ovsx, and add minimumReleaseAgeExclude for ovsx ([096e96e](https://github.com/umbrella22/GLM-for-copilot/commit/096e96e92c09f80c7645ab56b9be3485858f2511))
- update GitHub Actions workflows to use latest action versions an… ([eaba3af](https://github.com/umbrella22/GLM-for-copilot/commit/eaba3af43fc5eaf7b5038fcd88d3b453a86a1b37))
- update GitHub Actions workflows to use latest action versions and improve pnpm setup ([9c2a4fe](https://github.com/umbrella22/GLM-for-copilot/commit/9c2a4fedeef46577ac576451e763da75d1a601e3))
- update publisher name in package.json to 'ikaros' ([6967284](https://github.com/umbrella22/GLM-for-copilot/commit/69672845cacb75d1ed31e36411b2decb821bc8b1))
- update workflows to use latest action versions and improve VSIX packaging process ([f32825e](https://github.com/umbrella22/GLM-for-copilot/commit/f32825e02c5e2c17ed84c2bfb02d3e38a9a2df75))

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
