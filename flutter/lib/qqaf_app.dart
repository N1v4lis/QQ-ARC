import 'dart:async';

import 'package:flutter/material.dart';

import 'core_client.dart';
import 'workspace_page.dart';
import 'app_style.dart';

import 'legacy_shell.dart';
import 'desktop_pages.dart';
import 'startup_animation.dart';

class QqafApp extends StatefulWidget {
  const QqafApp({
    super.key,
    required this.core,
    this.animateStartup = true,
    this.onExit,
  });
  final CoreApi core;
  final bool animateStartup;
  final VoidCallback? onExit;
  @override
  State<QqafApp> createState() => _QqafAppState();
}

class _QqafAppState extends State<QqafApp> {
  int section = 0;
  bool startupFinished = false, coldStartup = true;
  bool dark = false, minecraft = false, busy = false;
  String? account;
  List<String> accounts = [];
  Map<String, dynamic> status = {}, usage = {};
  Map<String, dynamic> uiPrefs = {};
  String notice = '正在连接 Rust 核心…', activeModel = '';
  final qq = TextEditingController(), ws = TextEditingController();
  final token = TextEditingController();
  Timer? refresh;
  Timer? preferenceSave;
  Future<void> preferenceQueue = Future<void>.value();
  int pendingPreferenceSaves = 0;

  @override
  void initState() {
    super.initState();
    startupFinished = !widget.animateStartup;
    unawaited(boot());
    refresh = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!busy) unawaited(refreshSnapshot());
    });
  }

  @override
  void dispose() {
    refresh?.cancel();
    preferenceSave?.cancel();
    for (final controller in [qq, ws, token]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> perform(Future<void> Function() operation) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await operation();
    } catch (error) {
      if (mounted) setState(() => notice = '$error');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> boot() async {
    await perform(() async {
      final state =
          await widget.core.request('/status') as Map<String, dynamic>;
      final prefs =
          await widget.core.request('/preferences') as Map<String, dynamic>;
      final ids = List<String>.from(
        await widget.core.request('/accounts') as List,
      );
      if (!mounted) return;
      setState(() {
        status = state;
        accounts = ids;
        account = ids.isEmpty ? null : ids.first;
        dark = prefs['theme'] == 'dark';
        minecraft = prefs['skin'] == 'minecraft';
        uiPrefs = prefs;
        notice = 'Rust 核心已连接 · 独立迁移数据目录';
      });
      if (account != null) await loadAccount();
    });
  }

  Future<void> loadAccount() async => refreshSnapshot();

  Future<void> refreshSnapshot() async {
    try {
      final state =
          await widget.core.request('/status') as Map<String, dynamic>;
      final ids = List<String>.from(
        await widget.core.request('/accounts') as List,
      );
      final prefs =
          preferenceSave?.isActive == true || pendingPreferenceSaves > 0
          ? null
          : await widget.core.request('/preferences') as Map<String, dynamic>;
      final id = account;
      Map<String, dynamic> nextUsage = {};
      String nextModel = '';
      if (id != null) {
        final config = await widget.core.request(
          '/config',
          query: {'account': id},
        );
        if (config is Map && config['api'] is Map) {
          nextModel = '${config['api']['model'] ?? ''}';
        }
        nextUsage = Map<String, dynamic>.from(
          await widget.core.request('/stats', query: {'account': id}) as Map,
        );
      }
      if (!mounted || id != account) return;
      setState(() {
        status = state;
        accounts = ids;
        if (prefs != null) {
          uiPrefs = prefs;
          dark = prefs['theme'] == 'dark';
          minecraft = prefs['skin'] == 'minecraft';
        }
        if (account == null && ids.isNotEmpty) account = ids.first;
        usage = nextUsage;
        activeModel = nextModel;
      });
    } catch (_) {
      /* Explicit actions report errors; periodic refresh leaves the last snapshot. */
    }
  }

  Widget field(
    String label,
    TextEditingController controller, {
    bool secret = false,
    int lines = 1,
    String? hint,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: TextField(
      controller: controller,
      obscureText: secret,
      maxLines: lines,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
    ),
  );
  void playSound(String name, String channel) {
    if (!minecraft || uiPrefs['sound'] != true) return;
    final category = channel == 'switch' ? 'toggle' : channel;
    final selected = uiPrefs['${category}Sound'];
    if (selected == 'none') return;
    if (category == 'click') {
      name = selected == 'hit'
          ? 'hit${DateTime.now().millisecondsSinceEpoch % 3 + 1}'
          : selected as String? ?? name;
    } else if (category == 'toggle' && selected == 'beacon') {
      name = name == 'pistonout' ? 'beaconactivate' : 'beacondeactivate';
    }
    final volume =
        ((uiPrefs['masterVolume'] as num?)?.toDouble() ?? 1) *
        ((uiPrefs['${category}Volume'] as num?)?.toDouble() ?? 1);
    unawaited(
      widget.core
          .request('/ui/sound', body: {'name': name, 'volume': volume})
          .then<void>((_) {})
          .catchError((Object _) {}),
    );
  }

  @override
  Widget build(BuildContext context) {
    final connected = List<String>.from(
      status['connected_accounts'] as List? ?? [],
    );
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: appTheme(
        dark: false,
        minecraft: minecraft,
        prefs: uiPrefs,
        toggleSound: (v) => playSound(v ? 'pistonout' : 'pistonin', 'toggle'),
      ),
      darkTheme: appTheme(
        dark: true,
        minecraft: minecraft,
        prefs: uiPrefs,
        toggleSound: (v) => playSound(v ? 'pistonout' : 'pistonin', 'toggle'),
      ),
      themeMode: uiPrefs['theme'] == 'auto'
          ? ThemeMode.system
          : dark
          ? ThemeMode.dark
          : ThemeMode.light,
      builder: (context, child) => Stack(
        children: [
          Positioned.fill(
            child: ColoredBox(
              color: Theme.of(context).brightness == Brightness.dark
                  ? const Color(0xff151517)
                  : const Color(0xfff7f8fa),
            ),
          ),
          if (minecraft && uiPrefs['background'] == true)
            Positioned.fill(
              child: Opacity(
                opacity: ((uiPrefs['opacity'] as num?)?.toDouble() ?? .55)
                    .clamp(0, 1),
                child: Image.asset(
                  'assets/mc/bg/wallpaper-${uiPrefs['wallpaper'] ?? 1}.png',
                  fit: BoxFit.cover,
                  filterQuality: FilterQuality.medium,
                ),
              ),
            ),
          ?child,
        ],
      ),
      home: Builder(
        builder: (pageContext) => LegacyShell(
          exit: widget.onExit,
          overlay: startupFinished
              ? null
              : ArcfoxStartup(
                  ready: !busy,
                  duration: Duration(milliseconds: coldStartup ? 2000 : 1000),
                  status: notice,
                  complete: () {
                    if (mounted) setState(() => startupFinished = true);
                  },
                ),
          collapseChanged: (collapsed) =>
              playSound(collapsed ? 'pistonin' : 'pistonout', 'switch'),
          section: section,
          minecraft: minecraft,
          busy: busy,
          notice: notice,
          model: activeModel.isEmpty ? '未配置' : activeModel,
          refresh: () {
            setState(() {
              coldStartup = false;
              startupFinished = !widget.animateStartup;
            });
            unawaited(perform(refreshSnapshot));
          },
          select: (id) {
            playSound('menu', 'click');
            setState(() => section = id);
          },
          toolbar: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: Theme.of(pageContext).cardColor,
                    borderRadius: BorderRadius.circular(minecraft ? 0 : 20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.circle,
                        size: 8,
                        color: account != null && connected.contains(account)
                            ? Colors.green
                            : Colors.grey,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        account != null && connected.contains(account)
                            ? 'OneBot 已连接'
                            : 'OneBot 未连接',
                        style: const TextStyle(fontSize: 11),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 120,
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(account),
                    initialValue: account,
                    decoration: const InputDecoration(
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                    ),
                    hint: const Text('选择账号'),
                    items: accounts
                        .map(
                          (id) => DropdownMenuItem(value: id, child: Text(id)),
                        )
                        .toList(),
                    onChanged: busy
                        ? null
                        : (id) {
                            setState(() => account = id);
                            unawaited(perform(loadAccount));
                          },
                  ),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: () => setState(() => section = 8),
                  child: const Text('人设/模型设置'),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '调用 ${usage['calls'] ?? 0} 次 · 估算 ${usage['estimated_cost'] ?? 0}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
          content: desktopContent(pageContext, connected),
        ),
      ),
    );
  }

  Widget desktopContent(BuildContext context, List<String> connected) {
    if ([0, 7].contains(section)) {
      return UsageWorkspace(
        key: ValueKey('$account:$section'),
        core: widget.core,
        account: account,
        dashboard: section == 0,
        navigate: (id) => setState(() => section = id),
      );
    }
    if (section == 1) {
      return SessionWorkspace(
        key: ValueKey('$account:sessions'),
        core: widget.core,
        account: account,
        connected: connected.contains(account),
      );
    }
    if (section == 4) {
      return MemoryWorkspace(
        key: ValueKey('$account:memory'),
        core: widget.core,
        account: account,
      );
    }
    if (section == 11) {
      return AccountWorkspace(
        key: ValueKey('$account:accounts'),
        core: widget.core,
        current: account,
        select: (id) => unawaited(
          perform(() async {
            final ids = List<String>.from(
              await widget.core.request('/accounts') as List,
            );
            if (!mounted) return;
            setState(() {
              accounts = ids;
              account = id;
            });
            await loadAccount();
          }),
        ),
      );
    }
    if (section == 6) {
      return ArchiveWorkspace(
        key: ValueKey('$account:archive'),
        core: widget.core,
        account: account,
      );
    }
    if (section == 8) {
      return WorkspacePage(
        key: ValueKey('$account:persona'),
        core: widget.core,
        account: account,
        page: 'persona',
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      children: content(context, connected),
    );
  }

  List<Widget> content(BuildContext pageContext, List<String> connected) {
    if (section == 5) {
      return [
        ThemeWorkspace(
          prefs: {
            ...uiPrefs,
            'theme': uiPrefs['theme'] ?? (dark ? 'dark' : 'light'),
            'skin': minecraft ? 'minecraft' : 'default',
          },
          changed: (value) {
            setState(() {
              uiPrefs = value;
              dark = value['theme'] == 'dark';
              minecraft = value['skin'] == 'minecraft';
            });
            preferenceSave?.cancel();
            preferenceSave = Timer(const Duration(milliseconds: 150), () {
              final snapshot = Map<String, dynamic>.from(uiPrefs);
              pendingPreferenceSaves++;
              preferenceQueue = preferenceQueue.then((_) async {
                try {
                  await widget.core.request('/preferences', body: snapshot);
                } catch (error) {
                  if (mounted) setState(() => notice = '$error');
                } finally {
                  pendingPreferenceSaves--;
                }
              });
            });
          },
        ),
      ];
    }
    const pages = <int, String>{
      2: 'api',
      6: 'archive',
      7: 'usage',
      8: 'persona',
      9: 'skills',
      10: 'plugins',
      11: 'accounts',
      12: 'whitelist',
      13: 'chat-settings',
      14: 'desktop',
      15: 'personalize',
      16: 'advanced',
      17: 'tools',
      18: 'markets',
    };
    if (pages.containsKey(section)) {
      return [
        WorkspacePage(
          key: ValueKey('$account:$section'),
          core: widget.core,
          account: account,
          page: pages[section]!,
        ),
      ];
    }
    switch (section) {
      case 3:
        return [
          const Text(
            'OneBot / SnowLuma',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          field('QQ 账号', qq),
          field('正向 WebSocket 地址', ws, hint: 'ws://127.0.0.1:端口'),
          field('Access Token（本机加密保存）', token, secret: true),
          const Text('QQ 客户端由用户提供。填写 SnowLuma 的 OneBot 正向 WS 配置，点击连接后开始接收消息。'),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            children: [
              FilledButton(
                onPressed: busy
                    ? null
                    : () => perform(() async {
                        final id = qq.text.trim();
                        await widget.core.request(
                          '/onebot/connect',
                          body: {
                            'account': id,
                            'address': ws.text.trim(),
                            'access_token': token.text,
                          },
                        );
                        final ids = List<String>.from(
                          await widget.core.request('/accounts') as List,
                        );
                        if (mounted) {
                          setState(() {
                            accounts = ids;
                            account = id;
                            notice = 'OneBot 已连接';
                          });
                        }
                        await loadAccount();
                      }),
                child: const Text('连接 SnowLuma'),
              ),
              OutlinedButton(
                onPressed: busy || account == null
                    ? null
                    : () => perform(() async {
                        await widget.core.request(
                          '/onebot/disconnect',
                          body: {'account': account},
                        );
                        await refreshSnapshot();
                      }),
                child: const Text('断开当前账号'),
              ),
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () => perform(() async {
                        final id = qq.text.trim();
                        await widget.core.request(
                          '/accounts',
                          body: {'account': id},
                        );
                        final ids = List<String>.from(
                          await widget.core.request('/accounts') as List,
                        );
                        if (mounted) {
                          setState(() {
                            accounts = ids;
                            account = id;
                            notice = '独立账号已创建';
                          });
                        }
                        await loadAccount();
                      }),
                child: const Text('仅创建离线账号'),
              ),
            ],
          ),
          if (account != null)
            WorkspacePage(
              key: ValueKey('$account:snow'),
              core: widget.core,
              account: account,
              page: 'snow',
            ),
        ];
      default:
        return [const Text('请选择功能页')];
    }
  }
}
