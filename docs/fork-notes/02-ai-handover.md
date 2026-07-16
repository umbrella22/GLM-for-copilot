# Fork 上下文交接文档(AI 会话用)

> **本文档供新的 AI 会话或维护者快速接手本 fork 项目。** 阅读本文档即可掌握 fork 的全部改动、设计决策、踩过的坑、后续开发要点。
>
> 仓库:本 fork(基于 [`umbrella22/GLM-for-copilot`](https://github.com/umbrella22/GLM-for-copilot) 的二次开发)
> 合并基点:上游 `53f38c6`(v0.5.1 + model manager 大重构)
> 工作分支:`merge-upstream-0.5.1`(已合并所有 fork 特性)

---

## 一、项目本质

这是 `umbrella22/GLM-for-copilot` 的 fork,在最新上游基础上增加了 **MCP 能力扩展** 和 **视觉处理三态模式**。上游是把 GLM 模型接入 VS Code Copilot Chat 的插件(BYOK),fork 在此之上让 GLM 模型能调用官方 MCP 服务、支持"纯文本模型走 Anthropic 接口 + MCP 处理图片"的场景。

### 关键文档
- 解耦守则:同目录下 `03-fork-decoupling-rules.md`(必读)
- 给上游的提案:同目录下 `01-mcp-proposal-for-upstream.md`
- 快速上手:同目录下 `04-quickstart.md`
- 上游对照:克隆 `umbrella22/GLM-for-copilot` 最新 main 作只读参考

---

## 二、Fork 改动全景(相对上游)

共 11 个提交,31 文件,+1395/-55 行。改动按解耦守则分为 A/B/C/D 四类。

### A 类:纯新增(零冲突,核心价值)

| 文件 | 作用 |
|------|------|
| `src/mcp/*`(9 文件) | GLM 官方 MCP server provider(ZAI/web-search/web-reader/zread) |
| `src/runtime/mcp.ts` | MCP 注册入口 |
| `src/provider/vision/image-store.ts` | 图片持久化到磁盘(mcp visionMode 用,MCP 工具按路径读取) |

### B 类:配置/注入追加(低冲突)

| 文件 | 改动 |
|------|------|
| `package.json` | `mcpServerDefinitionProviders` 声明 + `mcp.servers` + 4 个开关 + `imageHandlingPrompt`/`imageStoredPrompt` 配置 |
| `package.nls*.json` | 上述配置的中英文描述 |
| `runtime/lifecycle.ts` | 注册 MCP + 初始化 image store(独立 try/catch) |
| `provider/index.ts` | `authManager` 从 `private` 改 `readonly`(1 行,MCP 复用 BYOK key) |
| `runtime/commands.ts` | 新增 `glm-copilot.resetToDefaults` 重置命令 |

### C 类:核心解耦点(需重点维护)

| 文件 | 改动 | 说明 |
|------|------|------|
| `types.ts` | `ModelVisionMode` 加 `'mcp'` 成员 | 第三种视觉模式 |
| `types.ts` | ModelDefinition 加 `defaultApiModelId` 字段 | 让内置模型能指定 API ID |
| `config.ts` | `normalizeModelVisionMode` 接受 mcp | |
| `config.ts` | `getApiModelId` fallback 到 `defaultApiModelId` | |
| `provider/vision/resolve.ts` | **单点 early-return 钩子**:mcp 分支剥离图片存盘 | 入口解决,不改 proxy/native |
| `provider/request.ts` | mcp 模式**每轮无条件**注入 imageHandlingPrompt(为 prompt cache 前缀稳定性,见坑7) | |
| `manager/ui/{types,strings,script}.ts` + `i18n.ts` | 模型管理面板暴露 mcp 选项 | |
| `consts.ts` | glm-5.2/glm-5-turbo 加 `defaultVisionMode:'mcp'`;glm-5.2 加 `defaultEndpointRoute:'china-anthropic'`;新增内置模型 glm-claude-opus-4.8(走 china-anthropic);解除 5v-turbo 路由限制 | |
| `manager/state.ts` | `validateDraft` + `visionModeLabel` + `getAllowedRoutes` 支持 mcp | |

### D 类:已放弃的旧 fork 实现(用上游超集替代)
- 旧的 `GLMContentPart` 合并类型 → 上游 `GLMTextContentPart`/`GLMImageContentPart` + `glm-content.ts`
- 旧的 `convert.ts` `dataPartToDataUrl` → 上游 `createGLMImageContentPart`
- 旧的 `classifier.ts` `glmContentToString` → 上游 `getGLMContentText`
- 旧的 `anthropic/convert.ts` `contentToString`(图片变 `[image]` 丢图)→ 上游 `convertContentBlocks`(真 image block)
- 旧的全局 `visionStrategy` 配置 → 上游每模型 `visionMode`

---

## 三、核心设计决策(必须理解)

### 1. 视觉处理三态模式(fork 的灵魂)

```
visionMode = 'proxy'  → 上游原有:图片经 GLM-4.6V-Flash 代理转文字
visionMode = 'native' → 上游原有:图片缩放后 base64 直送 API
visionMode = 'mcp'    → fork 新增:图片剥离存盘,留文件路径提示,MCP 工具按需读取
```

**mcp 模式的存在意义**:支持"纯文本模型走 Anthropic 接口"的场景。典型:`glm-claude-opus-4.8`(实际 API 是 `claude-opus-4.8`,文本模型),走 china-anthropic 线路。这种模型:
- 不能塞 base64(模型不认识,浪费上下文)
- 不能走 proxy(需要默认禁用代理)
- 只能把图片存盘,让 MCP 视觉工具(如 ZAI 的 analyze_image)读取后返回文字描述

**关键**:mcp 模式在数据流**入口**(`resolveImageMessages`)就剥离图片,下游 convert 看到的全是文字,因此不需要改任何 convert 文件。这是解耦守则"入口解决"的范例。

### 2. 内置模型 vs 配置注入(踩过大坑)

**上游的 `inspectModelManagementConfiguration` 只读 global/workspace/folder 三个 scope,完全不读 package.json 的 `default` 字段**。所以:
- ❌ 在 package.json 的 `modelManagement.default` 里写 visionMode/customModels → 运行时无效
- ✅ 内置模型写在 `consts.ts` 的 `MODELS` 数组 → 运行时生效,且重置后保留

因此 fork 的三个关键模型都是**内置模型**:
- `glm-5.2`:加 `defaultVisionMode: 'mcp'` + `defaultEndpointRoute: 'china-anthropic'`(默认走国内 Anthropic 端点,重置后保留)
- `glm-5-turbo`:加 `defaultVisionMode: 'mcp'`
- `glm-claude-opus-4.8`:新增内置模型(走 china-anthropic,mcp 模式,defaultApiModelId='claude-opus-4.8')

### 3. imageInput 能力声明的真正语义(踩过大坑)

`imageInput` 这个能力声明,对 Copilot 的语义是**"用户能不能在输入框拖图片"**,而不是"模型能不能直接吃 base64"。
- `imageInput: false` → Copilot 在输入框就拦截图片,mcp 流程根本无法触发
- `imageInput: true` → 允许发图,然后由 visionMode 决定怎么处理

**所有需要走 mcp 流程的模型,必须 `imageInput: true`**(即使是文本模型)。glm-claude-opus-4.8 必须 true。

### 4. 提示词注入时机(踩过大坑,且踩过反向的坑)

`imageHandlingPrompt`(MCP 工具引导提示词)的注入有**两个边界**,别混为一谈:
- **模式边界**:**只在 mcp 模式注入**;proxy/native **永不注入**(那里图片已转文字/base64,注入是噪声,且破坏上游请求结构断言)。
- **轮次边界**:**mcp 模式内必须每轮无条件注入**(即使本请求无图)。⚠️ 不要“优化”成“仅当本请求有图才注入”——那会**打断 prompt cache**:缓存按 system 前缀字节精确匹配,注入在有图/无图轮次间翻转 → 前缀哈希反复变 → 每次翻转整段对话缓存失效。无条件注入让它成为恒定前缀,多轮持续命中缓存。详见坑7。

### 5. MCP 的 API Key 注入

MCP 服务复用 `authManager` 的 BYOK key,通过 `china-coding` 凭证通道获取(`mcp/resolve.ts` 的 `authManager.getApiKey('china-coding')`)。上游重构了 4 通道认证,getApiKey 现在必须传 credentialChannel 参数。

---

## 四、踩过的坑(必读,避免重蹈)

### 坑1:扩展枚举值要 grep 所有硬编码比较
给 `ModelVisionMode` 加 `'mcp'` 时,只改了类型定义和显眼的使用点,遗漏了 `state.ts` 的 `validateDraft`(保存报"图片处理方式无效")、`visionModeLabel`(显示错误)、`updateVisionHint`(提示错误)。

**规则**:给任何 `type X = 'a'|'b'` 加 `'c'` 时,必须 grep 所有 `=== 'a'`/`=== 'b'`/`case 'a'` 比较。详见解耦守则"二(补)"。

### 坑2:package.json default 不被运行时读取
上游 `modelManagement` 的 inspect 链不读 default 字段。详见上文"核心设计决策2"。判定方法:grep `inspect` 的返回值是否解构了 `defaultValue`。

### 坑3:imageInput 语义误解
详见上文"核心设计决策3"。

### 坑4:提示词注入范围
详见上文"核心设计决策4"。

### 坑5:replace 操作误删相邻代码
一次 replace 的 oldString 上下文不够精确,误删了整个 glm-claude-opus-4.8 模型定义。**教训**:replace 的 oldString/newString 必须包含足够上下文(前后 3-5 行),且改完后立即 grep 确认关键内容还在。

### 坑6:中文路径 + git
Windows + git + 中文路径:`git add 中文路径/` 会静默失败。本仓库路径是纯 ASCII,无此问题。但 `git diff` 输出中文可能显示乱码(GBK),实际文件内容是 UTF-8 正确的。

### 坑7:system 提示词“条件注入”会打断 prompt cache
一度把 `imageHandlingPrompt` 优化为“仅当本请求有图才注入”,以为能减少噪声。结果破坏了 system 前缀的字节稳定性:多轮里只要某轮带图、某轮不带,前缀哈希就反复变化,每次翻转都让整段对话缓存失效。**教训**:注入到 system 消息的提示词,在生效范围内必须每轮无条件常驻(让它是恒定缓存前缀);“模式间不注入(proxy/native)”与“模式内无条件(mcp 每轮)”是两回事,别混为一谈。

### 坑8:同步内置模型 token 后要同步 models.test.ts
把 glm-claude-opus-4.8 的 `maxInputTokens` 从 1_000_000 改成 868_928(对齐 GLM-5.2)后,漏改 `test/provider/models.test.ts` 里硬编码的窗口和断言(`1_131_072`),导致测试静默失败。**教训**:改任何内置模型的 token(或会进 picker 的字段),必须同步 `models.test.ts` 的 `maxInputTokens + maxOutputTokens` 数组断言。

---

## 五、测试情况

- `tsc --noEmit`:零错误
- `npx vitest run`:246/246 通过
- fork 改动同步更新了 15 个上游测试(全部加 `[FORK]` 标记),反映 fork 新行为

### 测试改动要点
- `config.test.ts`:glm-5.2 默认 proxy → mcp;5v-turbo 路由限制解除;“applies global baseUrl” 测试改用 glm-5-turbo 作 default 路由示例(glm-5.2 现走 china-anthropic,不再是 default 路由)+ 新增 glm-5.2→china-anthropic 断言
- `models.test.ts`:MODELS 数组新增第 5 个(glm-claude-opus-4.8);5v-turbo 删 supportedApiModes;glm-claude-opus-4.8 窗口和 1_131_072 → 1_000_000(token 对齐 GLM-5.2)
- `state.test.ts`:5v-turbo allowedRoutes 全放开;glm-5.2 reset 后是 mcp
- `request.test.ts`:5v-turbo coding-plan 从"拒绝"改"接受"

---

## 六、[FORK] 标记规范

所有 fork 改动用 `// [FORK]` 标记,便于未来合并时识别:
```typescript
readonly authManager: AuthManager; // [FORK] exposed for MCP BYOK reuse

// [FORK] mcp mode: strip images from the request...
if (visionMode === 'mcp') { ... }
```

搜索 fork 改动点:在仓库根目录搜索 `[FORK]`(当前约 10 处)。

---

## 七、后续开发要点

### 添加新内置模型
在 `consts.ts` 的 `MODELS` 数组加一项。注意:
- 需要走 mcp 图片流程的模型:`imageInput: true` + `defaultVisionMode: 'mcp'`
- 需要不同 API ID:用 `defaultApiModelId` 字段(如 glm-claude-opus-4.8 → claude-opus-4.8)
- 默认线路:`defaultEndpointRoute`(如 'china-anthropic')

### 添加新 MCP 服务
1. `src/mcp/builtin.ts` 加服务定义
2. `src/mcp/consts.ts` 加配置键
3. `package.json` 加 `mcp.<服务名>.enabled` 开关 + nls 描述
4. `package.json` 的 `mcp.servers.default` 加默认配置

### 跟进上游更新
1. `git fetch upstream`(指向 `umbrella22/GLM-for-copilot`)
2. 评估冲突:`git diff upstream/main..HEAD --name-only` 找双方都改的文件
3. 按 A/B/C/D 分类处理(详见解耦守则)
4. 合并前后建议打 tag 备份
5. 合并后:搜索 `[FORK]` 确认所有改动点保留 + tsc + vitest

### 重置命令的作用
`glm-copilot.resetToDefaults` 清除用户级覆盖,让默认值生效。重置范围:modelManagement + stabilizeToolList + mcp.* + 提示词配置。**不清除 API Key,不动 workspace 级配置**。

---

## 八、提交说明

所有 fork 改动集中在 `merge-upstream-0.5.1` 分支,从上游 `53f38c6`(v0.5.1 + model manager 重构)分叉。提交按 MCP 模块 → 配置 → 视觉模式 → 模型路由 → UX 的顺序组织,每个提交信息遵循 conventional commits 规范。详见 `git log upstream/main..HEAD`。

---

## 九、未决事项 / 可改进点

1. **MCP getApiKey 硬编码 china-coding**:当前 MCP 服务固定从 `china-coding` 通道取 key。国际用户可能需要从 international 通道取。可改为根据默认连接自动选择,或加配置项。
2. ~~**mcp visionMode 的 imageHandlingPrompt 注入**~~ **[已否决 2026-07-16]**:曾想“仅当本请求有图才注入”,评估后否决——会打断 prompt cache(见坑7)。**结论:mcp 模式内保持每轮无条件注入**,只有 proxy/native 永不注入。无需再动。
3. ~~**glm-claude-opus-4.8 的定价**~~ **[已完成 2026-07-16]**:已补 pricing/priceCategory 并与 GLM-5.2 完全对齐(CNY/USD/priceCategory/capabilities/token/thinking 全一致,差异仅 id 与通道)。同时修了 models.test.ts 窗口断言(见坑8)。
4. **向原作者提交 MCP**:见 `01-mcp-proposal-for-upstream.md`,可拆分 MCP provider 部分单独提 PR。
5. **glm-5.2 默认走 china-anthropic**:已给 glm-5.2 加内置 `defaultEndpointRoute:'china-anthropic'`(重置后保留)。⚠️ 待验证:Zhipu 的 `/api/anthropic` 网关是否接受 `glm-5.2` 这个模型 id(走 Anthropic 协议);若不认需回退或改用别名。glm-claude-opus-4.8 同端点能工作(它发 `claude-opus-4.8`)。

---

*本文档随 fork 演进持续更新。新增改动请同步更新对应章节,并在提交信息里引用本文档。*
