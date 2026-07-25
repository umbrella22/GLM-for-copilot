打开模型管理，选择默认连接、检查模型专属路由，并为这些路由实际使用的通道配置凭据。

[打开模型管理](command:glm-copilot.manageModels)

`连接` 视图集中展示国内/国际 Coding Plan 和标准 API 通道。每个凭据都存储在系统密钥链中；页面只能读取是否已配置 Key。

- `Cmd/Ctrl + Shift + P`：打开命令面板
- `GLM: 管理模型与连接`：打开管理页
- `GLM: 设置 API Key`：设置或更新一个通道
- `GLM: 清除 API Key`：移除一个通道
- `GLM: 获取 API Key`：打开一个通道的 Key 管理页面
- `GLM: 查询 Coding Plan 用量`：查询所有活跃 Coding Plan 通道

如果 VS Code 1.128+ 的 BYOK agent 报告未配置 utility model，请打开 [GLM: 打开 BYOK Utility Model 设置](command:glm-copilot.openByokUtilitySettings)，选择 `mainAgent` 或 `copilot`。扩展不会自动修改这个 host 设置。
