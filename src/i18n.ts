import vscode from 'vscode';

/**
 * Lightweight i18n module — zero dependencies, follows VS Code display language.
 *
 *  - en / en-US / en-*      → English (default)
 *  - zh-cn                  → Simplified Chinese
 *  - all other locales      → English until translated
 */

function isZh(): boolean {
	const lang = vscode.env.language.toLowerCase();
	return lang === 'zh-cn';
}

// ---- Translation dictionaries ----

type Translations = Record<string, string>;

const zh: Translations = {
	// Model descriptions
	'model.glm-5.2.detail': '旗舰编码与推理模型',
	'model.glm-5.2.tooltip':
		'GLM-5.2，适合复杂 Agent 编程、长上下文和高强度推理任务；图片会先由 GLM-4.6V-Flash 视觉代理处理。',
	'model.glm-4.6v-flash.detail': '多模态视觉与编码模型',
	'model.glm-4.6v-flash.tooltip':
		'GLM-4.6V-Flash，适合图片理解、多模态问答，以及作为 GLM-5.2/GLM-5-Turbo 的默认视觉代理。',
	'model.glm-5-turbo.detail': '日常 Agent 编码模型',
	'model.glm-5-turbo.tooltip':
		'GLM-5-Turbo，适合日常编码、快速修改和较高频率的工具调用；图片会先由 GLM-4.6V-Flash 视觉代理处理。',

	// API Key
	'auth.apiKeyRequiredDetail': '请先配置 API Key',
	'auth.prompt': '请输入 GLM API Key、Coding Plan Token 或兼容服务令牌。',
	'auth.placeholder': 'GLM API Key 或 Coding Plan Token',
	'auth.emptyValidation': 'API Key 不能为空',
	'auth.saved': 'API Key 已安全保存。',
	'auth.removed': 'API Key 已移除。',
	'auth.notConfigured': 'API Key 未配置，请在命令面板运行 "GLM: 设置 API Key"。',

	// Thinking Effort — short labels for model picker dropdown
	'status.thinking': '思考模式',
	'thinking.none': '停用',
	'thinking.none.desc': '停用思考，响应更快',
	'thinking.high': '标准',
	'thinking.high.desc': '推荐日常使用',
	'thinking.max': '深度',
	'thinking.max.desc': '深度推理，适合复杂任务',

	// Vision
	'vision.proxyUsing': '视觉代理：{0}',
	'vision.notFound': '未找到视觉模型 "{0}"',
	'vision.unavailable': '无可用视觉模型，图片已忽略。',
	'vision.proxyError': '视觉代理异常：',
	'vision.action.configureProxy': '配置视觉代理',
	'vision.panel.title': 'GLM 视觉代理',
	'vision.panel.description':
		'配置一个支持图片输入的模型，用来先把图片转换成文字描述，再把描述随消息发送给 GLM。自动模式会优先使用 GLM-4.6V-Flash，失败后再回退到 VS Code 视觉模型。',
	'vision.panel.source.auto': '自动',
	'vision.panel.source.vscodeLm': 'VS Code 模型',
	'vision.panel.source.apiEndpoint': 'API 端点',
	'vision.panel.field.source': '视觉代理来源',
	'vision.panel.field.visionModel': '视觉模型',
	'vision.panel.field.endpointType': '端点类型',
	'vision.panel.field.endpointUrl': '端点 URL',
	'vision.panel.field.apiKey': 'API Key',
	'vision.panel.field.modelId': '模型 ID',
	'vision.panel.field.customHeaders': '自定义 headers JSON',
	'vision.panel.field.extraBody': '额外请求体 JSON',
	'vision.panel.hint.customHeaders':
		'Header 会随配置保存。建议尽量把服务商 token 放在 API Key 输入框中。',
	'vision.panel.hint.extraBody': '会合并进请求体，不能覆盖 model、messages、input 或 stream。',
	'vision.panel.placeholder.openaiEndpoint': 'https://api.example.com/v1/chat/completions',
	'vision.panel.placeholder.openaiResponsesEndpoint': 'https://api.example.com/v1/responses',
	'vision.panel.placeholder.anthropicEndpoint': 'https://api.example.com/v1/messages',
	'vision.panel.placeholder.endpointType': '选择端点类型',
	'vision.panel.placeholder.enterApiKey': '输入 API Key',
	'vision.panel.endpointType.openaiChatCompletions': 'OpenAI 兼容 Chat Completions',
	'vision.panel.endpointType.openaiResponses': 'OpenAI 兼容 Responses',
	'vision.panel.endpointType.anthropicMessages': 'Anthropic 兼容 Messages',
	'vision.panel.hint.endpointTypeEmpty': '输入端点 URL 后会尝试自动识别端点类型。',
	'vision.panel.hint.endpointTypeInferred': '已根据 URL 自动识别为 {0}。',
	'vision.panel.hint.endpointTypeManual': '无法根据 URL 自动识别，请手动选择端点类型。',
	'vision.panel.hint.endpointTypeSelected': '使用手动选择的端点类型：{0}。',
	'vision.panel.hint.apiKeySet': '已保存 API Key。输入新 key 可替换当前 key。',
	'vision.panel.hint.apiKeyUnset': 'API Key 将保存在 VS Code SecretStorage 中。',
	'vision.panel.cost.tokenCost': '费用：{0} credits / 100 万 tokens',
	'vision.panel.cost.longContextTokenCost': '长上下文：{0} credits / 100 万 tokens',
	'vision.panel.cost.input': '输入 {0}',
	'vision.panel.cost.cachedInput': '缓存输入 {0}',
	'vision.panel.cost.output': '输出 {0}',
	'vision.panel.cost.pricing': '费用：{0}',
	'vision.panel.cost.category.low': '低费用',
	'vision.panel.cost.category.medium': '中等费用',
	'vision.panel.cost.category.high': '高费用',
	'vision.panel.cost.category.veryHigh': '很高费用',
	'vision.panel.cost.category.named': '{0} 费用',
	'vision.panel.status.vscodeLmSelected': '已选择 VS Code 语言模型。',
	'vision.panel.status.apiKeySet': '已设置 API Key。',
	'vision.panel.status.apiKeyNotSet': '未设置 API Key。',
	'vision.panel.status.autoSelected': '自动模式已启用：优先使用 GLM-4.6V-Flash。',
	'vision.panel.status.testing': '正在测试视觉代理...',
	'vision.panel.status.vscodeLmNoHttpTest': 'VS Code 语言模型无需 HTTP 测试。',
	'vision.panel.status.testSucceeded': '已收到视觉代理响应，请查看下方样例。',
	'vision.panel.status.autoSaved': '自动视觉代理已启用。',
	'vision.panel.status.vscodeLmSaved': 'VS Code 语言模型已启用。',
	'vision.panel.status.endpointSavedWithKey': 'API 端点和 API Key 已保存，并已启用 API 端点。',
	'vision.panel.status.endpointSaved': 'API 端点已保存，并已启用 API 端点。',
	'vision.panel.status.apiKeyCleared': '已清除保存的 API Key。',
	'vision.panel.summary.noVSCodeVision.title': '当前：没有 VS Code 视觉模型',
	'vision.panel.summary.noVSCodeVision.detail': '请配置 API 端点，或安装支持图片输入的模型提供方。',
	'vision.panel.summary.auto.title': '当前：自动',
	'vision.panel.summary.auto.detail':
		'优先使用 GLM-4.6V-Flash；不可用时回退到 VS Code/Copilot 视觉模型。',
	'vision.panel.summary.vscodeLm.title': '当前：VS Code 语言模型',
	'vision.panel.summary.vscodeLm.detail': '{0} · {1} · 支持图片输入',
	'vision.panel.summary.apiNotConfigured.title': '当前：API 端点未配置',
	'vision.panel.summary.apiNotConfigured.detail': '填写端点 URL、端点类型和模型 ID 后保存。',
	'vision.panel.summary.apiEndpoint.title': '当前：API 端点',
	'vision.panel.summary.apiEndpoint.detail': '{0} · {1} · {2} · {3}',
	'vision.panel.summary.apiKeySet': '已设置 API Key',
	'vision.panel.summary.apiKeyNotSet': '未设置 API Key',
	'vision.panel.action.save': '保存',
	'vision.panel.action.test': '测试',
	'vision.panel.action.clearApiKey': '清除已保存的 API Key',
	'vision.panel.test.image': '测试图片',
	'vision.panel.test.response': '模型回答',
	'vision.panel.error.required': '{0} 必填',
	'vision.panel.error.invalidJson': '{0} 必须是有效的 JSON。',
	'vision.proxy.error.configurationInvalid': '视觉代理配置无效。',
	'vision.proxy.error.providerFamilyInvalid': '视觉代理提供方类型无效。',
	'vision.proxy.error.apiTypeInvalid': '视觉代理 API 类型无效。',
	'vision.proxy.error.fieldRequired': '{0} 必填。',
	'vision.proxy.error.extraBodyObject': '额外请求体 JSON 必须是一个对象。',
	'vision.proxy.error.extraBodyProtectedKey': '额外请求体不能覆盖 "{0}"。',
	'vision.proxy.error.customHeadersObject': '自定义 headers 必须是一个对象。',
	'vision.proxy.error.customHeaderNameEmpty': '自定义 header 名不能为空。',
	'vision.proxy.error.customHeaderNameInvalid': '自定义 header "{0}" 无效。',
	'vision.proxy.error.customHeaderValueString': '自定义 header "{0}" 的值必须是字符串。',
	'vision.proxy.error.customHeaderValueInvalid': '自定义 header "{0}" 的值无效。',
	'vision.proxy.error.invalidUrl': '视觉代理端点 URL 无效。',
	'vision.proxy.error.invalidUrlProtocol': '视觉代理端点 URL 必须使用 http:// 或 https://。',
	'vision.proxy.error.auth': '视觉代理认证失败 ({0})。',
	'vision.proxy.error.notFound': '视觉代理端点或模型不存在：{0}。',
	'vision.proxy.error.payloadTooLarge': '视觉代理图片请求体过大 ({0})。',
	'vision.proxy.error.rateLimited': '视觉代理触发速率限制 ({0})。',
	'vision.proxy.error.providerUnavailable': '视觉代理服务不可用 ({0})。',
	'vision.proxy.error.requestFailed': '视觉代理请求失败 ({0})。',
	'vision.proxy.error.cancelled': '视觉代理请求已取消。',
	'vision.proxy.error.timeout': '视觉代理请求超时。',
	'vision.proxy.error.network.dns': '视觉代理 DNS 解析失败 ({0})。',
	'vision.proxy.error.network.unreachable': '视觉代理端点不可达或拒绝连接 ({0})。',
	'vision.proxy.error.network.interrupted': '视觉代理连接被中断 ({0})。',
	'vision.proxy.error.network.timeout': '视觉代理网络连接超时 ({0})。',
	'vision.proxy.error.network.tls': '视觉代理 TLS/证书校验失败 ({0})。',
	'vision.proxy.error.network.aborted': '视觉代理请求已中止 ({0})。',
	'vision.proxy.error.network.protocol': '视觉代理 HTTP 连接或响应解析失败 ({0})。',
	'vision.proxy.error.network.configuration': '视觉代理请求配置无效 ({0})。',
	'vision.proxy.error.network.generic': '视觉代理网络请求失败 ({0})。',
	'vision.proxy.error.emptyResponse': '视觉代理返回了空响应。',
	'vision.proxy.error.unsupportedAnthropicResponse': 'Anthropic-compatible 视觉响应格式不受支持。',
	'vision.proxy.error.unsupportedOpenAIResponse': 'OpenAI-compatible 视觉响应格式不受支持。',
	'vision.proxy.error.unsupportedOpenAIContent': 'OpenAI-compatible 视觉响应内容格式不受支持。',
	'vision.proxy.error.testFailed': '视觉代理测试失败。',
	'vision.proxy.error.unknown': '未知错误',

	// Request
	'request.toolsLimitExceeded':
		'GLM 单次 tools 请求最多支持 {0} 个 functions，当前请求包含 {1} 个。请先用 VS Code 的 Configure Tools 关闭不常用的工具；如果正在使用实验性稳定工具列表设置，请关闭它。',
	'request.preflightRoundLimitExceeded':
		'实验性稳定工具列表设置已尝试 {0} 轮，仍无法得到稳定的已启用工具列表。请关闭该实验性设置，或先用 VS Code 的 Configure Tools 关闭不常用的工具。',
	'notice.visionProxyMissing': '⚠️ 视觉代理不可用，GLM 无法看到图片。[配置视觉代理]({0})',
	'notice.visionProxyFailure': '**⚠️ {0}**\\\n\\\n**{1} · {2}**',
	'notice.toolDrift':
		'⚠️ 工具列表不稳定，缓存命中率可能下降。[了解更多](https://github.com/umbrella22/glm-for-copilot/blob/main/docs/notices/tool-drift.zh.md)',

	// Usage
	'usage.notConfigured': '请先配置 API Key，再查询 GLM Coding Plan 用量。',
	'usage.unsupportedBaseUrl': '当前 endpoint 不是 GLM Coding Plan endpoint，无法查询套餐用量。',
	'usage.querySucceeded': 'GLM Coding Plan 用量已刷新。',
	'usage.queryFailed': 'GLM Coding Plan 用量查询失败：{0}',
	'usage.status.name': 'GLM 用量',
	'usage.status.title': 'GLM Coding Plan',
	'usage.status.fiveHours': '5 小时用量',
	'usage.status.sevenDays': '一周用量',
	'usage.status.used': '已使用',
	'usage.status.fiveHoursResetTime': '5 小时重置时间',
	'usage.status.sevenDaysResetTime': '一周重置时间',
	'usage.balance.title': 'GLM 按量付费',
	'usage.balance.waiting': '费用将在下一次请求完成后显示。',
	'usage.balance.lastRequest': '本次请求',
	'usage.balance.sessionTotal': '本次会话',
	'usage.balance.model': '模型',
	'usage.balance.pricing': '每百万 tokens 价格',
	'usage.balance.input': '输入',
	'usage.balance.cachedInput': '缓存输入',
	'usage.balance.output': '输出',

	// Errors
	'error.http.400': '[{0}] 请求体格式错误。请根据错误信息提示修改请求体。',
	'error.http.401':
		'[{0}] API Key 错误，认证失败。请检查您的 API Key 是否正确。如没有 API key，请先创建 API Key。',
	'error.http.401.withCreateApiKeyLink':
		'[{0}] API Key 错误，认证失败。请检查您的 API Key 是否正确。如没有 API key，请先[创建 API Key]({1})。',
	'error.http.402': '[{0}] 账号余额不足。请确认账户余额，并前往充值页面进行充值。',
	'error.http.422': '[{0}] 请求体参数错误。请根据错误信息提示修改相关参数。',
	'error.http.429': '[{0}] 请求速率（TPM 或 RPM）达到上限。请合理规划您的请求速率。',
	'error.http.500': '[{0}] 服务器内部故障。请等待后重试。',
	'error.http.503': '[{0}] 服务器负载过高。请稍后重试您的请求。',
	'error.http.generic': '[{0}] 服务返回错误响应。',
	'error.http.withServerMessage': '[{0}] 服务返回错误：{1}',
	'error.action.setApiKey': '设置 API Key',
	'error.action.createApiKey': '创建 API Key',
	'error.action.viewUsage': '用量',
	'error.action.checkGLMStatus': 'GLM 状态',
	'error.action.viewDetails': '错误详情',
	'error.action.topUp': '前往充值',
	'error.action.renewCodingPlan': '续订套餐',
	'error.action.fairUsePolicy': '申请解除限制',
	// GLM 业务错误码（参考 https://docs.bigmodel.cn/cn/faq/api-code）
	'error.glm.1000': 'API Key 错误，认证失败。请检查 API Key 是否正确。',
	'error.glm.1001': '请求未携带 Authentication 参数，无法进行身份验证。请配置 API Key。',
	'error.glm.1003': 'Authentication Token 已过期。请重新生成或获取 API Key。',
	'error.glm.1005': '已开启二次认证保护，需要完成二次认证登录后才能使用。',
	'error.glm.1113': '您的账户已欠费。请充值后重试。',
	'error.glm.1200': 'API 调用失败。请稍后重试，或查看 GLM 服务状态。',
	'error.glm.1210': 'API 调用参数有误。请根据错误信息提示检查请求参数。',
	'error.glm.1211': '模型不存在。请检查模型 ID 是否正确。',
	'error.glm.1212': '当前模型不支持该调用方式。',
	'error.glm.1213': '未正常接收到必填参数。请检查请求体。',
	'error.glm.1214': '参数非法。请根据错误信息提示检查请求参数。',
	'error.glm.1221': '该 API 已下线。',
	'error.glm.1222': '该 API 不存在。',
	'error.glm.1230': 'API 调用流程出错。请稍后重试。',
	'error.glm.1234': '服务端网络错误。请联系客服。',
	'error.glm.1261': 'Prompt 超长。请缩短输入或清理上下文后重试。',
	'error.glm.1301': '系统检测到输入或生成内容可能包含不安全或敏感内容。请调整提示语。',
	'error.glm.1302': '您的账户已达到速率限制，请控制请求频率。',
	'error.glm.1305': '该模型当前访问量过大，请稍后再试。',
	'error.glm.1308': '已达到使用上限，将在 {0} 重置。',
	'error.glm.1309': '您的 GLM Coding Plan 套餐已到期。请前往官网续订后恢复使用。',
	'error.glm.1310': '您已达到使用上限，将在 {0} 重置。',
	'error.glm.1311': '当前订阅套餐暂未开放该模型权限。请续订或更换套餐。',
	'error.glm.1313':
		'您的账户当前使用模式不符合公平使用策略，请求频率已受到限制。请前往个人中心申请解除限制。',
	'error.glm.1314': '您的企业套餐已失效，请联系企业管理员。',
	'error.glm.1315': '该 API Key 仅限企业编程套餐场景使用。请到官网更换对应产品类型的 API Key。',
	'error.glm.1316': '已达到 5 小时使用上限，主账号余额不足，无法使用超额按量付费。将在 {0} 重置。',
	'error.glm.1317': '已达到 7 天使用上限，主账号余额不足，无法使用超额按量付费。将在 {0} 重置。',
	'error.glm.1318':
		'已达到 5 小时使用上限，且已达子账号月消费上限。请联系管理员调整。将在 {0} 重置。',
	'error.glm.1319':
		'已达到 7 天使用上限，且已达子账号月消费上限。请联系管理员调整。将在 {0} 重置。',
	'error.glm.1320':
		'已达到 5 小时使用上限，且已达企业级月消费上限。请联系管理员调整。将在 {0} 重置。',
	'error.glm.1321':
		'已达到 7 天使用上限，且已达企业级月消费上限。请联系管理员调整。将在 {0} 重置。',
	'error.network.dns': '[{0}] DNS 解析失败。请检查网络连接、防火墙或代理设置，以及自定义 baseUrl。',
	'error.network.unreachable':
		'[{0}] 目标不可达或拒绝连接。请检查自定义 baseUrl、代理服务、网络连接或防火墙设置。',
	'error.network.interrupted': '[{0}] 连接被中断。请检查网络连接、防火墙或代理设置，或稍后重试。',
	'error.network.timeout': '[{0}] 连接超时。请稍后重试，或检查网络连接、防火墙或代理设置。',
	'error.network.tls': '[{0}] TLS/证书校验失败。请检查代理、证书配置或自定义 baseUrl。',
	'error.network.aborted':
		'[{0}] 请求已中止。如果不是主动取消，请检查网络连接或代理设置，或稍后重试。',
	'error.network.protocol':
		'[{0}] HTTP 连接或响应解析失败。请检查代理设置、自定义 baseUrl 或服务响应。',
	'error.network.configuration': '[{0}] 请求配置无效。请检查自定义 baseUrl 或扩展设置。',
	'error.network.generic':
		'[{0}] 网络请求失败。请检查网络连接、防火墙或代理设置，以及自定义 baseUrl。',
	'error.unknown': 'GLM 请求失败：{0}',

	// Extension
	'extension.activateFailed': 'GLM 激活失败，请运行 "GLM: 显示日志" 查看详情。',
	'extension.deactivateFailed': 'GLM 停用异常',
	'extension.welcomeFailed': '欢迎引导加载异常',
	'extension.openRequestDumpsFolderFailed':
		'打开请求 dump 目录失败，请运行 "GLM: 显示日志" 查看详情。',
};

const en: Translations = {
	// Model descriptions
	'model.glm-5.2.detail': 'Flagship coding and reasoning model',
	'model.glm-5.2.tooltip':
		'GLM-5.2 for complex agentic coding, long context, and high-intensity reasoning. Images are described by the GLM-4.6V-Flash vision proxy first.',
	'model.glm-4.6v-flash.detail': 'Multimodal vision and coding model',
	'model.glm-4.6v-flash.tooltip':
		'GLM-4.6V-Flash for image understanding, multimodal Q&A, and the default vision proxy for GLM-5.2/GLM-5-Turbo.',
	'model.glm-5-turbo.detail': 'Daily agent coding model',
	'model.glm-5-turbo.tooltip':
		'GLM-5-Turbo for everyday coding, quick edits, and frequent tool calls. Images are described by the GLM-4.6V-Flash vision proxy first.',

	// API Key
	'auth.apiKeyRequiredDetail': 'Please run GLM: Set API Key to configure.',
	'auth.prompt': 'Enter your GLM API key, Coding Plan token, or compatible provider token.',
	'auth.placeholder': 'GLM API key or Coding Plan token',
	'auth.emptyValidation': 'API key cannot be empty',
	'auth.saved': 'GLM API key saved.',
	'auth.removed': 'GLM API key removed.',
	'auth.notConfigured':
		'GLM API key not configured. Run "GLM: Set API Key" from the Command Palette.',

	// Thinking Effort
	'status.thinking': 'Thinking Effort',
	'thinking.none': 'None',
	'thinking.none.desc': 'Disable thinking for faster responses',
	'thinking.high': 'High',
	'thinking.high.desc': 'Recommended for most tasks',
	'thinking.max': 'Max',
	'thinking.max.desc': 'Maximum reasoning depth for complex agent tasks',

	// Vision
	// NOTE: vision.unableToDescribe has been moved to consts.ts as
	// IMAGE_DESCRIPTION_UNAVAILABLE — it is prompt content, not UI text.
	'vision.proxyUsing': 'Vision proxy: {0}',
	'vision.notFound': 'Vision model "{0}" not found',
	'vision.unavailable': 'No vision models available, image(s) ignored',
	'vision.proxyError': 'Vision proxy error:',
	'vision.action.configureProxy': 'Configure Vision Proxy',
	'vision.panel.title': 'GLM Vision Proxy',
	'vision.panel.description':
		'Configure a vision-capable model to turn image attachments into text before GLM receives the request. Automatic mode tries GLM-4.6V-Flash first, then falls back to VS Code vision models.',
	'vision.panel.source.auto': 'Automatic',
	'vision.panel.source.vscodeLm': 'VS Code model',
	'vision.panel.source.apiEndpoint': 'API endpoint',
	'vision.panel.field.source': 'Vision proxy source',
	'vision.panel.field.visionModel': 'Vision model',
	'vision.panel.field.endpointType': 'Endpoint type',
	'vision.panel.field.endpointUrl': 'Endpoint URL',
	'vision.panel.field.apiKey': 'API key',
	'vision.panel.field.modelId': 'Model ID',
	'vision.panel.field.customHeaders': 'Custom headers JSON',
	'vision.panel.field.extraBody': 'Additional request body JSON',
	'vision.panel.hint.customHeaders':
		'Header values are stored with the profile. Put provider tokens in the API key field when possible.',
	'vision.panel.hint.extraBody':
		'Merged into the request body. Cannot override model, messages, input, or stream.',
	'vision.panel.placeholder.openaiEndpoint': 'https://api.example.com/v1/chat/completions',
	'vision.panel.placeholder.openaiResponsesEndpoint': 'https://api.example.com/v1/responses',
	'vision.panel.placeholder.anthropicEndpoint': 'https://api.example.com/v1/messages',
	'vision.panel.placeholder.endpointType': 'Select endpoint type',
	'vision.panel.placeholder.enterApiKey': 'Enter API key',
	'vision.panel.endpointType.openaiChatCompletions': 'OpenAI-compatible Chat Completions',
	'vision.panel.endpointType.openaiResponses': 'OpenAI-compatible Responses',
	'vision.panel.endpointType.anthropicMessages': 'Anthropic-compatible Messages',
	'vision.panel.hint.endpointTypeEmpty':
		'Enter an endpoint URL to infer the endpoint type automatically.',
	'vision.panel.hint.endpointTypeInferred': 'Inferred from URL: {0}.',
	'vision.panel.hint.endpointTypeManual':
		'Could not infer this URL. Select the endpoint type manually.',
	'vision.panel.hint.endpointTypeSelected': 'Using selected endpoint type: {0}.',
	'vision.panel.hint.apiKeySet': 'Stored API key is set. Enter a new key to replace it.',
	'vision.panel.hint.apiKeyUnset': 'API key will be stored in VS Code SecretStorage.',
	'vision.panel.cost.tokenCost': 'Cost: {0} credits / 1M tokens',
	'vision.panel.cost.longContextTokenCost': 'Long context: {0} credits / 1M tokens',
	'vision.panel.cost.input': 'input {0}',
	'vision.panel.cost.cachedInput': 'cached input {0}',
	'vision.panel.cost.output': 'output {0}',
	'vision.panel.cost.pricing': 'Cost: {0}',
	'vision.panel.cost.category.low': 'low cost',
	'vision.panel.cost.category.medium': 'medium cost',
	'vision.panel.cost.category.high': 'high cost',
	'vision.panel.cost.category.veryHigh': 'very high cost',
	'vision.panel.cost.category.named': '{0} cost',
	'vision.panel.status.vscodeLmSelected': 'VS Code language model is selected.',
	'vision.panel.status.apiKeySet': 'API key is set.',
	'vision.panel.status.apiKeyNotSet': 'API key is not set.',
	'vision.panel.status.autoSelected': 'Automatic mode is active: GLM-4.6V-Flash is tried first.',
	'vision.panel.status.testing': 'Testing vision proxy...',
	'vision.panel.status.vscodeLmNoHttpTest':
		'VS Code language model selection does not need an HTTP test.',
	'vision.panel.status.testSucceeded': 'Vision proxy responded. Review the sample below.',
	'vision.panel.status.autoSaved': 'Automatic vision proxy is now active.',
	'vision.panel.status.vscodeLmSaved': 'VS Code language model is now active.',
	'vision.panel.status.endpointSavedWithKey':
		'API endpoint and API key saved. API endpoint is now active.',
	'vision.panel.status.endpointSaved': 'API endpoint saved. API endpoint is now active.',
	'vision.panel.status.apiKeyCleared': 'Saved API key cleared.',
	'vision.panel.summary.noVSCodeVision.title': 'Current: no VS Code vision model',
	'vision.panel.summary.noVSCodeVision.detail':
		'Configure an API endpoint or install a provider with image input support.',
	'vision.panel.summary.auto.title': 'Current: automatic',
	'vision.panel.summary.auto.detail':
		'Tries GLM-4.6V-Flash first; falls back to VS Code/Copilot vision models when unavailable.',
	'vision.panel.summary.vscodeLm.title': 'Current: VS Code language model',
	'vision.panel.summary.vscodeLm.detail': '{0} · {1} · image input supported',
	'vision.panel.summary.apiNotConfigured.title': 'Current: API endpoint not configured',
	'vision.panel.summary.apiNotConfigured.detail':
		'Complete the endpoint URL, endpoint type, and model ID, then save.',
	'vision.panel.summary.apiEndpoint.title': 'Current: API endpoint',
	'vision.panel.summary.apiEndpoint.detail': '{0} · {1} · {2} · {3}',
	'vision.panel.summary.apiKeySet': 'API key set',
	'vision.panel.summary.apiKeyNotSet': 'API key not set',
	'vision.panel.action.save': 'Save',
	'vision.panel.action.test': 'Test',
	'vision.panel.action.clearApiKey': 'Clear saved API key',
	'vision.panel.test.image': 'Test image',
	'vision.panel.test.response': 'Model response',
	'vision.panel.error.required': '{0} is required',
	'vision.panel.error.invalidJson': '{0} must be valid JSON.',
	'vision.proxy.error.configurationInvalid': 'Vision proxy configuration is invalid.',
	'vision.proxy.error.providerFamilyInvalid': 'Vision proxy provider type is invalid.',
	'vision.proxy.error.apiTypeInvalid': 'Vision proxy API type is invalid.',
	'vision.proxy.error.fieldRequired': '{0} is required.',
	'vision.proxy.error.extraBodyObject': 'Additional request body JSON must be an object.',
	'vision.proxy.error.extraBodyProtectedKey': 'Additional request body cannot override "{0}".',
	'vision.proxy.error.customHeadersObject': 'Custom headers must be an object.',
	'vision.proxy.error.customHeaderNameEmpty': 'Custom header name cannot be empty.',
	'vision.proxy.error.customHeaderNameInvalid': 'Custom header "{0}" is invalid.',
	'vision.proxy.error.customHeaderValueString': 'Custom header "{0}" must have a string value.',
	'vision.proxy.error.customHeaderValueInvalid': 'Custom header "{0}" has an invalid value.',
	'vision.proxy.error.invalidUrl': 'Vision proxy endpoint URL is invalid.',
	'vision.proxy.error.invalidUrlProtocol':
		'Vision proxy endpoint URL must start with http:// or https://.',
	'vision.proxy.error.auth': 'Vision proxy authentication failed ({0}).',
	'vision.proxy.error.notFound': 'Vision proxy endpoint or model not found at {0}.',
	'vision.proxy.error.payloadTooLarge': 'Vision proxy image payload too large ({0}).',
	'vision.proxy.error.rateLimited': 'Vision proxy rate limited ({0}).',
	'vision.proxy.error.providerUnavailable': 'Vision proxy provider unavailable ({0}).',
	'vision.proxy.error.requestFailed': 'Vision proxy request failed ({0}).',
	'vision.proxy.error.cancelled': 'Vision proxy request was cancelled.',
	'vision.proxy.error.timeout': 'Vision proxy request timed out.',
	'vision.proxy.error.network.dns': 'Vision proxy DNS lookup failed ({0}).',
	'vision.proxy.error.network.unreachable':
		'Vision proxy endpoint is unreachable or refused the connection ({0}).',
	'vision.proxy.error.network.interrupted': 'Vision proxy connection was interrupted ({0}).',
	'vision.proxy.error.network.timeout': 'Vision proxy network connection timed out ({0}).',
	'vision.proxy.error.network.tls': 'Vision proxy TLS/certificate verification failed ({0}).',
	'vision.proxy.error.network.aborted': 'Vision proxy request was aborted ({0}).',
	'vision.proxy.error.network.protocol':
		'Vision proxy HTTP connection or response parsing failed ({0}).',
	'vision.proxy.error.network.configuration':
		'Vision proxy request configuration is invalid ({0}).',
	'vision.proxy.error.network.generic': 'Vision proxy network request failed ({0}).',
	'vision.proxy.error.emptyResponse': 'Vision proxy returned an empty response.',
	'vision.proxy.error.unsupportedAnthropicResponse':
		'Anthropic-compatible vision response has unsupported shape.',
	'vision.proxy.error.unsupportedOpenAIResponse':
		'OpenAI-compatible vision response has unsupported shape.',
	'vision.proxy.error.unsupportedOpenAIContent':
		'OpenAI-compatible vision response content has unsupported shape.',
	'vision.proxy.error.testFailed': 'Vision proxy test failed.',
	'vision.proxy.error.unknown': 'unknown',

	// Request
	'request.toolsLimitExceeded':
		'GLM supports at most {0} functions in a single `tools` request, but this request contains {1}. Use VS Code Configure Tools to disable tools you rarely use. If the experimental tool-list stabilization setting is enabled, turn it off.',
	'request.preflightRoundLimitExceeded':
		'Experimental tool-list stabilization tried {0} rounds but still could not get a stable enabled-tools list. Turn this experimental setting off, or use VS Code Configure Tools to disable tools you rarely use first.',
	'notice.visionProxyMissing':
		'⚠️ Vision Proxy is unavailable. GLM cannot see images. [Configure Vision Proxy]({0})',
	'notice.visionProxyFailure': '**⚠️ {0}**\\\n\\\n**{1} · {2}**',
	'notice.toolDrift':
		'⚠️ Tool list is unstable; cache hit rate may drop. [Learn more](https://github.com/umbrella22/glm-for-copilot/blob/main/docs/notices/tool-drift.en.md)',

	// Usage
	'usage.notConfigured': 'Configure an API key before querying GLM Coding Plan usage.',
	'usage.unsupportedBaseUrl':
		'The current endpoint is not a GLM Coding Plan endpoint, so plan usage cannot be queried.',
	'usage.querySucceeded': 'GLM Coding Plan usage has been refreshed.',
	'usage.queryFailed': 'GLM Coding Plan usage query failed: {0}',
	'usage.status.name': 'GLM usage',
	'usage.status.title': 'GLM Coding Plan',
	'usage.status.fiveHours': '5-hour usage',
	'usage.status.sevenDays': 'Weekly usage',
	'usage.status.used': 'used',
	'usage.status.fiveHoursResetTime': '5-hour reset',
	'usage.status.sevenDaysResetTime': 'Weekly reset',
	'usage.balance.title': 'GLM pay-as-you-go',
	'usage.balance.waiting': 'Cost will appear after the next request completes.',
	'usage.balance.lastRequest': 'Last request',
	'usage.balance.sessionTotal': 'Session total',
	'usage.balance.model': 'Model',
	'usage.balance.pricing': 'Price per 1M tokens',
	'usage.balance.input': 'Input',
	'usage.balance.cachedInput': 'Cached input',
	'usage.balance.output': 'Output',

	// Errors
	'error.http.400':
		'[{0}] Invalid request body format. Please modify your request body according to the hints in the error message.',
	'error.http.401':
		"[{0}] Authentication fails due to the wrong API key. Please check your API key. If you don't have one, please create an API key first.",
	'error.http.401.withCreateApiKeyLink':
		"[{0}] Authentication fails due to the wrong API key. Please check your API key. If you don't have one, please [create an API key]({1}) first.",
	'error.http.402':
		"[{0}] You have run out of balance. Please check your account's balance, and go to the Top up page to add funds.",
	'error.http.422':
		'[{0}] Your request contains invalid parameters. Please modify your request parameters according to the hints in the error message.',
	'error.http.429':
		'[{0}] You are sending requests too quickly. Please pace your requests reasonably.',
	'error.http.500':
		'[{0}] Our server encounters an issue. Please retry your request after a brief wait.',
	'error.http.503':
		'[{0}] The server is overloaded due to high traffic. Please retry your request after a brief wait.',
	'error.http.generic': '[{0}] The service returned an error response.',
	'error.http.withServerMessage': '[{0}] The service returned an error: {1}',
	'error.action.setApiKey': 'Set API Key',
	'error.action.createApiKey': 'Create API Key',
	'error.action.viewUsage': 'Usage',
	'error.action.checkGLMStatus': 'GLM Status',
	'error.action.viewDetails': 'Error Details',
	'error.action.topUp': 'Top up',
	'error.action.renewCodingPlan': 'Renew Plan',
	'error.action.fairUsePolicy': 'Request Lift',
	// GLM business error codes (see https://docs.bigmodel.cn/cn/faq/api-code)
	'error.glm.1000': 'Authentication failed due to an invalid API key. Please check your API key.',
	'error.glm.1001':
		'The Authentication header was missing. Please configure an API key before retrying.',
	'error.glm.1003':
		'The authentication token has expired. Please regenerate or obtain a new API key.',
	'error.glm.1005': 'Two-factor authentication is enabled. Please complete 2FA login first.',
	'error.glm.1113': 'Your account is in arrears. Please top up and try again.',
	'error.glm.1200': 'API call failed. Please retry later or check the GLM service status.',
	'error.glm.1210':
		'The API call parameters are invalid. Please review the error hints and your request body.',
	'error.glm.1211': 'The model does not exist. Please check the model ID.',
	'error.glm.1212': 'This model does not support the requested invocation method.',
	'error.glm.1213':
		'A required parameter was not received correctly. Please check the request body.',
	'error.glm.1214':
		'A parameter is invalid. Please review the error hints and your request parameters.',
	'error.glm.1221': 'This API has been retired.',
	'error.glm.1222': 'This API does not exist.',
	'error.glm.1230': 'The API call flow failed. Please retry later.',
	'error.glm.1234': 'A server-side network error occurred. Please contact support.',
	'error.glm.1261': 'The prompt is too long. Please shorten the input or clear context and retry.',
	'error.glm.1301':
		'The input or generated content may contain unsafe or sensitive material. Please rephrase your prompt.',
	'error.glm.1302': 'Your account has hit the rate limit. Please slow down your request frequency.',
	'error.glm.1305': 'This model is currently overloaded. Please retry shortly.',
	'error.glm.1308': 'You have reached the usage limit. It will reset at {0}.',
	'error.glm.1309':
		'Your GLM Coding Plan subscription has expired. Please renew it on the official site to resume access.',
	'error.glm.1310': 'You have reached the usage limit. It will reset at {0}.',
	'error.glm.1311':
		'The current subscription plan does not include this model. Please renew or switch plans.',
	'error.glm.1313':
		'Your account usage pattern does not comply with the fair-use policy and is being rate-limited. Request a lift from the personal center.',
	'error.glm.1314':
		'Your enterprise plan has expired. Please contact your enterprise administrator.',
	'error.glm.1315':
		'This API key is restricted to enterprise coding-plan scenarios. Please switch to a matching API key from the official site.',
	'error.glm.1316':
		'You have reached the 5-hour usage limit and the master account is out of balance for pay-as-you-go overage. It will reset at {0}.',
	'error.glm.1317':
		'You have reached the 7-day usage limit and the master account is out of balance for pay-as-you-go overage. It will reset at {0}.',
	'error.glm.1318':
		'You have reached the 5-hour usage limit and the sub-account monthly cap. Please contact your administrator. It will reset at {0}.',
	'error.glm.1319':
		'You have reached the 7-day usage limit and the sub-account monthly cap. Please contact your administrator. It will reset at {0}.',
	'error.glm.1320':
		'You have reached the 5-hour usage limit and the enterprise monthly cap. Please contact your administrator. It will reset at {0}.',
	'error.glm.1321':
		'You have reached the 7-day usage limit and the enterprise monthly cap. Please contact your administrator. It will reset at {0}.',
	'error.network.dns':
		'[{0}] DNS lookup failed. Check your network connection, firewall, or proxy settings, and your custom baseUrl.',
	'error.network.unreachable':
		'[{0}] The target is unreachable or refused the connection. Check your custom baseUrl, proxy service, network connection, or firewall settings.',
	'error.network.interrupted':
		'[{0}] The connection was interrupted. Check your network connection, firewall, or proxy settings, or try again later.',
	'error.network.timeout':
		'[{0}] Connection timed out. Try again later, or check your network connection, firewall, or proxy settings.',
	'error.network.tls':
		'[{0}] TLS/certificate verification failed. Check your proxy settings, certificate configuration, or custom baseUrl.',
	'error.network.aborted':
		'[{0}] The request was aborted. If you did not cancel it, check your network connection or proxy settings, or try again later.',
	'error.network.protocol':
		'[{0}] The HTTP connection or response parsing failed. Check your proxy settings, custom baseUrl, or service response.',
	'error.network.configuration':
		'[{0}] The request configuration is invalid. Check your custom baseUrl or extension settings.',
	'error.network.generic':
		'[{0}] Network request failed. Check your network connection, firewall, or proxy settings, and your custom baseUrl.',
	'error.unknown': 'GLM request failed: {0}',

	// Extension
	'extension.activateFailed': 'GLM failed to activate. Run "GLM: Show Logs" for details.',
	'extension.deactivateFailed': 'Failed to prepare GLM provider for deactivate',
	'extension.welcomeFailed': 'Failed to show GLM welcome prompt',
	'extension.openRequestDumpsFolderFailed':
		'Failed to open request dumps folder. Run "GLM: Show Logs" for details.',
};

/**
 * Resolve a translation key for the current VS Code display language.
 * Supports positional placeholders {0}, {1}, ...
 */
export function t(key: string, ...args: (string | number)[]): string {
	const dict = isZh() ? zh : en;
	let text = dict[key];
	if (text === undefined) {
		// Fall back to English when a key is missing from the active locale.
		text = en[key];
	}
	if (text === undefined) {
		return key;
	}
	// Replace all occurrences of each positional placeholder in a single pass
	// so that argument values containing {N} patterns are not re-scanned.
	text = text.replace(/\{(\d+)\}/g, (_match, idx) => {
		const i = Number(idx);
		return i < args.length ? String(args[i]) : _match;
	});
	return text;
}
