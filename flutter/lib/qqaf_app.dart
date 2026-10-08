import 'dart:async';

import 'package:flutter/material.dart';

import 'core_client.dart';
import 'workspace_page.dart';
import 'app_style.dart';

import 'legacy_shell.dart';

class QqafApp extends StatefulWidget {
  const QqafApp({super.key, required this.core});
  final CoreApi core;
  @override
  State<QqafApp> createState() => _QqafAppState();
}

class _QqafAppState extends State<QqafApp> {
  int section = 0;
  bool dark = false, minecraft = false, busy = false;
  String? account, chat;
  List<String> accounts = [], chats = [];
  List<Map<String, dynamic>> messages = [];
  Map<String, dynamic> status = {}, usage = {};
  Map<String, dynamic> uiPrefs = {};
  List<dynamic> memories = [];
  final memory = TextEditingController();
  String notice = '正在连接 Rust 核心…', answer = '';
  final qq = TextEditingController(), ws = TextEditingController();
  final token = TextEditingController(), message = TextEditingController();
  final base = TextEditingController(), model = TextEditingController();
  final key = TextEditingController(), prompt = TextEditingController();
  final inputPrice = TextEditingController(),
      outputPrice = TextEditingController();
  Timer? refresh;
  Timer? preferenceSave;
  Future<void> preferenceQueue = Future<void>.value();
  int pendingPreferenceSaves = 0;

  @override
  void initState() {
    super.initState();
    unawaited(boot());
    refresh = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!busy) unawaited(updateMessages());
    });
  }

  @override
  void dispose() {
    refresh?.cancel();
    preferenceSave?.cancel();
    for (final controller in [
      qq,
      ws,
      token,
      message,
      base,
      model,
      key,
      prompt,
      inputPrice,
      outputPrice,
      memory,
    ]) {
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

  Future<void> loadAccount() async {
    final id = account;
    if (id == null) return;
    final config = await widget.core.request(
      '/model/config',
      query: {'account': id},
    ) as Map<String, dynamic>;
    if (!mounted || id != account) return;
    base.text = '${config['base_url'] ?? ''}';
    model.text = '${config['model'] ?? ''}';
    prompt.text = '${config['system_prompt'] ?? ''}';
    key.clear();
    inputPrice.text = '${config['input_per_million'] ?? 0}';
    outputPrice.text = '${config['output_per_million'] ?? 0}';
    setState(() {
      chat = null;
      messages = [];
      answer = '';
    });
    await updateMessages();
  }

  Future<void> updateMessages() async {
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
      final selected = chat;
      List<String> items = [];
      List<Map<String, dynamic>> rows = [];
      Map<String, dynamic> nextUsage = {};
      List<dynamic> nextMemories = [];
      if (id != null) {
        items = List<String>.from(
          await widget.core.request('/chats', query: {'account': id}) as List,
        );
        nextUsage = Map<String, dynamic>.from(
          await widget.core.request('/stats', query: {'account': id}) as Map,
        );
        nextMemories = await widget.core.request(
          '/memory',
          query: {'account': id, 'chat': selected ?? 'scratch'},
        ) as List;
        if (selected != null) {
          rows = (await widget.core.request(
            '/messages',
            query: {'account': id, 'chat': selected},
          ) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        }
      }
      if (!mounted || id != account || selected != chat) return;
      setState(() {
        status = state;
        accounts = ids;
        if (prefs != null) {
          uiPrefs = prefs;
          dark = prefs['theme'] == 'dark';
          minecraft = prefs['skin'] == 'minecraft';
        }
        if (account == null && ids.isNotEmpty) account = ids.first;
        chats = items;
        messages = rows;
        usage = nextUsage;
        memories = nextMemories;
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
    final volume =
        ((uiPrefs['masterVolume'] as num?)?.toDouble() ?? 1) *
        ((uiPrefs['${channel}Volume'] as num?)?.toDouble() ?? 1);
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
      theme: appTheme(dark: false, minecraft: minecraft, prefs: uiPrefs),
      darkTheme: appTheme(dark: true, minecraft: minecraft, prefs: uiPrefs),
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
          section: section,
          minecraft: minecraft,
          busy: busy,
          notice: notice,
          model: model.text.isEmpty ? '未配置' : model.text,
          refresh: () => unawaited(perform(updateMessages)),
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
          content: ListView(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
            children: content(pageContext, connected),
          ),
        ),
      ),
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
      case 0:
        return [
          const Text(
            '仪表盘',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          const Text('旧架构开发无限期暂停，恢复时间待定。此开发版不代表旧客户端全部功能已迁移。'),
          const SizedBox(height: 24),
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              summary('独立账号', '${accounts.length}'),
              summary('OneBot 连接', '${connected.length}'),
              summary('当前会话', '${chats.length}'),
              summary('模型调用', '${usage['calls'] ?? 0}'),
              summary(
                '累计 Token',
                '${(usage['input_tokens'] ?? 0) + (usage['output_tokens'] ?? 0)}',
              ),
              summary('估算成本', '${usage['estimated_cost'] ?? 0}'),
            ],
          ),
          const SizedBox(height: 24),
          const Text('消息正文直接写入 Rust SQLite，按账号隔离、按消息 ID 分页。模型对话不会自动发送到 QQ。'),
          const SizedBox(height: 16),
          const Text('酒狐实现仍在评估：Slint 承载或直接原生 3D。当前保持关闭。'),
        ];
      case 1:
        return [
          const Text(
            '会话',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: chats
                .map(
                  (id) => ChoiceChip(
                    label: Text(id),
                    selected: chat == id,
                    onSelected: (_) {
                      setState(() => chat = id);
                      unawaited(updateMessages());
                    },
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: busy || account == null
                ? null
                : () async {
                    final controller = TextEditingController();
                    final value = await showDialog<String>(
                      context: pageContext,
                      builder: (context) => AlertDialog(
                        title: const Text('选择会话'),
                        content: TextField(
                          controller: controller,
                          decoration: const InputDecoration(
                            hintText: 'group:群号 或 private:QQ号',
                          ),
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context),
                            child: const Text('取消'),
                          ),
                          FilledButton(
                            onPressed: () =>
                                Navigator.pop(context, controller.text.trim()),
                            child: const Text('选择'),
                          ),
                        ],
                      ),
                    );
                    if (value != null && mounted) {
                      setState(() => chat = value);
                      unawaited(updateMessages());
                    }
                  },
            child: const Text('指定群聊或私聊'),
          ),
          for (final row in messages.reversed)
            ListTile(
              title: Text('${row['text']}'),
              subtitle: Text('${row['sender']} · ${row['timestamp']}'),
            ),
          const SizedBox(height: 16),
          field('消息', message, lines: 3),
          Wrap(
            spacing: 12,
            children: [
              FilledButton(
                onPressed: busy || account == null || chat == null
                    ? null
                    : () => perform(() async {
                        final text = message.text;
                        await widget.core.request(
                          '/onebot/send',
                          body: {
                            'account': account,
                            'chat': chat,
                            'text': text,
                          },
                        );
                        message.clear();
                        notice = '消息已发送到 QQ';
                        await updateMessages();
                      }),
                child: const Text('发送到 QQ'),
              ),
              OutlinedButton(
                onPressed: busy || account == null
                    ? null
                    : () => perform(() async {
                        final result = await widget.core.request(
                          '/model/chat',
                          body: {
                            'account': account,
                            'chat': chat ?? 'scratch',
                            'text': message.text,
                          },
                        ) as Map;
                        if (mounted) {
                          setState(() {
                            answer = '${result['text']}';
                            notice =
                                '输入 ${result['input_tokens']} · 输出 ${result['output_tokens']} Token · 估算 ${result['estimated_cost']}';
                          });
                        }
                      }),
                child: const Text('发送到模型'),
              ),
            ],
          ),
          if (answer.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 20),
              child: SelectableText(answer),
            ),
        ];
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
                        await updateMessages();
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
      case 4:
        return [
          const Text(
            '会话记忆',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Text('当前目标：${chat ?? 'scratch'} · 保存后供该会话模型上下文使用'),
          const SizedBox(height: 16),
          field('记忆内容', memory, lines: 4),
          FilledButton(
            onPressed: busy || account == null
                ? null
                : () => perform(() async {
                    await widget.core.request(
                      '/memory',
                      body: {
                        'account': account,
                        'chat': chat ?? 'scratch',
                        'text': memory.text,
                      },
                    );
                    memory.clear();
                    await updateMessages();
                  }),
            child: const Text('保存记忆'),
          ),
          for (final item in memories)
            ListTile(
              title: Text('${item[1]}'),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: busy
                    ? null
                    : () => perform(() async {
                        await widget.core.request(
                          '/memory/delete',
                          body: {'account': account, 'id': item[0]},
                        );
                        await updateMessages();
                      }),
              ),
            ),
        ];
      default:
        return [const Text('请选择功能页')];
    }
  }

  Widget summary(String title, String value) => SizedBox(
    width: 200,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title),
            const SizedBox(height: 12),
            Text(
              value,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
    ),
  );
}
