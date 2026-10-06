# Electron 无边框外壳：frame:false + 自绘标题栏

结论：**验收 1–6 全部通过**，`node tools/verify-electron.mjs` 退出码 **0**（91 项断言，0 失败）。
安装目录 `E:\QQ Agent\resources\app\electron\` 下的 `main.js` / `preload.cjs` 已与工作区版本逐字节一致。
全程**没有启动、重启或结束任何 QQ Agent 进程** —— 用户当时正在用它。

需求原话是"不使用 Windows 自带的任务栏（关闭，最小化）"，即去掉原生标题栏和它右上角的三个按钮，
由页面里的 `.q-titlebar` 自绘。主进程侧要补上的就是"三个动作 + 状态回推"这一层。

原始完整输出：`docs/_verify-output.txt`（重新生成：`node tools/verify-electron.mjs > docs/_verify-output.txt`）。

## 交付物

| 文件 | 作用 |
| --- | --- |
| `app/electron/main.js` | 无边框窗口选项 + `qqa-window` 动作派发 + 窗口状态回推（Lead 已改，本次只验证、不改动） |
| `app/electron/preload.cjs` | `window.qqAgentShell` 桥（原有三接口 + 新增 `controls` / `windowState` / `onMaximizeChange`） |
| `tools/apply-electron.mjs` | 备份 → 安装 → 回读校验 → 失败自动还原；`--rollback` 回滚 |
| `tools/verify-electron.mjs` | 静态取证 + 运行时桩机验证，退出码即结论 |
| `docs/_verify-output.txt` | 验证器的一次完整原始输出 |

## 为什么验证要写成两个脚本

`grep` 只能证明"源码里写了 `frame: false`"，证明不了"主进程真的把 `minimize` 映射到了
`BrowserWindow.minimize()`"，更证明不了"未知动作不会被转发"。可**真机**验证有个硬约束：
用户正在用 QQ Agent，不许重启、不许杀进程 —— 窗口一关就没得测。

所以 `verify-electron.mjs` 走的是第三条路：把这两个文件的**真实字节**拷进临时目录，
配一套 Electron 桩模块（只实现被用到的 API，每次调用都记账），用真实的 `import` / `require`
跑起来，再对桩的记账做断言。跑的是真代码而不是正则，进程一个都不碰。
6 条验收里有 3 条的运行时证据来自这里（主进程 35 条 + 预加载 30 条断言）。

## 验收逐条取证

### 验收 1 · 不使用原生标题栏

```powershell
Select-String -Path app/electron/main.js -Pattern '^\s*frame:\s*false'   # 行 274
Select-String -Path app/electron/main.js -Pattern '^\s*hasShadow:'      # 行 277  hasShadow: false,
Select-String -Path app/electron/main.js -Pattern 'skipTaskbar'         # 全文件仅 1 处，是注释
```

```
✓ BrowserWindow 选项里有 frame: false   —— main.js:274  frame: false,
✓ BrowserWindow 选项里有 hasShadow: false —— main.js:277  hasShadow: false,
✓ 没有任何 skipTaskbar: true —— grep skipTaskbar 命中 1 处，为注释：main.js:272
· 无边框后缩放热区：main.js:279  thickFrame: true,
✓ [main.js] 运行时：BrowserWindow options.frame === false   —— frame=false
✓ [main.js] 运行时：options.hasShadow === false             —— hasShadow=false
✓ [main.js] 运行时：没有开启 skipTaskbar                    —— skipTaskbar=undefined
```

两点说明：

- 注释里也写着 `frame:false`（讲解为什么要这么做），所以静态检查用的是**整行即选项**的锚定正则，
  不然注释会被算成证据。
- 刻意**没有**开 `skipTaskbar`：那是"不在任务栏显示应用按钮"，窗口藏起来之后用户就找不回来了。
  用户要的是去掉原生标题栏按钮，不是让应用从任务栏消失 —— 托盘图标照旧常驻。

### 验收 2 · 三个动作分别落到 minimize / toggle-maximize / close

静态部分把 `switch (String(action))` 的每个 `case` 臂单独切出来逐臂检查（而不是"文件里存在某个调用"这种弱证据）：

```
✓ case 'minimize'        → w.minimize()                              —— main.js:192
✓ case 'toggle-maximize' → if (w.isMaximized()) w.unmaximize(); else w.maximize();  —— main.js:195
✓ case 'close'           → w.close()                                 —— main.js:204
✓ close 臂里没有 hide()/quit()（不绕过 closeToTray 与 before-quit 清理链）
· closeToTray 判定仍在 close 事件里：main.js:344  if (!quitting && core?.getConfig().server?.closeToTray !== false)
```

运行时（桩机的 `close()` 会派发 `'close'` 事件，`preventDefault()` 能阻止销毁，所以这条链是**真跑出来**的）：

```
✓ 动作 minimize → BrowserWindow.minimize()                        —— 调用序列 [minimize]
✓ 未最大化时 toggle-maximize → maximize()                         —— 调用序列 [maximize]
✓ 已最大化时 toggle-maximize → unmaximize()                       —— 调用序列 [unmaximize]
✓ 动作 close → BrowserWindow.close()                              —— 调用序列 [close, hide]
✓ close 没有直接 app.quit()
✓ closeToTray=true 时缩到托盘（close 事件被 preventDefault + hide，窗口未销毁）  —— hide=true prevented=true
✓ closeToTray=false 时 close 真的销毁窗口（不 hide）              —— 调用序列 [close] destroyed=true
✓ 未知动作 quit 被忽略，不触发任何窗口调用                        —— 调用序列 []
```

即关闭按钮的行为与旧版点原生关闭按钮完全一致：交给 `close()`，由用户配置的 `closeToTray`
决定缩托盘还是退出。

### 验收 3 · 窗口状态回推

```
✓ 存在统一注册事件数组的 for-of —— main.js:312
    for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'show', 'focus', 'blur'])
✓ 7 个事件一个不少
✓ 这些事件绑定的都是 pushWindowState
✓ pushWindowState 有 isDestroyed 守卫 + try/catch（窗口销毁中不抛错）
✓ 窗口事件 maximize / unmaximize / enter-full-screen / leave-full-screen / show / focus / blur → 各推送 1 次状态
✓ 状态载荷是 {maximized,fullScreen,visible,focused} 四个布尔值 —— {"maximized":false,"fullScreen":false,"visible":true,"focused":true}
✓ did-finish-load 时 show + focus + 首次同步状态 —— 调用序列 [show, focus]
✓ qqa-window-state 返回状态快照
✓ 窗口已销毁时再推状态：pushWindowState 不抛错
✓ 窗口已销毁时收到 qqa-window：静默返回，不抛错
✓ 窗口已销毁时查询 qqa-window-state：返回全 false 而不抛错
```

### 验收 4 · 预加载桥契约

```
✓ 暴露 refocus / captchaNetProbe / captchaInterceptorStatus（原有三个，未改名）—— preload.cjs:20 / 24 / 26
✓ 暴露 controls / windowState / onMaximizeChange（新增）—— preload.cjs:32 / 44 / 45
✓ refocus() → send(app-refocus)
✓ captchaNetProbe() → invoke(qqa-captcha-net-probe)
✓ captchaInterceptorStatus() → invoke(qqa-captcha-interceptor-status)
✓ controls.minimize / maximize / unmaximize / toggle-maximize / close 各自 → send(qqa-window, <动作>)
✓ controls.send 放行白名单动作 —— [minimize, maximize, unmaximize, toggle-maximize, close]
✓ controls.send 把非白名单动作全部挡掉 —— 拒绝 [quit, hide, destroy, reload, devtools, exec, __proto__]
✓ onMaximizeChange 返回取消订阅函数；取消后不再回调（removeListener 已调用）
✓ onMaximizeChange 传非函数时返回空函数而不是抛错
✓ 渲染层回调抛错被吞掉，不会把异常甩回主进程
✓ preload 白名单动作 ⊆ 主进程 qqa-window 处理的动作
```

最后一条是跨文件契约检查：预加载放行的动作集合必须是主进程认得的子集，否则新 UI
点按钮会静默失效。两边各自都对、但对不上，是这种"主进程 + 预加载"改法最容易漏的坑。

### 验收 5 · 语法与加载

```
✓ main.js（拷成 .mjs 后 node --check）退出码 0 —— 无输出
✓ preload.cjs（node --check，CommonJS）退出码 0 —— 无输出
✓ 负向对照：故意写坏的 .mjs 被拦下（退出码非 0）—— 退出码 1
· 对照：同一份坏文件存成 .js 时 node --check 退出码 0 → 假绿
```

#### 三条路只有一条能用（实测取舍）

| 方案 | 命令 | 实测结论 |
| --- | --- | --- |
| A. 直接对 `.js` 跑 `--check` | `node --check app/electron/main.js` | ✗ **假绿，不能用**。同一份故意写坏的文件（`const x = ;`）存成 `.js` 时它照样返回 0；换成 `.mjs` 才返回 1。也就是说它对 ESM 根本没有做语法检查，全绿是空转。 |
| B. 走 stdin | `Get-Content main.js -Raw \| node --input-type=module --check` | ✓ 能真正拦下语法错（坏文件退出码 1），但要经过 shell 的文本编码往返（UTF-8 / CRLF / BOM 都可能被顺手改掉），依赖调用方凑得出管道。 |
| C. **拷成 `.mjs` 再 `--check`** | `Copy-Item main.js tmp.mjs; node --check tmp.mjs` | ✓ **选它**。两个理由：`.mjs` 扩展名让 Node 真正按模块语法解析；文件用 `copyFileSync` 做字节级复制，不经过任何文本转换 —— 检查的就是要装上去的那份字节。 |

验证器里放了负向对照（故意写坏的 `.mjs` 必须被拦下），这样将来 Node 行为再变，
"全绿"不会退化成空转。

### 验收 6 · 真机（安装目录）逐字节一致

```powershell
Get-FileHash 'E:\QQ Agent Dev\qq-agent-ui-next\app\electron\main.js','E:\QQ Agent\resources\app\electron\main.js' -Algorithm SHA256
```

```
main.js      工作区 76077745683D80957377CFC6BF1D6EF5B5C5204BF8888721B54E69DCD9816495 (21036B)
             安装版 76077745683D80957377CFC6BF1D6EF5B5C5204BF8888721B54E69DCD9816495 (21036B)  => 一致 ✓
preload.cjs  工作区 A6A9962F757D4A80717561B54048E8E9F1F70381B9365B7B14C92EDDE5A4AC66 (3552B)
             安装版 A6A9962F757D4A80717561B54048E8E9F1F70381B9365B7B14C92EDDE5A4AC66 (3552B)   => 一致 ✓
```

安装前的旧版哈希（备份里可查）：`main.js e35637c00026`、`preload.cjs 3315f0260425`。

## 安装 / 回滚

```powershell
node tools/apply-electron.mjs                            # 预览，不写盘
node tools/apply-electron.mjs --apply                    # 备份并安装
node tools/apply-electron.mjs --list                     # 列出全部备份
node tools/apply-electron.mjs --rollback 20261003-221632 # 回滚到那次安装之前
node tools/apply-electron.mjs --install-dir "D:\x"       # 换安装目录（默认 E:\QQ Agent）
```

安装流程的每一步都是为了一个具体的坑：

1. **先备份**到 `_backup/electron-<时间戳>/`，并且**先把 `manifest.json` 落盘、再动安装目录** ——
   万一写到一半断电，盘上仍有完整的回滚依据。
2. **写临时文件 + rename 顶替**（同目录，保证不跨卷），避免留下半个文件让 Electron 下次白屏。
3. **立刻回读校验 sha256**，对不上就从本次备份自动还原，退出码 1。
4. 全程**只写文件**，不启动 / 不重启 / 不结束任何进程；只检测进程在不在，用于打印提醒。
5. `--rollback` 只允许写回 manifest 记录的安装目录**之内** —— 否则一个被手改的 manifest
   就成了"往任意路径写文件"的工具（已验证：把 target 改成 `C:\Windows\Temp\evil.js` 会被拒绝，
   文件不会被创建）。

> **别被时间戳骗了**：`fs.copyFileSync` 在 Windows 上走的是 `CopyFileW`，会把源文件的修改时间
> 一并带过去。所以安装后的 `resources\app\electron\main.js` 在资源管理器里显示的是
> **工作区那份的编辑时间**（2026/10/3 21:52），而不是安装时间（22:16）。
> 判断"到底装上没有"请看哈希或 `--list` 的 `createdAt`，不要看 mtime。

回滚链路的端到端测试（在临时目录里造了一份假安装目录跑完整流程，测完已清理）：

```
✓ apply 到假目录后与工作区哈希一致
✓ rollback 后 main.js / preload.cjs 均还原为原字节
✓ 篡改 manifest 的 target 到目录外 → 拒绝执行，退出码 1，目标文件未被创建
```

## 风险与边界（没做到的、以及要人接手的地方）

- **桩机不是真窗口管理器**。它证明的是主进程 / 预加载的**逻辑分支**正确，证明不了
  "窗口在屏幕上真的最小化了""无边框窗口在 Windows 上拖动正常"。这需要人肉点一次。
  桩机也不模拟 `contextBridge` 的跨上下文对象序列化（只记录暴露出去的对象本身）。
- **正在运行的进程仍跑旧代码**。文件已经就位，但 Electron 是启动时读 `main.js` 的，
  要看到无边框效果必须重启。是否重启由 Lead / 用户决定，本次没有替用户重启。
- **F5 的行为已核实是安全的**：安装版的 `resources/app/ui/` 只有 3 处调用
  `window.qqAgentShell`（`refocus` ×2、`captchaNetProbe`、`captchaInterceptorStatus`），
  一个都不碰新增的 `controls` / `windowState`，所以即便用户在重启前按了 F5，
  也只是"新 preload + 旧主进程"且新通道没人用，不会踩空。
  但等带自绘标题栏的新 UI 也装上去之后，两者必须**一起**重启，不能再混用。
- 备份目录 `_backup/electron-20261003-221632/` 是本次唯一保留的真实备份，不要顺手删。
