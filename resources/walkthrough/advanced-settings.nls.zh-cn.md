## 在 Agent 窗口中启用 GLM

如果 GLM 在编辑器聊天中可选，但在新的 agent 窗口 / 后台 agent 中看不到，请在 `settings.json` 中将本扩展加入白名单：

```json
{
  "extensions.supportAgentsWindow": {
    "ikaros.glm-for-vscode-copilot": true
  }
}
```

VS Code 1.128+ 如果出现 `No utility model is configured for 'copilot-utility-small' while the selected main model is BYOK`，请显式设置 host utility 策略。可打开 [GLM: 打开 BYOK Utility Model 设置](command:glm-copilot.openByokUtilitySettings)，或加入：

```json
{
  "chat.byokUtilityModelDefault": "mainAgent"
}
```

`mainAgent` 使用当前 GLM 处理 utility 请求，可能产生额外 BYOK 用量；`copilot` 使用 Copilot utility model。显式 `chat.utilityModel` 和 `chat.utilitySmallModel` 会优先于默认策略。扩展不会写入此 host 设置，也不会修改 `isBYOK`。

## 管理模型与连接

模型管理将影响 GLM 请求的模型 ID、连接路由、图片模式、凭据和视觉代理配置集中在同一页面。

- `模型`：配置 API 模型 ID、官方 Endpoint 路由、图片模式和自定义模型。
- `连接`：选择默认 Endpoint、管理四个凭据通道，并可设置兼容 Base URL。
- `视觉代理`：选择并测试 `proxy` 图片模式使用的后端。

作用域选择器可将模型配置写入用户、工作区或工作区文件夹设置。自定义 Base URL 只影响使用 `default` 路由的模型；显式官方路由和 `same-region-standard` 使用官方 GLM Endpoint，Coding Plan 与标准 API 请求不会自动互相回退。

[打开模型管理](command:glm-copilot.manageModels)

## 稳定工具列表（实验性）

先打开 VS Code 的 Tools 配置，查看当前聊天启用了多少个工具。

[配置 Tools](command:workbench.action.chat.configureTools)

- 64 个或更少已启用工具：通常无需开启，除非工具列表仍在跨轮次变化。
- 超过 128 个已启用工具：不建议开启。因为 GLM 单次 `tools` 请求最多支持 128 个 functions，超过这个数量后，GLM Copilot 无法保证传给 GLM 的 `tools` 列表稳定。请先 disable 掉一些不常用的工具，再考虑开启。
- 介于 64 到 128 个已启用工具：仅在工具列表跨轮次变化、GLM 上下文缓存命中率不理想时，再考虑开启。

这个设置可能通过让 GLM API 的 `tools` 参数在多轮对话中更完整、更稳定来提高缓存命中率。代价是每次请求可能包含更多函数工具定义，因此 input tokens 可能增加。

[打开插件设置](command:workbench.action.openSettings?%5B%22%40id%3Aglm-copilot.experimental.stabilizeToolList%22%5D)
