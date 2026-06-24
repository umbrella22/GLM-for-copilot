<h1 align="center">GLM for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=umbrella22.glm-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="从 VS Code Marketplace 安装"></a>
  <a href="https://open-vsx.org/extension/umbrella22/glm-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="从 Open VSX 安装"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/umbrella22/glm-for-copilot?style=for-the-badge&label=Version" alt="版本" />
  <img src="https://vsmarketplacebadges.dev/installs-short/umbrella22.glm-for-copilot.svg?style=for-the-badge" alt="安装量" />
</p>

<p align="center">
  <a href="https://github.com/umbrella22/glm-for-copilot/blob/main/README.md">English</a> |
  简体中文
</p>

**在 Copilot Chat 模型选择器中直接使用 GLM——无需离开你熟悉的 Copilot 工作流。**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="GLM-5.2、GLM-4.6V-Flash 和 GLM-5-Turbo 出现在 Copilot Chat 模型选择器中，带有可按模型独立设置的思考深度下拉菜单（停用 / 标准 / 深度）" width="800">
</p>

喜欢 GLM 的性价比，但不想放弃 GitHub Copilot 的 Agent 模式、工具调用和成熟的交互体验？本扩展将 **GLM-5.2、GLM-4.6V-Flash 和 GLM-5-Turbo** 直接接入 Copilot Chat 模型选择器，支持**视觉识别**、**思考模式**，使用你自己的 API Key。

## 为什么选这个扩展？

- **不是替换 Copilot，而是增强它。** 没有新的侧边栏，没有新的聊天界面需要学习。只是在你已经在用的模型选择器中多了一个选项。
- **Agent 模式、工具调用、Instructions、MCP、Skills——全部正常运作。** Copilot 的完整能力栈，现在跑在 GLM 上。
- **按模型需要处理视觉任务。** 对 GLM-5.2 和 GLM-5-Turbo，图片会先交给 GLM-4.6V-Flash 透明代理生成描述，再以文本形式传回当前模型；如果 GLM-4.6V-Flash 不可用，则回退到其他 Copilot/VS Code 视觉模型。
- **按轮次估算费用。** 当 GLM API 返回 usage 时，扩展会按官方标价估算本轮费用，上报到 Copilot usage 元数据、写入日志，并在状态栏显示最近一轮费用。
- **需自行提供 API Key，直接向 GLM 付费。** 你的 API Key，你的账单，你的速率限制。密钥存储在操作系统密钥链中，不会以明文形式写入磁盘。

## 功能特性

### GLM-5.2、GLM-4.6V-Flash 和 GLM-5-Turbo 出现在模型选择器中

三个模型与 GPT-4o、Claude 等并列在 Copilot Chat 的模型选择器中。可在对话中途切换模型，不丢失聊天历史。

### 透明视觉代理

将截图拖入聊天后，自动视觉代理会优先让 GLM-4.6V-Flash 描述图片，再把描述交给当前选中的 GLM 模型。如果当前端点或套餐无法使用 GLM-4.6V-Flash，则回退到已安装的 Copilot/VS Code 视觉模型。你也可以通过 **GLM: 配置视觉代理** 强制选择 VS Code 模型或自定义 API 端点。

这样 GLM-5.2 可以继续专注编码与推理，视觉抽取交给 GLM-4.6V-Flash。

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="将图片拖入 Copilot Chat，GLM 通过视觉代理响应" width="800">
</p>

### 思考模式与推理深度控制

完整支持 GLM 的 `reasoning_content`。通过 Copilot Chat 模型选择器的菜单选择 `停用`、`标准`（均衡，默认）或 `深度`（适用于复杂 Agent 任务）。

### 继承全部 Copilot 能力

由于本扩展接入的是 Copilot 的原生 provider API，你免费获得完整能力栈：

- **Agent 模式**——自主执行多步骤任务
- **工具调用**——文件编辑、终端操作、工作区搜索、Git、测试
- **Instructions & Skills**——你的 `.instructions.md`、`AGENTS.md` 和各项 Skills 开箱即用
- **Prompt 缓存统计**——在输出通道中记录 GLM 缓存命中率，直观看到成本节省

<p align="center">
  <img src="resources/screenshots/04-agent.png" alt="GLM-5.2 运行 Copilot 的 Agent 模式，执行工具调用" width="800">
</p>

### 安全优先

API Key 存储在 VS Code 的 `SecretStorage` 中（macOS 钥匙串 / Windows 凭据管理器 / Linux 密钥环）。绝不会出现在 `settings.json` 中，也不会被提交到 Git 历史。

### 费用可见

每次 GLM 响应完成后，扩展会将用量上报到 Copilot 元数据并写入日志。状态栏会显示最近一轮费用和当前会话累计费用。估算会根据当前 endpoint 选择官方标价货币：国内 BigModel endpoint 使用 CNY，Z.ai endpoint 使用 USD。Coding Plan 请求只要返回 token usage，也会显示对应的官方标价近似值。

### 零运行时依赖

纯 VS Code API + Node.js 内置模块。无需 Python、Docker 或本地代理进程。

## 快速开始

### 前置条件

- VS Code 1.116 及以上版本。本扩展依赖非公开的 Copilot Chat API，较新的 VS Code 版本可能存在兼容性问题——如遇到请[提交 Issue](https://github.com/umbrella22/glm-for-copilot/issues)。
- GitHub Copilot 订阅（Free / Pro / Enterprise——免费版即可使用）
- GLM API Key 或 Coding Plan Token。运行 **GLM: 获取 API Key** 会根据 `glm-copilot.apiMode` 和 `glm-copilot.region` 打开对应页面；使用自定义 `glm-copilot.baseUrl` 时也可使用兼容的 provider token

### 安装方式

根据你所使用的编辑器选择对应的注册表安装：

1. **Microsoft VS Code** — 从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ikaros.glm-for-copilot) 安装。
2. **使用 Open VSX 的编辑器** — 从 [Open VSX](https://open-vsx.org/extension/umbrella22/glm-for-copilot) 安装。

### 使用步骤

1. 通过命令面板（`Cmd+Shift+P`）运行 **GLM: 设置 API Key**
2. 粘贴你的 GLM API Key、Coding Plan Token 或兼容的 provider token
3. 打开 Copilot Chat，点击模型选择器，选择 **GLM-5.2**、**GLM-4.6V-Flash** 或 **GLM-5-Turbo**
4. 搞定——开始聊天

## 模型

| 模型               | 适用场景                         |
| ------------------ | -------------------------------- |
| **GLM-5.2**        | 复杂重构、Agent 任务、深度推理   |
| **GLM-4.6V-Flash** | 多模态问答、截图理解、视觉上下文 |
| **GLM-5-Turbo**    | 日常快速编码、小改动、低成本迭代 |

三者均支持可选的思考模式和工具调用。需要长上下文或高强度推理时，优先选择 GLM-5.2；图片附件会在自动模式下优先交给 GLM-4.6V-Flash 处理。

## 设置项

| 设置项                                       | 默认值                                        | 说明                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glm-copilot.baseUrl`                        | 留空                                          | 可选 API endpoint 覆盖项。留空时使用 `apiMode` + `region`；任何非空值都会优先覆盖 preset。默认解析 endpoint 仍是国内 Coding Plan：`https://open.bigmodel.cn/api/coding/paas/v4`                                                                                                                                                                   |
| `glm-copilot.region`                         | `china`                                       | `baseUrl` 留空时使用的 endpoint preset 区域：`china` 使用 BigModel，`international` 使用 Z.ai                                                                                                                                                                                                                                                         |
| `glm-copilot.apiMode`                        | `coding-plan`                                 | `baseUrl` 留空时使用的 endpoint preset 模式：`coding-plan` 或 `standard`                                                                                                                                                                                                                                                                              |
| `glm-copilot.maxTokens`                      | `0`                                           | 最大输出 Token 数（`0` = 不限制）。可用于成本控制                                                                                                                                                                                                                                                                                                     |
| `glm-copilot.modelIdOverrides`               | 预填官方 ID 映射                              | 内置或自定义模型实际发送到 API 的模型 ID。GLM-4.6V-Flash 的覆盖项也会用于自动视觉代理模式。仅在兼容 endpoint 使用不同模型名时修改                                                                                                                                                                                                                    |
| `glm-copilot.customModels`                   | `[]`                                          | 额外显示在模型选择器中的 GLM 兼容模型。支持字符串 ID，或包含 `id`、可选 `name`、token 上限、`toolCalling`、`thinking` 的对象。自定义 ID 会覆盖内置模型。图片仍然走当前视觉代理，不会绕过 proxy 变成 native vision                                                                                                                                       |
| `glm-copilot.debugMode`                      | `minimal`                                     | 诊断模式：`minimal` 仅上报 token 用量，`metadata` 输出隐私安全日志，`verbose` 将完整请求 dump 和 pipeline snapshot 写入扩展 global storage。完整 dump 可能包含敏感提示词文本、工具定义、文件片段和图片描述。使用 `GLM: 打开请求 Dump 目录` 打开 dump 位置                                                                                             |
| `glm-copilot.visionModel`                    | _(自动)_                                      | 当自动模式下 GLM-4.6V-Flash 不可用时，用作回退的 VS Code 视觉模型。请通过 `GLM: 配置视觉代理` 设置；新版保存为 `vendor/id`，旧版裸模型 ID 仍兼容读取                                                                                                                                                                                                  |
| `glm-copilot.visionPrompt`                   | _(内置)_                                      | 用于描述图片附件的提示词                                                                                                                                                                                                                                                                                                                              |
| `glm-copilot.experimental.stabilizeToolList` | `false`                                       | 实验性设置。尝试预先激活 VS Code/Copilot 的虚拟工具，让传给 GLM API 的 `tools` 参数在多轮对话中更完整、更稳定。当已启用工具跨轮次变化时，可能提高上下文缓存命中率。代价是 input tokens 可能增加；缓存命中的 input tokens 单价更低，但仍会计入用量。64 个或更少已启用工具时通常无需开启，除非工具列表仍在跨轮次变化；超过 128 个已启用工具时不建议开启 |

思考深度可通过 Copilot Chat 的模型选择器对每个 GLM 模型单独设置。

兼容 API 代理的 `settings.json` 配置示例：

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

## 方案对比

|                          | 本扩展      | 本地代理（如 LiteLLM） | 独立 GLM 扩展 |
| ------------------------ | ----------- | ---------------------- | ------------- |
| 在 Copilot Chat 内使用   | ✅          | ✅                     | ❌ 独立界面   |
| Agent 模式、工具、Skills | ✅          | ✅                     | ⚠️ 自行实现   |
| 视觉支持                 | ✅ 代理模式 | ❌                     | ❌            |
| 无需额外运行进程         | ✅          | ❌                     | ✅            |
| 一键安装                 | ✅          | ❌                     | ✅            |
| API Key 存系统密钥链     | ✅          | ❌                     | ⚠️ 各异       |

## 致谢

本项目参考了 [Vizards/deepseek-v4-for-copilot](https://github.com/Vizards/deepseek-v4-for-copilot)、[KiwiGaze/glm-for-copilot](https://github.com/KiwiGaze/glm-for-copilot) 和 [selfagency/z-models-vscode](https://github.com/selfagency/z-models-vscode) 的思路与实现模式。感谢原作者；如涉及再分发或派生使用，应按原项目 MIT License 要求保留相应版权与许可声明。

## 许可证

[MIT](LICENSE)
