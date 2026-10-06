# 0.4.01 验收记录

2026-10-07，在实际部署 http://127.0.0.1:3210/ 运行全量回归：42/42套件通过，共521秒。酒狐专项29/29通过，JSON保留逐项结果；真实Electron报告与截图保留。

复现：node tools/run-all-checks.mjs http://127.0.0.1:3210/；真机验收按 docs/DEVELOPMENT.md。性能为短时主线程 TaskDuration 与 JSHeapUsedSize，不能换算总CPU、RSS或VRAM。
