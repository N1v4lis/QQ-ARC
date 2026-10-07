# QQ Agent 窗口出现前的启动诊断

2026-10-07（Asia/Shanghai）。本次任务是查原因，不永久修改应用启动顺序、缓存、自动启动设置或4秒动画。

## 结论

主要问题发生在Electron创建窗口之前。宿主main.js先`await core.start()`，然后才`createWindow(port)`；但core.start已经让HTTP开始监听，随后仍等待插件和SnowLuma准备，再返回端口。因而页面本可加载时，用户仍看不到窗口。上游也保留这一门禁。

本地还有两个放大因素：

1. 启动SnowLuma的就绪轮询复用了给状态接口用的缓存。isPortOpen第一次false后，8秒内持续返回旧false；满8秒也只是后台刷新，本轮仍返回旧值。即使服务已启动，启动轮询仍可能再等一个周期。本地已有该缓存，上游克隆中的isPortOpen直接探测，不含这份缓存优化。
2. HTTP刚监听便启动7日用量档案预热，遍历会话文件并同步readFileSync/JSON.parse，每50文件才setImmediate让步。它虽未被await，却与插件动态import、端口回调竞争同一个主进程事件循环，“后台”并不等于不会拖慢启动。不能把全部耗时都归咎于插件本身。

4秒动画和新QQ进程摘要位于窗口页面/状态检查阶段，不能解释窗口尚未创建的这段等待。Token同步及OneBot.connect本次仅几毫秒；connect只安排WebSocket连接，不等待账号完成登录。

## 实测

对当前安装版本做两次完整退出后的进程启动测量。时间零点为main.js探针执行，不包含双击到Electron执行入口之前的OS/进程装载时间；不是清空系统文件缓存后的磁盘冷启动基准。

| 阶段 | 正常启动 | 临时跳过用量预热 |
|---|---:|---:|
| Electron ready（累计） | 0.295秒 | 0.205秒 |
| 核心模块导入（累计） | 0.708秒 | 0.460秒 |
| createApp耗时 | 1.120秒 | 0.727秒 |
| HTTP开始监听（累计） | 1.833秒 | 1.191秒 |
| 插件加载耗时（37个） | 7.635秒 | 0.503秒 |
| SnowLuma准备耗时 | 9.653秒 | 9.119秒 |
| 窗口创建（累计） | 11.589秒 | 10.330秒 |
| ready-to-show（累计） | **11.980秒** | **10.755秒** |

插件和SnowLuma准备并行，不能相加。正常启动HTTP可用到窗口显示仍有10.147秒，临时跳过预热时仍有9.564秒。第二次首次SnowLuma探测6ms返回false，之后准备等待约9秒，与8秒负缓存加轮询周期相符；本次没有临时绕过缓存做第三轮对照，因此不能把整个9秒都认定为缓存造成。

预热对照存在文件缓存、系统负载、SnowLuma重启条件差异，只作为关联证据；不能把插件7.635→0.503秒全部当作严格控制变量下的预热CPU耗时。历史boot-diag.log中多次核心导入到start完成也约10秒，支持该等待并非偶发。

原始事件：[正常启动](cold-startup/profile.jsonl)、[跳过预热对照](cold-startup/profile-no-prewarm.jsonl)。这些文件仅保存时间、阶段、插件目录名和数量，不复制账号、Token、会话内容或完整运行日志。

## 源码与复现

上游：https://github.com/K0nd1us/QQ-agent 。浅克隆保存在`E:/CodeX-YSM/qq-agent-upstream`，commit `11577baad321d1774caf0765d791c211072bfa83`。仅用于对照，没有覆盖安装版已有UI/外壳/多账号补丁，也没有安装依赖。

安装版关注位置：electron/main.js的whenReady链；src/app.js的start、isPortOpen、refreshUsageArchive；src/plugin-loader.js的loadSkillRoot。Windows宿主现有代码实际在`E:/QQ Agent/resources/app`。

复现工具`tools/profile-host-startup.mjs`只供明确需要的诊断，不加入自动回归。它临时探测宿主main.js、app.js、plugin-loader.js，执行一次受控重启，finally将源文件按原始字节还原。`--no-prewarm`只为本次对照跳过预热；没有修改配置。工具结束后已核对三份宿主源码还原。

## 优化方向

优先拆分“HTTP已监听”和“核心后台初始化完成”：拿到实际绑定端口便创建/显示窗口，让现有启动画面呈现真实进度；不退回固定3210猜测端口，也不在插件未就绪前接入消息处理。

其次为启动/启动后就绪判断使用新鲜端口探测，保留UI状态接口的缓存与并发去重；不在启动等待中使用8秒旧false。

用量预热延至窗口已显示、插件已完成后，并降低分片阻塞时长；保留用户完整会话数据，不用删除档案或禁用插件掩盖性能问题。以上为待实施方向，本次未永久应用，也不声称已缩短到某个启动秒数。
