# 插件并行准备、顺序注册

2026-10-07。用户授权继续优化导入，并明确本次较大改动上传GitHub；本次授权不恢复今后的自动上传。

## 当前实现

宿主补丁`tools/patch-host-plugin-loading.mjs`新增src/arcfox-plugin-imports.mjs，修改src/plugin-loader.js与src/app.js。完整备份后修改、锚点不符拒绝写入、失败回滚。辅助模块源码保存在tools/host/arcfox-plugin-imports.mjs。

- 冷启动最多4个模块并行准备与import，按原目录扫描顺序逐个setup/register及写注册表；skills根先于plugins根，工具覆盖与生命周期退役顺序不变。
- 入口在import前验证清单、目录范围、realpath与存在性；失败捕获后交给原加载器按顺序登记，保留失败可见、旧实例恢复与孤儿工具清扫。
- 清单requires非空或importMode=serial时形成顺序屏障，先完成前一批注册，再加载该模块。注意requires是能力依赖，不是任意JS模块依赖图。
- 并行import会执行模块顶层代码，顶层的执行/完成顺序可能改变，不能声称所有副作用也保持顺序。依赖前一个模块setup或全局初始化的扩展应声明importMode=serial。现有安装插件实测均成功，但不能保证任意第三方模块。
- QQ_AGENT_PLUGIN_IMPORT_CONCURRENCY=1可让启动完全走原串行导入和注册；默认4，最大4，限制CPU/IO峰值。环境设置仅影响启动准备，不改变插件开关。
- 手动刷新与监听热重载继续串行；所有完整loadPlugins请求进入同一队列，避免并发重载互相注销/清理，失败后队列仍可运行。

## 去掉重复热重载

原watchPlugins已经loadPlugins，回调又reloadSkills，导致一次变化扫描、导入两遍。现在回调传递完成结果，只做激活、工具刷新与监听恢复；监听器等待回调完成。关闭监听器会标记closed、取消防抖计时器和补跑请求，防止旧监听器在重建或退出后再次扫描。

## 验证与测量

`node tools/check-plugin-loading.mjs`在临时隔离目录复制实际加载器、注册表、管理器与工具表，配置仅用内存stub，不访问真实账号。fixture覆盖：4路上限、导入完成乱序但注册顺序稳定、重复ID最后覆盖、requires屏障、错误导入隔离、越界入口不执行、setup失败保留旧工具、删除后的工具回收、重载请求排队与失败恢复、关闭监听器取消待办，以及watch回调不再次加载。结束清理仅限确认后的fixture目录。

宿主语法、异步启动生命周期检查与static四项；不恢复已停用38套，不发送QQ测试消息，不改变4秒动画。

完整退出后一次真实测量，main.js入口为零点：插件开始1.723秒、全部完成2.785秒，即**1.062秒（37个）**；相较前一轮串行1.279秒减少约17%。窗口2.199秒出现，SnowLuma准备0.773秒，核心2.802秒就绪。本轮窗口/整体没有进一步缩短，不把插件局部提速说成总体大幅提速；系统负载、文件缓存影响具体秒数。并行导入耗时累计包含重叠，不能相加当作墙钟时间。

事件：[并行导入](cold-startup/profile-plugin-parallel.jsonl)，对照见 [SnowLuma与串行插件测量](SNOW-STARTUP-TUNING.md)。临时探针全部原字节还原，随后普通重启恢复无探针运行。

普通重启复核窗口约1.9秒、核心约2.3秒（boot-diag）；/api/startup全部就绪，/api/skills有36个唯一ID且无加载失败。37目录中hot-trends与hot-trends_1原本使用同一个hot-trends ID，按原顺序覆盖，因此36个条目不是丢失插件。

## SnowLuma源码接入

用户提供 https://github.com/SnowLuma/SnowLuma/，浅克隆位于E:/CodeX-YSM/SnowLuma-source。已确认用户fork https://github.com/N1v4lis/SnowLuma.git 的HEAD与克隆main相同（87527cb7641a5a42f8f0efb73cb066102e004dee），配置为user-fork远程供后续工作，不推送该fork。

main为1.14.22；已取得v1.14.19标签（fe245d84bf9ab83de2efd1d9445811038b7b2c7a），对应安装版。阅读core/src/index.ts、bridge/src/hook-manager.ts、core/vite.config.ts后确认：启动主线为日志/配置迁移→Bridge/OneBot/Hook→WebUI，原生组件仍是随包二进制。完整TypeScript源码已可供后续重构，不再仅依赖23万行发行bundle；本轮没有重建或升级SnowLuma，也没有将上游源码复制进QQARCFOX。

源码使用源码可见非商业许可，公开发布修改版需要其许可要求的授权；当前QQARCFOX是私有仓库，本次上传本项目的补丁、工具和测量文档，不发布完整修改发行包。未来改为公开或发布SnowLuma衍生发行包时需重新核对许可。源码贡献应依据其AGENTS/CONTRIBUTING向dev提出；若需创建上游issue，应按其说明通过GitHub网页手动提交。

## 安装与回退

宿主重装：先运行patch-host-async-startup，再运行patch-host-snow-startup，最后patch-host-plugin-loading，然后重启。每步锚点验证会防止对不兼容版本静默修改。

回退本轮：退出QQ Agent，恢复src/app.js及src/plugin-loader.js对应.bak-plugin-loading-时间戳备份并重启；新增辅助模块可保留但不再被导入。不要恢复更早app.js备份而误去掉上一轮异步窗口和Snow缓存补丁。
