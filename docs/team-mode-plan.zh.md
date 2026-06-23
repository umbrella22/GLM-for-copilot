# Team Mode 设计计划

本文记录 GLM for Copilot 的自定义编排方案。目标是在 Copilot Chat 不透明编排之外，提供一个项目级、可审计、可热重载、可 Git 追踪的 GLM team mode。

## 背景

当前扩展已经完成这些基础能力：

- 在 Copilot Chat 模型选择器中暴露 GLM-5.2、GLM-4.6V-Flash、GLM-5-Turbo。
- 通过透明视觉代理将图片任务优先交给 GLM-4.6V-Flash。
- 在 provider 层接管 VS Code `LanguageModelChatProvider` 请求，并转换为 GLM Chat Completions 请求。
- 支持工具调用、thinking、debug dump、usage/cost 估算、状态栏展示。

Copilot 自身的请求编排对扩展不可见。Team Mode 的目标不是替换 Copilot Agent，而是在 GLM provider 内增加一层可配置的、面向项目的编排规则。

## 业界参考

| 工具        | 文件                                   | 作用                     |
| ----------- | -------------------------------------- | ------------------------ |
| Cursor      | `.cursorrules` / `.cursor/rules/*.mdc` | 项目级指令，运行时可编辑 |
| Claude Code | `CLAUDE.md`                            | 项目记忆，递归向上查找   |
| Cline       | `.clinerules`                          | 工作流规则               |
| Aider       | `.aider.conf.yml` + conventions        | 项目约定                 |

本方案进一步扩展：`.glm/team.md` 不只注入 system prompt，还声明有限的编排逻辑，例如谁负责规划、谁负责执行、何时启用、如何展示编排过程。

## 目标

- 使用项目内 Markdown 文件声明 team mode。
- 支持运行时编辑，保存后下一次请求生效。
- frontmatter 给扩展代码解析，正文给模型阅读。
- 允许 director 模型生成简短执行计划，executor 模型执行最终响应。
- 保持 Copilot 工具调用链路不变，仍由最终 executor 通过 `LanguageModelToolCallPart` 交给 Copilot 执行。
- 在 Chat 中透明展示 team mode 状态，例如 director 生成了多少个子任务、executor 使用哪个模型。
- 保持零运行时依赖，不引入 YAML/Markdown 解析库。
- 支持 debug dump、usage/cost 估算、vision proxy、tool flow 的现有能力。

## 非目标

- 不实现完整独立 Agent Runtime。
- 不在 director 阶段执行 Copilot 工具。
- 不用 Webview GUI 作为第一版配置入口。
- 不解析正文中的自然语言来决定模型路由。正文只作为模型指导语义。
- 不绕过 Copilot 的工具执行机制。

## 推荐文件格式

默认文件：

```text
.glm/team.md
```

建议格式：

```md
---
enabled: true
mode: plan-execute
director: glm-5.2
executor: glm-5-turbo
vision: auto
max_subtasks: 5
triggers: main-agent
notice: true
---

# Team Policy

Director 负责拆解复杂任务，输出可执行的短计划。
Executor 按计划执行，优先保持小步改动、少量文件变更、及时验证。
遇到视觉输入时，继续使用 GLM-4.6V-Flash 视觉代理。
```

### Frontmatter 字段

| 字段           | 类型        | 默认值           | 说明                                      |
| -------------- | ----------- | ---------------- | ----------------------------------------- |
| `enabled`      | boolean     | `false`          | 是否启用 team mode                        |
| `mode`         | string      | `prompt-only`    | 编排模式：`prompt-only` 或 `plan-execute` |
| `director`     | model id    | `glm-5.2`        | 规划模型                                  |
| `executor`     | model id    | 当前用户选择模型 | 执行模型                                  |
| `vision`       | string      | `auto`           | 视觉策略。第一版保持 `auto`               |
| `max_subtasks` | integer     | `5`              | director 最多生成的子任务数               |
| `triggers`     | string/list | `main-agent`     | 触发范围，例如 `main-agent`               |
| `notice`       | boolean     | `true`           | 是否在 Chat 中展示编排状态                |

### 解析约束

- 只支持固定字段的 YAML 子集。
- 不支持任意嵌套对象。
- 不支持锚点、引用、多文档 YAML。
- 字段值需要经过白名单校验。
- 未识别字段可以忽略并写入 debug log。
- 正文不参与代码层路由，只注入给模型作为 team policy。

这样可以保持零依赖，并避免将 Markdown 正文变成不可控的执行配置。

## 加载与热重载

新增 `src/provider/team/` 模块，负责：

- 查找 `.glm/team.md`。
- 解析 frontmatter 和正文。
- 缓存解析结果。
- 使用 `vscode.workspace.createFileSystemWatcher` 监听文件变化。
- 保存后下一次 provider 请求使用最新配置。
- 在 extension dispose 时释放 watcher。

### 查找策略

第一版建议：

1. 优先从当前活动编辑器文件所在目录向上查找 `.glm/team.md`。
2. 找到 workspace root 即停止。
3. 如果没有活动编辑器，使用当前 workspace folder 下的 `.glm/team.md`。
4. 多 root workspace 中，以当前文件所属 workspace folder 为准。
5. 如果仍无法确定，则禁用 team mode。

需要注意：`LanguageModelChatProvider` 的输入不一定包含当前文件 URI，因此“递归向上查找”只能做到 best-effort。`vscode.window.activeTextEditor?.document.uri` 可以作为第一版启发式来源。

### Workspace Trust

`.glm/team.md` 会影响模型行为，应只在受信任工作区自动启用：

- `vscode.workspace.isTrusted === true` 时自动加载。
- 未信任工作区中默认禁用，后续可增加显式确认。

## 请求流水线

当前主要链路位于：

- `src/provider/index.ts` 的 `provideLanguageModelChatResponse`
- `src/provider/tools/flow.ts` 的 `processToolFlow`
- `src/provider/request.ts` 的 `prepareChatRequest`
- `src/provider/stream.ts` 的 `streamChatCompletion`

推荐改造后的流水线：

```text
provideLanguageModelChatResponse
  -> resolveConversationSegment
  -> classifyProviderRequest
  -> dumpProviderInput
  -> processToolFlow
  -> processTeamFlow
  -> prepareChatRequest
  -> streamChatCompletion
```

### Provider 层职责

Provider 层负责真正的编排：

- 判断 team mode 是否启用。
- 判断当前请求是否适合 team mode。
- 必要时调用 director 模型生成计划。
- 通过 `progress.report()` 立即展示 team notice。
- 决定 executor 模型。
- 将 team policy / director plan 传给 `prepareChatRequest`。

### prepareChatRequest 层职责

`prepareChatRequest` 继续保持请求组装职责：

- 处理 API key、base URL、max tokens。
- 处理 vision proxy。
- 转换 VS Code messages 到 GLM messages。
- 准备 tools。
- 注入 team policy / director plan。
- 使用 team flow 传入的 executor model 作为实际 API model。
- 继续进行 request dump、cache diagnostics、pricing metadata。

如果只是做 `prompt-only` 模式，team prompt 可以只在这里注入。  
如果做 `plan-execute` 模式，director 调用不应放在这里。

## Team Flow 模式

### prompt-only

不额外调用 director。扩展只读取 `.glm/team.md` 正文，并将其作为 team policy 注入最终 GLM request。

适用场景：

- 项目约定。
- 编码风格。
- 简单工作流偏好。
- 不希望增加额外延迟和成本的用户。

### plan-execute

先用 director 生成短计划，再将计划注入 executor 的最终请求。

建议行为：

1. director 使用 `glm-5.2`。
2. director 不接收工具列表。
3. director 请求设置 `tool_choice: none`。
4. director 输出结构化短计划，不输出长推理过程。
5. executor 使用 `glm-5-turbo` 或配置中的模型。
6. executor 正常接收 Copilot tools，并通过原有 stream path 返回工具调用。

Director 输出建议：

```md
1. 确认相关文件和现有实现。
2. 修改 provider 层接入 team flow。
3. 增加 team notice 过滤。
4. 添加基础验证。
5. 更新文档。
```

不建议展示或保存 director 的 chain-of-thought。只展示短计划摘要。

## 消息注入策略

Team mode 注入内容建议包含两部分：

```text
<glm-team-policy>
来自 .glm/team.md 正文。
</glm-team-policy>

<glm-team-plan>
来自 director 的短计划，仅 plan-execute 模式存在。
</glm-team-plan>
```

注入位置建议：

- 保留 Copilot 原始系统/开发者指令在最前。
- 将 team policy 追加到首个 GLM message 末尾，或作为紧随其后的 system message。
- 避免将 team policy 作为普通用户最新消息，防止模型误判用户意图。

当前 `convertMessages` 对 VS Code 内部 system role 的支持有限，因此第一版可在转换成 GLM messages 后做注入。后续可以补充显式 system role 处理。

## Notice 设计

新增 team notice marker：

```text
[glm-copilot-team-notice-start]: #
[glm-copilot-team-notice-end]: #
```

展示示例：

```md
[glm-copilot-team-notice-start]: #

> [team] director(glm-5.2) 已生成 5 个子任务，交由 executor(glm-5-turbo) 执行。

[glm-copilot-team-notice-end]: #
```

实现要求：

- 复用 `src/provider/tools/notices.ts` 的模式。
- `filterProviderNotices()` 必须剥离 team notice。
- notice 可以在 director 开始、director 完成、executor 开始时发出。
- 第一版至少发出 director 完成和 executor 模型选择信息。

## 工具调用边界

Director 不直接执行 Copilot 工具。

原因：

- Copilot 工具执行由 VS Code/Copilot Chat 根据 `LanguageModelToolCallPart` 处理。
- 内部 director 调用如果产生 tool call，扩展没有完整工具 runtime 去执行它。
- 将 director 工具调用暴露给 Copilot 又会打乱 executor 的最终工具循环。

因此：

- director 请求禁用 tools。
- executor 请求保留原有 tools。
- 只有 executor stream 可以向 Copilot 报告 `LanguageModelToolCallPart`。

## Tool Result 轮次与 Team State

Copilot Agent 执行工具后会再次调用 provider，并带回 tool result。Team mode 必须避免每个 tool result 都重新规划。

第一版策略：

- 当请求尾部包含 tool result 时，不重新调用 director。
- 继续使用上一轮 team policy。
- 如能从 replay marker 读取上一轮 plan，则复用。
- 无 plan 时降级为 prompt-only。

后续可扩展：

- 在 replay marker metadata 中增加 team plan。
- 记录 `teamPlanText`、`directorModelId`、`executorModelId`。
- 让多轮工具执行共享同一份计划。

## Usage 与费用统计

现有费用统计位于：

- `src/provider/pricing/usage.ts`
- `src/provider/pricing/status.ts`
- `src/provider/stream.ts`

Team mode 需要处理两类费用：

1. director 规划调用费用。
2. executor 最终响应费用。

第一版最低要求：

- executor 使用实际模型的 `ModelDefinition` 做费用估算。
- 如果用户选择 GLM-5.2，但 executor 被配置为 GLM-5-Turbo，状态栏应显示 GLM-5-Turbo 的单轮费用。

后续增强：

- director 调用返回 usage 时，也计入 session total。
- status tooltip 中拆分显示 director/executor。
- Copilot usage data part 中加入 team cost metadata。

## Debug Dump

Team mode 应补充 debug 信息：

- 是否启用 team mode。
- 命中的 `.glm/team.md` 路径。
- frontmatter 解析结果。
- executor model override。
- director 是否运行。
- director plan 摘要。
- team notice 是否发出。

在 verbose dump 中，应能看到最终注入后的 GLM request。

## 安全与容错

需要处理这些情况：

- `.glm/team.md` frontmatter 解析失败：禁用 team mode，并发出 warning log。
- 模型 ID 不在内置模型列表：忽略 override 或降级到当前模型。
- director 调用失败：降级为 prompt-only 或直接继续普通请求。
- 未信任工作区：禁用 team mode。
- 无 workspace folder：禁用 team mode。
- 文件过大：限制读取大小，例如 64 KB。
- 正文为空：只使用 frontmatter 路由，不注入 policy。

## 建议模块结构

```text
src/provider/team/
  index.ts
  config.ts
  parser.ts
  service.ts
  flow.ts
  notices.ts
  types.ts
```

职责划分：

- `parser.ts`：解析 frontmatter 和正文。
- `config.ts`：默认值、schema 校验、模型 ID 校验。
- `service.ts`：查找文件、缓存、FileSystemWatcher、workspace trust。
- `flow.ts`：provider 层 team 编排逻辑。
- `notices.ts`：生成 team notice。
- `types.ts`：共享类型。

## 分阶段实施

### Phase 1：纯 Markdown 配置与 prompt-only 注入

目标：

- 新增 `.glm/team.md` 读取与解析。
- 新增 FileSystemWatcher 热重载。
- 新增 team policy 注入。
- 新增 team notice marker 和过滤。
- 不做 director 额外调用。

验收：

- 修改 `.glm/team.md` 后下一次请求生效。
- Chat 中出现 team notice。
- 下一轮请求不会包含上一轮 team notice。
- Debug dump 中能看到 team policy 注入。
- 未配置 `.glm/team.md` 时行为与现在一致。

### Phase 2：executor 模型路由

目标：

- 支持 frontmatter 中的 `executor`。
- `prepareChatRequest` 可接收实际 executor model override。
- usage/cost 按 executor 模型计算。

验收：

- 用户选择 GLM-5.2，但 `executor: glm-5-turbo` 时，实际请求 model 为 GLM-5-Turbo。
- 状态栏费用按 GLM-5-Turbo 估算。
- modelIdOverrides 对 executor 同样生效。

### Phase 3：director 计划生成

目标：

- 支持 `mode: plan-execute`。
- provider 层在主请求前调用 director。
- director 使用 no-tools 请求。
- director 输出短计划并注入 executor 请求。
- Chat notice 展示 director/executor 过程。

验收：

- director 失败时可降级，不影响普通请求。
- executor 仍能正常 tool call。
- director plan 不作为普通用户消息出现。
- cost/status 能至少准确统计 executor，后续统计 director。

### Phase 4：跨工具轮次复用 team plan

目标：

- 扩展 replay marker metadata。
- tool result 轮次复用上一轮 plan。
- 避免每次工具返回后重新 director 规划。

验收：

- Agent 工具循环中只在用户新任务开始时规划。
- 多轮 tool result 共享同一 team plan。
- marker 无效时能降级。

### Phase 5：可选 GUI

目标：

- 后续如果面向非技术用户，可增加 Webview 编辑器。
- GUI 直接编辑同一个 `.glm/team.md` 文件。
- 仍以 Markdown 文件作为唯一真实来源。

验收：

- GUI 和手写 Markdown 不产生双状态。
- Git 中仍能追踪所有 team mode 配置。

## 开放问题

- 是否只支持单个 `.glm/team.md`，还是同时支持 `.glm/team/*.md`。
- 多 root workspace 中，Chat 没有明确文件上下文时选择哪个 root。
- director plan 是否需要进入 replay marker 第一版。
- 是否提供命令 `GLM: Create Team Mode File`。
- 是否在 README 中暴露该实验能力，还是先只放 docs。

## 当前推荐结论

第一版建议从纯 Markdown + prompt-only 开始，先完成文件格式、热重载、notice、注入链路和安全边界。  
第二版再加入 executor 模型路由。  
第三版实现真正的 director -> executor 计划执行。

这个顺序可以保证每一步都可验证、可回退，并且不会破坏现有 vision proxy、tool flow、usage/cost 和 debug dump。
