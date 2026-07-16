# Fork 解耦守则

> 本守则用于指导 `GLM-for-copilot-qt`（基于 `umbrella22/GLM-for-copilot` 的二次开发）在未来跟进上游更新时，如何让 fork 改动与上游保持低冲突、易合并。
>
> 核心原则：**不为解耦而解耦**。如果某个改动只需修改上游 5~20 行就能实现，直接改；只有当改动会高频触及上游易变文件、或与上游逻辑强耦合时，才投入解耦设计。

---

## 一、改动分类决策树

在动手任何 fork 改动前，先用下面的决策树判断它属于哪一类，每类对应不同的解耦策略和维护成本：

```
我的改动属于哪一类？
│
├─ A 类：纯新增功能（全新文件 / 全新模块）
│   → 100% 解耦。放在独立目录，不修改上游任何已有文件。
│   → 上游更新时永不冲突。
│   → 维护成本：零。✅
│   → 范例：src/mcp/*（MCP server provider 模块）
│
├─ B 类：在上游文件里追加新函数 / 新配置项（不改已有逻辑）
│   → 解耦成本低。只在原文件末尾或配置节追加。
│   → 风险：上游重构该文件结构时仍会冲突，但通常是上下文冲突（好解决）。
│   → 策略：尽量集中到少数几个"低频变动"文件。
│   → 维护成本：低。⚠️
│   → 范例：image-store.ts、提示词配置项
│
├─ C 类：修改上游已有函数的行为（改签名 / 改分支逻辑）
│   → 最易冲突。先问：能不能用「包装器 / 钩子」替代「直接改主体」？
│   → 能：写独立钩子文件，原文件只加 1 处注入点（1 行调用）。
│   → 不能：接受这是"高维护成本点"，必须在 CHANGELOG-FORK 记录。
│   → 维护成本：中～高。🔴
│   → 范例：vision/resolve.ts 的 mcp 分支（单点 early-return 注入）
│
└─ D 类：替换上游的实现（fork 实现 vs 上游实现二选一）
    → 先判断：上游是否已是我的超集（功能更完整）？
    → 是：直接用上游，放弃我的。省心，且能持续享受上游改进。✅
    → 否：保留我的，但隔离到独立文件，通过 import 替换上游引用。⚠️
    → 范例：多模态类型（上游 GLMTextContentPart/GLMImageContentPart 是 fork 的超集，用上游）
```

### 关键判定指标

- **解耦收益**：能否让上游未来某文件的改动不再引发冲突？
- **解耦成本**：为达成解耦需要新增多少行代码？
- **判定公式**：如果解耦成本 > 上游该文件未来 N 次冲突的解决成本总和，则**不值得解耦**，直接改更划算。
- 经验阈值：解耦代码 **≤ 30 行** 且能消除一类高频冲突 → 值得；**> 100 行** 且只为消除偶发冲突 → 不值得。

---

## 二、本次合并实践的改动分类（作为参考案例）

| Fork 改动 | 类别 | 解耦方式 | 改动量 | 评估 |
|-----------|------|----------|--------|------|
| `src/mcp/*` + `runtime/mcp.ts` | **A** | 独立目录，零上游冲突 | 0（已完成） | ✅ 范例 |
| `provider/vision/image-store.ts` | **A** | 独立新文件 | 0 | ✅ |
| `lifecycle.ts` 注册 MCP + 初始化 image store | **B** | activate 里加 try/catch 块 | ~12 行 | ⚠️ 低成本 |
| `provider/index.ts` 暴露 authManager | **B** | `private` → `readonly` | 1 行 | ⚠️ 低成本 |
| `imageHandlingPrompt`/`imageStoredPrompt` 配置 | **B** | package.json 顶层追加 | 配置声明 | ⚠️ 低成本 |
| `mcp.servers` 配置 + 4 个开关 | **B** | package.json 顶层追加 | 配置声明 | ⚠️ 低成本 |
| `request.ts` 注入 imageHandlingPrompt | **B** | glmMessages 生成后 1 行调用 | ~5 行 | ⚠️ 低成本 |
| **vision 三态（proxy/native/mcp）** | **C** | resolve.ts 单点 early-return 钩子 | 注入 1 行 + 独立函数 ~60 行 | 🔴 核心解耦点 |
| `types.ts` 的 `ModelVisionMode` 加 mcp | **C** | 类型扩展 1 行 + config normalize 1 行 | 2 行 | 🔴 低成本 |
| `glm5.2-vscode` 默认模型预设 | **B** | package.json modelManagement.default | 配置声明 | ⚠️ 低成本 |
| ~~旧 fork 的多模态类型 GLMContentPart~~ | **D** | **放弃**，用上游 GLMTextContentPart 超集 | 0 | ✅ 省心 |
| ~~旧 fork 的 convert.ts dataPartToDataUrl~~ | **D** | **放弃**，用上游 createGLMImageContentPart | 0 | ✅ 省心 |

---

## 二(补)、扩展枚举值的完整清单检查法

> **教训**：当给一个已有类型新增枚举值时,必须搜索**所有**对该类型值的硬编码比较,而不是只改"显而易见"的几处。

本次给 `ModelVisionMode` 加 `'mcp'` 时,最初只改了 4 处(类型定义、config normalize、resolve 分支、UI 选项),结果手动测试时发现模型管理面板保存报"图片处理方式无效"。

实际遗漏了 3 处硬编码比较:
- `state.ts` 的 `validateDraft()` 校验函数(导致保存失败)
- `state.ts` 的 `visionModeLabel`(mcp 错误显示为"视觉代理")
- `script.ts` 的 `updateVisionHint`(mcp 错误显示代理提示)

### 检查清单(扩展枚举值时必做)

给任何 `type X = 'a' | 'b'` 新增 `'c'` 时,执行:

```bash
# 1. 搜索所有与旧值的比较
grep -rnE "=== 'a'|=== 'b'|== 'a'|== 'b'" src/
# 2. 搜索所有 "a" || "b" 形式的判断
grep -rnE "'a' \|\||'b' \|\|" src/
# 3. 搜索 switch case
grep -rnE "case 'a'|case 'b'" src/
```

对每个匹配点逐个判断:
- 是**校验逻辑**(如 validateDraft)→ 必须加新值
- 是**显示标签**(如 visionModeLabel)→ 必须加新值分支
- 是**条件行为**(如 diagnostics 只对 native 做特殊处理)→ 看新值是否需要该行为

### 反例(不要这么做):只改类型定义和"最显眼"的使用点,指望编译器报错来发现问题。TypeScript 对 `string === 'proxy'` 这种比较不会报错(因为字符串字面量比较永远合法),所以编译通过 ≠ 逻辑完整。

---

## 二(补2)、package.json 的 default 字段可能不被运行时读取

> **教训**：不要假设 VS Code 配置的 `package.json` default 值会被代码自动使用。上游代码可能只读 global/workspace/folder 三个用户 scope，故意绕开 default。

本次在 `modelManagement.default.models` 里写了 `glm-5.2: { visionMode: 'mcp' }`，重置配置后却发现 glm-5.2 仍然是 proxy。

**根因**：上游 `inspectModelManagementConfiguration` 只读 `inspection.globalValue / workspaceValue / workspaceFolderValue`，**完全不读 `inspection.defaultValue`**。effective 计算 = merge(global, workspace, folder)，不包含 package.json default。这是上游的设计——`modelManagement` 是"用户主动配置"的对象，default 只给 VS Code 设置 UI 展示用。

**正确的默认值注入位置**（按运行时读取优先级）：
1. 用户显式配置（modelManagement.models[id].visionMode）— 最高优先级
2. **模型定义的 `defaultVisionMode`（consts.ts 的 MODELS）** ← 这里是真正的兜底
3. 硬编码兜底（DEFAULT_GLM_VISION_MODEL_ID → native；其他 → proxy）

所以想让某模型默认 mcp，**必须改 consts.ts 的 `defaultVisionMode`**，写 package.json default 无效。

### 判定方法

想确认某个 package.json default 是否会被运行时读取，搜代码：
```bash
# 找读取该配置的入口函数
grep -rn "\.get<.*>('[配置键名]'" src/
grep -rn "\.inspect.*('[配置键名]')" src/
# 看 inspect 的返回值是否用了 defaultValue 字段
```
如果 inspect 结果只解构了 globalValue/workspaceValue/workspaceFolderValue 而忽略 defaultValue，那 default 就不参与运行时解析。

---

## 三、C 类解耦的黄金法则：入口解决，而非出口打补丁

> **在数据流的入口解决问题，不要在每个出口打补丁。**

本次 vision 三态是最典型的 C 类解耦。错误做法 vs 正确做法：

### ❌ 错误做法（旧 fork 的方式）：出口打补丁

在每个 convert 文件里分别处理 mcp：
- `provider/convert.ts` 加判断：如果是 mcp 模式，别转 base64
- `client/anthropic/convert.ts` 加判断：如果是 mcp 模式，别转 image block
- `routing/classifier.ts` 加判断：...

**后果**：每个 convert 文件都被改，上游重构任何一个都会冲突；且逻辑分散在 N 处，容易遗漏。

### ✅ 正确做法（本次的方式）：入口解决

在数据流最上游 `vision/resolve.ts` 的入口处，用一个 early-return 分支把图片剥离成文字：

```typescript
export async function resolveImageMessages(..., visionMode) {
    ...
    if (visionMode === 'native') {
        return prepareNativeImageMessages(...);  // 上游原有
    }
    // [FORK] 单点注入：mcp 模式在这里把图片全部变成文字提示
    if (visionMode === 'mcp') {
        return stripImagesForMcpMode(...);  // 独立函数，~60 行
    }
    // ↓ 下面的 proxy 逻辑完全是上游原样，永不冲突
    const markerBindings = ...;
}
```

**收益**：mcp 模式处理完后，传给下游 convert 的消息**已经不含任何图片 part**，全是文字。因此 `provider/convert.ts`、`anthropic/convert.ts`、`classifier.ts` **全部不需要改**——它们看到的就是普通文字消息。上游怎么重构这些 convert 文件，都与 fork 无关。

### 入口解决适用条件

- 数据流是单向的（请求 → resolve → convert → 发送）
- 在入口处理完，下游就不需要知道这个特殊态的存在
- 反例：如果某个特殊态需要同时影响请求和响应两条数据流，就不能单靠入口解决。

---

## 四、Fork 标记规范

为了让未来合并时一眼识别"哪些是 fork 改动"，所有 fork 改动必须用 `[FORK]` 标记：

```typescript
// 单行标记
readonly authManager: AuthManager; // [FORK] exposed for MCP BYOK reuse

// 多行块标记
// [FORK] MCP mode: strip images from the request, persist them to disk, and
// replace each image part with a short text prompt pointing to the file path.
if (visionMode === 'mcp') {
    return stripImagesForMcpMode(messages, token, stats);
}
```

**规则**：
1. 所有 fork 新增的 import 行，行尾加 `// [FORK]`
2. 所有 fork 新增的代码块，块前加 `// [FORK]` 注释说明意图
3. 所有 fork 修改的上游已有行，行尾加 `// [FORK]` 说明改了什么
4. fork 新增的独立文件，文件头注释里注明 `[FORK]`

这样未来合并时，`git diff upstream..HEAD` 搜 `[FORK]` 就能列出全部 fork 改动点。

---

## 五、上游更新跟进流程

当上游发布新版本时，按以下步骤跟进：

### 步骤 1：评估冲突范围
```bash
# 假设 fork 在 main 分支，上游在 upstream remote
git fetch upstream
git diff upstream/main..HEAD --name-only > /tmp/fork-changes.txt
git diff <fork基点>..upstream/main --name-only > /tmp/upstream-changes.txt
# 找交集（双方都改的文件 = 潜在冲突）
```

### 步骤 2：按类别评估每个冲突文件
对每个冲突文件，对照本守则的分类：
- 如果是 D 类且上游已是超集 → 直接接受上游，删除 fork 改动
- 如果是 A 类 → 不会有冲突（独立文件）
- 如果是 B/C 类 → 手动合并，重点检查 `[FORK]` 标记的改动是否还在

### 步骤 3：合并前必须做的事
1. 打 tag 标记当前状态：`git tag fork-baseline-<日期>`
2. 在新分支上合并：`git checkout -b merge-upstream-<版本>`
3. 导出 patch 存档：`git diff <基点>..HEAD > fork-changes-<日期>.patch`
4. 备份目录：`cp -r GLM-for-copilot-qt GLM-for-copilot-qt.backup-<日期>`

### 步骤 4：合并后验证
1. TypeScript 编译零错误
2. package.json / nls 文件 JSON 合法
3. 搜 `[FORK]` 确认所有 fork 改动点都保留
4. 手动测试核心场景：MCP 工具调用、vision 三态切换、glm5.2-vscode 模型

---

## 六、当前 Fork 改动清单（2026-07-16 合并版本）

合并基点：上游 `umbrella22/GLM-for-copilot@53f38c6`（v0.5.1 + model manager）

### A 类（纯新增，零冲突）
- `src/mcp/`（9 个文件）：GLM 官方 MCP server provider
- `src/runtime/mcp.ts`：MCP 注册入口
- `src/provider/vision/image-store.ts`：图片存盘（供 MCP 视觉工具读取）

### B 类（配置/注入追加）
- `package.json`：`mcpServerDefinitionProviders` 声明 + `mcp.servers` 配置 + 4 个开关 + `imageHandlingPrompt`/`imageStoredPrompt` + `glm5.2-vscode` 默认模型
- `package.nls*.json`：上述配置的中英文描述
- `src/runtime/lifecycle.ts`：MCP 注册 + image store 初始化（~12 行）
- `src/provider/index.ts`：`authManager` 改 readonly（1 行）
- `src/provider/request.ts`：注入 imageHandlingPrompt 系统指令

### C 类（核心解耦点，需重点维护）
- `src/types.ts`：`ModelVisionMode` 加 `'mcp'` 成员
- `src/config.ts`：`normalizeModelVisionMode` 接受 `'mcp'`
- `src/provider/vision/resolve.ts`：**单点 early-return 钩子**（mcp 分支 + `stripImagesForMcpMode` 辅助函数）
- `src/manager/ui/{types,strings,script}.ts` + `src/i18n.ts`：manager UI 暴露 mcp 选项

### 已放弃的旧 fork 改动（D 类，用上游超集替代）
- 旧的 `GLMContentPart` 合并类型 → 用上游 `GLMTextContentPart`/`GLMImageContentPart` + `glm-content.ts`
- 旧的 `convert.ts` `dataPartToDataUrl` → 用上游 `createGLMImageContentPart`
- 旧的 `classifier.ts` `glmContentToString` → 用上游 `getGLMContentText`
- 旧的 `anthropic/convert.ts` `contentToString`（图片变 `[image]` 会丢图）→ 用上游 `convertContentBlocks`（真 image block）
- 旧的全局 `visionStrategy` 配置 → 改用上游的每模型 `visionMode`（更精确）
