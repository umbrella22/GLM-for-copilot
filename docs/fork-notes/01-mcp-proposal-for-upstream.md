# 给上游作者的功能提案:GLM 官方 MCP Server 集成

> 本文档面向 [`umbrella22/GLM-for-copilot`](https://github.com/umbrella22/GLM-for-copilot) 的维护者,作为提交 MCP 能力的功能说明。
>
> 目标:让 Copilot Chat 中的 GLM 模型能够直接调用 GLM 官方提供的 MCP 服务(视觉识别、网页搜索、网页抓取、深度阅读),无需用户额外配置即可开箱即用。

---

## 一、为什么需要这个功能

当前 GLM-for-copilot 通过 `LanguageModelChatProvider` 把 GLM 模型接入 Copilot Chat,但仅提供文本对话能力。GLM 官方(z.ai / bigmodel.cn)已经开放了一批高质量 MCP 服务:

| 服务 | 能力 | 传输 |
|------|------|------|
| `@z_ai/mcp-server`(ZAI) | 聚合 MCP,含视觉识别、图像分析等 | stdio |
| web-search-prime | 官方网页搜索 | http |
| web-reader | 官方网页内容抓取 | http |
| zread | 官方深度阅读(代码库/文档/网页结构化解析) | http |

这些服务目前用户需要**自行在外部配置**才能在 Copilot Chat 里用。本提案把它们作为**插件内置的 MCP server definition provider**注册,用户启用插件即自动可用,并可按需开关。

## 二、实现方案概述

利用 VS Code 的 `McpServerDefinitionProvider` API(需 `mcpServerDefinitionProviders` contribution point),在插件激活时注册一个 provider,向 Copilot 暴露内置 GLM MCP 服务。

### 核心架构(完全独立的新增模块)

```
src/mcp/                      ← 全新目录,不修改任何上游已有文件
├── provider.ts               McpServerDefinitionProvider 实现
├── builtin.ts                内置服务定义(ZAI/web-search/web-reader/zread)
├── config.ts                 读取/写入用户 MCP 配置
├── merge.ts                  内置服务 + 用户自定义服务的合并
├── build.ts                  构造 vscode.McpServerDefinition
├── resolve.ts                懒加载注入 API Key(resolve 阶段)
├── consts.ts                 配置键名常量
├── types.ts                  McpServerConfig 类型
└── index.ts                  统一导出
```

**关键设计:零侵入上游核心代码**。整个 MCP 模块是独立的 A 类新增,只在 2 个地方与上游代码有最小接触:

1. `provider/index.ts`:`authManager` 字段从 `private` 改为 `readonly`,让 MCP 模块复用已配置的 BYOK API Key(用户无需为 MCP 单独填 key)
2. `runtime/lifecycle.ts`:在 `activate()` 里加一段独立的 try/catch 注册 MCP,**注册失败不影响模型对话**

## 三、用户视角的功能

### 开箱即用的 4 个服务

安装插件后,Copilot Chat 的工具配置(`workbench.action.chat.configureTools`)里会自动出现 4 个 GLM 官方服务,默认全部启用:

- 用户**无需配置**任何 MCP server 命令或 URL
- 用户**无需单独填** MCP 服务的 API Key(复用插件已保存的 GLM API Key)
- 用户可在插件设置里**逐个开关**每个服务

### 配置项

新增设置(全部为扁平的顶层配置,不污染 `modelManagement`):

```jsonc
// 每个服务的开关(默认全开)
"glm-copilot.mcp.zai-mcp-server.enabled": true
"glm-copilot.mcp.web-search-prime.enabled": true
"glm-copilot.mcp.web-reader.enabled": true
"glm-copilot.mcp.zread.enabled": true

// 高级:覆盖内置服务字段或新增自定义服务(默认为内置 4 个)
"glm-copilot.mcp.servers": { ... }
```

### BYOK Key 注入

MCP 服务复用插件已有的 API Key(通过 `authManager`),**不存储在 mcp.servers 配置里**——避免密钥泄露到 settings.json。注入发生在 `resolveMcpServerDefinition` 阶段(Copilot 实际要调用某服务时才注入,不在 provide 阶段读密钥)。

## 四、与现有视觉代理的关系(可选讨论点)

本 fork 还探索了一个 **MCP 视觉模式**作为 `visionMode` 的第三种取值(除 `proxy`/`native` 外):

- `proxy`(上游原有):图片经 GLM-4.6V-Flash 代理转文字
- `native`(上游原有):图片缩放后 base64 直送
- **`mcp`(新增)**:图片从请求中剥离,持久化到本地文件,消息里只留文件路径提示,由 MCP 视觉工具(如 ZAI 的 `analyze_image`)按需读取

`mcp` 模式对接了GLM codingPlan官方 MCP;避免使用免费的 GLM-4.6-flash 模型,同时官方MCP提供了对图片高级的处理,例如根据图片直接输出代码(实现复刻)
它通过在 `resolveImageMessages` 入口加一个 early-return 分支实现,不修改上游的 proxy/native 逻辑。

**这部分是可选的**——如果作者认为 `mcp` visionMode 超出范围,可以只采纳 MCP server provider 部分,visionMode 维持 proxy/native 两态。

## 五、改动清单(相对上游)

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/mcp/*`(9 文件) | **新增** | MCP server provider 模块 |
| `src/runtime/mcp.ts` | **新增** | 注册入口 |
| `src/provider/vision/image-store.ts` | **新增** | mcp visionMode 的图片存盘(可选) |
| `runtime/lifecycle.ts` | 修改 ~12 行 | 注册 MCP + 初始化 |
| `provider/index.ts` | 修改 1 行 | authManager 暴露 |
| `package.json` | 新增配置节 | mcpServerDefinitionProviders + mcp.* 配置 |
| `package.nls*.json` | 新增描述 | 中英文 |

**对上游核心逻辑的修改极小**(2 处,共约 13 行),且都在独立 try/catch 或单行字段调整里,不影响上游已有功能。

## 六、测试情况

- TypeScript 编译零错误(`tsc --noEmit`)
- 上游原有测试全部通过(246/246)
- MCP 模块逻辑独立,不与现有 provider/client/vision 耦合

## 七、采用的 API 与兼容性

- `vscode.McpServerDefinitionProvider`(proposed API,需声明 contribution point)
- `vscode.McpServerDefinition` / `McpStdioServerDefinition` / `McpRemoteServerDefinition`
- 需要 VS Code 1.116+(与现有 engines 要求一致)

## 八、希望得到反馈的点

1. **内置服务列表**:当前内置 ZAI/web-search-prime/web-reader/zread,是否有遗漏或需要调整?
2. **默认启用**:4 个服务默认全开是否合理?还是应该默认关闭让用户主动开?
3. **mcp visionMode**:是否纳入?还是 MCP provider 单独合并,visionMode 维持两态?
4. **Key 注入时机**:目前复用 authManager 的 BYOK key,作者是否倾向让 MCP 服务独立配 key?

---

*本提案代码已在 fork 仓库验证可用,可按需拆分提交。*
