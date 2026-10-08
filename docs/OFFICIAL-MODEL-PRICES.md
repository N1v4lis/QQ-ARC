# API与搜索：官方价格来源与模型 Logo

2026-10-08：最初为0.4.4.5之后的本地开发；本轮已纳入用户授权发布的0.4.5。

API与搜索的主模型区、连接信息、成本区减少留白。主模型、模型选择/管理、备选模型与价格目录按模型 ID 自动显示品牌 Logo；品牌识别和官方价格适用性独立处理。Anthropic、OpenAI 使用公司 Logo。资源为官网下载缓存，来源见 `app/ui/assets/model-logos/SOURCES.json`，仅用于识别厂商，不改变商标归属。

## 来源

共享 `app/ui/vendor/model-vendors.js` 是官方域名、文档来源和品牌匹配的唯一目录：

| 厂商 | 官方公开价格来源 |
| --- | --- |
| DeepSeek | https://api-docs.deepseek.com/quick_start/pricing/ |
| GLM | https://docs.bigmodel.cn/cn/guide/start/pricing.md |
| Gemini | https://ai.google.dev/gemini-api/docs/pricing |
| MiMo | https://mimo.mi.com/docs/price/pay-as-you-go |
| Qwen | https://help.aliyun.com/en/model-studio/model-pricing |
| Kimi | https://platform.kimi.com/docs/pricing/chat.md |
| MiniMax | https://platform.minimax.io/docs/guides/pricing-paygo.md |
| Anthropic | https://platform.claude.com/docs/en/about-claude/pricing.md |
| OpenAI | https://developers.openai.com/api/docs/pricing |
| Grok / xAI | https://docs.x.ai/developers/pricing.md |

实测 10 家均成功，494 个去重 ID（含 DeepSeek 别名与非文本模型），不是账户可用模型数。OpenAI 包含价格页折叠的模型数据及语音、图像等计费条目；Anthropic 保留公开表的新旧模型。官方未列出的快照或未公开价格不会猜测。目录支持厂商筛选、搜索、分页和展开原始分档，每项保留来源与成功获取时间。不会自动将价格目录添加到用户的可调用模型目录。

## 拉取与计费

`app/server/official-price-feed.mjs`：启动先加载磁盘缓存，异步检查各源；成功源每 24 小时刷新，失败源 3 小时后重试。人工刷新强制检查全部，重复刷新共用在途任务。各源独立更新，失败保留上次可用条目。请求只读取固定公开文档，不携带模型 API Key。MiMo 读取网站公开文档块中的 HTML 字符串，绝不执行远程 JS。页面超过 6 MB 或超时会被拒绝。

原币保留；标准美元单价使用欧洲央行每日 EUR/USD、EUR/CNY 参考汇率折算人民币，注明汇率日期。断网使用上次汇率；没有有效汇率不将美元当成人民币使用。估算与真实账单可能不同。默认来源为国内 GLM、Kimi、Qwen、MiMo 与国际 MiniMax；账号地区无法仅凭域名完全推断，其他地区/币种应使用自定义价格。

自动套用要求同时满足 HTTPS、精确官方域名、允许路径、模型品牌一致及价格明确适用。近似域名、用户信息 URL、异常端口、中转地址与未识别路径不使用官方价。其他官方地区端点可以识别，但当前来源不适用时不会跨地区套价。

具有上下文分档、DeepSeek 峰谷/节假日、缓存写入等复杂条件以及按图/秒/分钟收费的条目先保留在目录，不能安全得到单一 Token 价时不自动计费；界面明确显示未估算，允许自定义。不能将这些条目的最低价当作统一单价，也不能把未知价格解释成免费。宿主历史统计对未识别历史渠道同样不借用当前连接价格。

当前页自定义价格使用规范连接地址＋模型作为键，同名供应商和同名模型在不同站点可以独立设价。旧的“渠道名：模型”和通用模型价格仍兼容且保留；通用价格在批量编辑中是显式的跨连接兜底。修改不会覆盖厂商原表。

## 部署与验证

部署 UI 后执行 `node tools/patch-host-official-prices.mjs` 并重启宿主；工具会备份变更的安装文件、安装共享识别/解析模块、替换价格拉取实现，并接入计费门禁和渠道价格。源文件保留在工作区，旧统一价格缓存不用于新的自动适用判定。

定点检查：`check-official-prices.mjs`、`check-official-prices-ui.mjs`、原 `check-api-search-merge.mjs` 与 `check-api-workspace.mjs`，加 4 项 static 检查。浏览器保存通过模拟接口验证，不更改用户真实配置；真实公开拉取单独实测。不运行酒狐全量互动检查。


## 筛选、来源与统计联动（2026-10-08）

目录顶部全部厂商按钮均可点击筛选，并与下拉框同步；再次点击已选厂商恢复全部。官网价格链接独立显示在厂商按钮下方，保留搜索与分页。

Dashboard、用量统计共用宿主价格解析。有效远程价格内容与自定义价格配置共同构成计价版本，历史日文件记录版本；改价后的首次查询按需重算受请求日期，随后继续复用日快照。仅更新时间或来源说明变化不触发回算。旧快照会在首次访问时自动迁移，无需手工删除。设置页保存价格/批量改价/拉取后清理前端成本缓存，用量刷新支持 fresh=1。官方价格依然严格限定官方端点，中转采用渠道自定义价；条件计费条目仅作参考。

验证：`node tools/check-price-usage-link.mjs` 使用临时目录与合成调用，不修改用户价格或统计，覆盖远程更新、自定义更新、总额/日期/会话/模型一致及不变价格复用快照。`node tools/check-official-prices-ui.mjs` 验证默认/MC 筛选、取消、下拉同步与独立来源链接。

厂商筛选现支持多选：按钮切换单家选中状态，下拉列表前置复选框；无选中厂商表示全部，官网来源链接显示选中厂商的合集。验证 tools/check-api-inline-multiselect.mjs。
