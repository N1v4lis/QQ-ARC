import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core_client.dart';
import 'app_style.dart';
import 'desktop_bridge.dart';
import 'price_catalogue.dart';

typedef JsonMap = Map<String, dynamic>;
JsonMap object(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : {};

/// Native account workspace. Each page owns drafts; rebuilding the shell does
/// not submit them or reset the provider currently being edited.
class WorkspacePage extends StatefulWidget {
  const WorkspacePage({
    super.key,
    required this.core,
    required this.account,
    required this.page,
  });
  final CoreApi core;
  final String? account;
  final String page;
  @override
  State<WorkspacePage> createState() => _WorkspacePageState();
}

class _WorkspacePageState extends State<WorkspacePage> {
  JsonMap config = {}, data = {}, persona = {}, templates = {};
  List<dynamic> rows = [], history = [];
  List<String> chats = [];
  String? provider, selectedModel;
  String target = '', tab = 'body', notice = '';
  bool loading = true, saving = false;
  final Map<String, TextEditingController> controllers = {};
  TextEditingController control(String key, [dynamic initial]) =>
      controllers.putIfAbsent(
        key,
        () => TextEditingController(text: initial?.toString() ?? ''),
      );
  Future<dynamic> get(String path, [Map<String, String>? extra]) =>
      widget.core.request(path, query: {'account': widget.account!, ...?extra});
  Future<dynamic> post(String path, Object body) =>
      widget.core.request(path, body: body);
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  @override
  void dispose() {
    if (!saving) releaseControllers();
    super.dispose();
  }

  void redraw(VoidCallback update) {
    if (mounted) setState(update);
  }

  void releaseControllers() {
    for (final controller in controllers.values) {
      controller.dispose();
    }
    controllers.clear();
  }

  Future<void> run(Future<void> Function() operation) async {
    if (saving || !mounted) return;
    redraw(() => saving = true);
    try {
      await operation();
    } catch (error) {
      if (mounted) redraw(() => notice = '$error');
    } finally {
      if (mounted) {
        redraw(() => saving = false);
      } else {
        releaseControllers();
      }
    }
  }

  Future<void> load() async {
    if (widget.account == null) {
      redraw(() => loading = false);
      return;
    }
    try {
      config = object(await get('/config'));
      chats = List<String>.from(await get('/chats') as List);
      switch (widget.page) {
        case 'archive':
          rows = await get('/archive') as List;
          break;
        case 'usage':
          data = object(await get('/usage'));
          break;
        case 'tools':
          rows = await get('/tools') as List;
          break;
        case 'skills':
        case 'plugins':
          rows = await get('/extensions') as List;
          break;
        case 'persona':
          templates = object(await widget.core.request('/persona/templates'));
          await loadPersona();
          break;
        case 'api':
          final providers = config['providers'] as List? ?? [];
          provider = providers.isEmpty ? null : '${providers.first['id']}';
          selectedModel = modelValue(object(config['api']));
          break;
        case 'desktop':
        case 'personalize':
          data = object(await widget.core.request('/preferences'));
          break;
      }
    } catch (error) {
      notice = '$error';
    }
    if (mounted) redraw(() => loading = false);
  }

  Future<void> saveConfig(JsonMap patch) async {
    await post('/config', {'account': widget.account, 'patch': patch});
    if (mounted) redraw(() => notice = '已保存');
  }

  Future<void> loadPersona() async {
    final result = object(await get('/persona', {'target': target}));
    if (!mounted) return;
    persona = {...object(result['defaults']), ...object(result['value'])};
    history = result['history'] as List? ?? [];
    for (final name in [
      'roleText',
      'customRules',
      'systemPromptOverride',
      'botName',
      'selfNickname',
    ]) {
      control('persona:$name').text = '${persona[name] ?? ''}';
    }
  }

  Widget heading(String title, [String? subtitle]) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    ),
  );
  Widget input(
    String label,
    String key,
    dynamic initial, {
    bool secret = false,
    int lines = 1,
    ValueChanged<String>? changed,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextField(
      controller: control(key, initial),
      obscureText: secret,
      minLines: lines,
      maxLines: lines == 1 ? 1 : lines + 8,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      onChanged: changed,
    ),
  );
  Widget button(String text, Future<void> Function() operation) =>
      OutlinedButton(
        onPressed: saving ? null : () => run(operation),
        child: Text(text),
      );
  Widget columns(Widget left, Widget right) => LayoutBuilder(
    builder: (context, constraints) => constraints.maxWidth < 780
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [left, const SizedBox(height: 24), right],
          )
        : Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: left),
              const SizedBox(width: 20),
              Expanded(child: right),
            ],
          ),
  );
  Widget section(String title, List<Widget> children) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [heading(title), ...children],
  );
  Widget dropdown(
    String label,
    String? value,
    List<DropdownMenuItem<String>> items,
    ValueChanged<String?> changed,
  ) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: DropdownButtonFormField<String>(
      key: ValueKey('$label:$value'),
      initialValue: items.any((i) => i.value == value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        isDense: true,
      ),
      items: items,
      onChanged: saving ? null : changed,
    ),
  );
  @override
  Widget build(BuildContext context) {
    if (widget.account == null && widget.page != 'accounts') {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Text('请先在账号页面创建账号。'),
      );
    }
    if (loading) return const Center(child: CircularProgressIndicator());
    final content = switch (widget.page) {
      'api' => apiPage(),
      'archive' => archivePage(),
      'usage' => usagePage(),
      'persona' => personaPage(),
      'whitelist' => whitelistPage(),
      'skills' || 'plugins' || 'tools' => extensionsPage(),
      'accounts' => accountsPage(),
      'markets' => marketsPage(),
      'desktop' || 'personalize' => desktopPage(),
      'snow' => snowPage(),
      _ => settingsPage(),
    };
    return CallbackShortcuts(
      bindings: widget.page == 'persona'
          ? {
              const SingleActivator(
                LogicalKeyboardKey.keyS,
                control: true,
              ): () =>
                  unawaited(run(() => commitPersona(tab))),
            }
          : const {},
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          content,
          if (notice.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: SelectableText(notice),
            ),
        ],
      ),
    );
  }

  String modelValue(JsonMap api) => (api['model'] as String? ?? '').isEmpty
      ? ''
      : '${api['provider'] ?? ''}|||${api['model'] ?? ''}';
  JsonMap get api => object(config['api']);
  List<dynamic> get providers => config['providers'] as List? ?? [];
  JsonMap get currentProvider =>
      object(providers.where((p) => p['id'] == provider).firstOrNull);
  List<DropdownMenuItem<String>> modelItems({bool empty = false}) => [
    if (empty) const DropdownMenuItem(value: '', child: Text('沿用默认模型')),
    for (final p in providers)
      for (final m in p['models'] as List? ?? [])
        DropdownMenuItem(
          value: '${p['id']}|||${m is String ? m : m['id']}',
          child: Text(
            '${p['name'] ?? p['id']} · ${m is String ? m : m['name'] ?? m['id']}',
            overflow: TextOverflow.ellipsis,
          ),
        ),
  ];
  Future<String?> ask(String title, {String initial = ''}) async {
    final controller = TextEditingController(text: initial);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('确定'),
          ),
        ],
      ),
    );
    // Dialog teardown owns its final animation before disposing the controller.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    controller.dispose();
    return mounted ? result : null;
  }

  Future<bool> confirm(String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(text),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('确定'),
            ),
          ],
        ),
      ) ??
      false;
  Widget apiPage() {
    final p = currentProvider;
    final models = p['models'] as List? ?? [];
    final profileKey = selectedModel == null ? '' : selectedModel!.split('|||');
    final profileId = profileKey is List<String> && profileKey.length == 2
        ? jsonEncode(profileKey)
        : '';
    final selectedParts = selectedModel?.split('|||') ?? [];
    final selectedProvider = providers
        .where((p) => selectedParts.length == 2 && p['id'] == selectedParts[0])
        .firstOrNull;
    final priceId = selectedParts.length == 2
        ? '${(selectedProvider?['baseUrl'] ?? '').toString().replaceFirst(RegExp(r'/+$'), '')}：${selectedParts[1]}'
        : '';
    final priceKey = 'price:$priceId';
    final price = object(object(api['modelPrices'])[priceId]);
    final profiles = object(api['modelMediaProfiles']);
    final profile = object(profiles[profileId]);
    void media(String field, dynamic value) {
      redraw(() {
        profile[field] = value;
        profiles[profileId] = profile;
        config['api'] = {...api, 'modelMediaProfiles': profiles};
      });
    }

    final left = section('提供商与模型目录', [
      Row(
        children: [
          Expanded(
            child: dropdown('提供商', provider, [
              for (final p in providers)
                DropdownMenuItem(
                  value: '${p['id']}',
                  child: Text('${p['name'] ?? p['id']}'),
                ),
            ], (value) => redraw(() => provider = value)),
          ),
          const SizedBox(width: 8),
          button('+', () async {
            final name = await ask('提供商名称');
            if (name == null || name.isEmpty) return;
            final id = 'provider-${DateTime.now().microsecondsSinceEpoch}';
            redraw(() {
              config['providers'] = [
                ...providers,
                {'id': id, 'name': name, 'baseUrl': '', 'models': []},
              ];
              provider = id;
            });
            await saveConfig({'providers': providers});
          }),
        ],
      ),
      if (provider != null) ...[
        input('Base URL', 'base:$provider', p['baseUrl']),
        input('API Key', 'key:$provider', '', secret: true),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            button('保存连接', () async {
              for (final item in providers) {
                if (item['id'] == provider) {
                  item['baseUrl'] = control('base:$provider').text.trim();
                }
              }
              await saveConfig({'providers': providers});
              if (control('key:$provider').text.isNotEmpty) {
                await post('/credentials', {
                  'account': widget.account,
                  'slot': provider,
                  'value': control('key:$provider').text,
                });
                control('key:$provider').clear();
              }
            }),
            button('清除密钥', () async {
              if (await confirm('清除该提供商密钥？')) {
                await post('/credentials', {
                  'account': widget.account,
                  'slot': provider,
                  'value': '',
                });
              }
            }),
            button('删除提供商', () async {
              if (!await confirm('删除提供商及目录？')) return;
              redraw(() {
                config['providers'] = providers
                    .where((v) => v['id'] != provider)
                    .toList();
                provider = providers.isEmpty
                    ? null
                    : '${providers.first['id']}';
              });
              await saveConfig({'providers': providers});
            }),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          children: [
            button('添加模型', () async {
              final id = await ask('模型 ID');
              if (id == null || id.isEmpty) return;
              if (models.any((m) => (m is String ? m : m['id']) == id)) return;
              p['models'] = [
                ...models,
                {'id': id, 'name': id},
              ];
              for (final item in providers) {
                if (item['id'] == provider) {
                  item['models'] = p['models'];
                }
              }
              await saveConfig({'providers': providers});
              redraw(() {});
            }),
            button('拉取模型列表', () async {
              final result = await post('/providers/fetch-models', {
                'account': widget.account,
                'provider': provider,
              });
              for (final item in providers) {
                if (item['id'] == provider) {
                  item['models'] = result;
                }
              }
              redraw(() {});
            }),
          ],
        ),
        for (final m in models)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text('${m is String ? m : m['name'] ?? m['id']}'),
            subtitle: Text(
              '图片：${m is Map && m['vision'] == true ? '支持' : '未知'} · 视频：${m is Map && m['video'] == true ? '支持' : '未知'}',
            ),
            leading: ModelLogo('${m is String ? m : m['id']}'),
            trailing: IconButton(
              icon: const Icon(Icons.delete_outline, size: 18),
              onPressed: saving
                  ? null
                  : () => run(() async {
                      p['models'] = models.where((v) => v != m).toList();
                      for (final item in providers) {
                        if (item['id'] == provider) {
                          item['models'] = p['models'];
                        }
                      }
                      await saveConfig({'providers': providers});
                      redraw(() {});
                    }),
            ),
          ),
      ],
    ]);
    final right = section('模型配置', [
      const Text('选择默认模型；单独配置请在人设中设置。'),
      dropdown(
        '选择模型',
        selectedModel,
        modelItems(),
        (value) => redraw(() {
          selectedModel = value;
          final pair = value!.split('|||');
          config['api'] = {...api, 'provider': pair[0], 'model': pair[1]};
        }),
      ),
      Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          const Text('图片输入'),
          SettingSwitch(
            value: profile['vision'] as bool? ?? true,
            onChanged: (v) => media('vision', v),
          ),
          const SizedBox(width: 12),
          const Text('视频输入'),
          SettingSwitch(
            value: profile['video'] as bool? ?? false,
            onChanged: (v) => media('video', v),
          ),
        ],
      ),
      dropdown(
        '图片输入专用模型',
        profile['visionSelection'] as String? ?? '',
        modelItems(empty: true),
        (v) => media('visionSelection', v),
      ),
      dropdown(
        '视频输入专用模型',
        profile['videoSelection'] as String? ?? '',
        modelItems(empty: true),
        (v) => media('videoSelection', v),
      ),
      dropdown('视频理解方式', profile['videoMode'] as String? ?? 'auto', [
        for (final entry in {
          'auto': '自动',
          'native': '原生视频',
          'frames': '抽帧',
          'off': '仅元信息',
        }.entries)
          DropdownMenuItem(value: entry.key, child: Text(entry.value)),
      ], (v) => media('videoMode', v)),
      const SizedBox(height: 14),
      button('保存模型配置', () async {
        await saveConfig({'api': api});
      }),
    ]);
    final fallback = api['fallbackModels'] as List? ?? [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        heading('API与搜索', '模型连接、输入配置、备选顺序与成本统一管理。'),
        const Text('当前文本对话与工具已接通；图片/视频配置按模型保存，媒体执行链路仍在迁移。'),
        const SizedBox(height: 16),
        columns(left, right),
        const Divider(height: 40),
        columns(
          section('成本核算', [
            SettingSwitchTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('官方直连自动匹配单价'),
              subtitle: const Text('中转站使用自定义单价；条件计费保留为参考。'),
              value: api['useOfficialPrice'] == true,
              onChanged: (v) =>
                  redraw(() => config['api'] = {...api, 'useOfficialPrice': v}),
            ),
            button('查看官方价格目录', () async {
              await showDialog<void>(
                context: context,
                builder: (_) => PriceCatalogue(core: widget.core),
              );
            }),
            input(
              '输入单价 / 百万 Token',
              '$priceKey:in',
              price['in'] ?? api['priceInputPerM'],
            ),
            input(
              '输出单价 / 百万 Token',
              '$priceKey:out',
              price['out'] ?? api['priceOutputPerM'],
            ),
            const Text('输入/输出估算生效；缓存分项计费仍待迁移。'),
            button('保存单价', () async {
              if (priceId.isEmpty) throw StateError('请先选择模型');
              final values = <String, dynamic>{};
              for (final key in ['in', 'out']) {
                final value = double.tryParse(control('$priceKey:$key').text);
                if (value == null || !value.isFinite || value < 0) {
                  throw StateError('单价需要为非负数字');
                }
                values[key] = value;
              }
              config['api'] = {
                ...api,
                'modelPrices': {...object(api['modelPrices']), priceId: values},
              };
              await saveConfig({
                'api': {
                  'modelPrices': api['modelPrices'],
                  'useOfficialPrice': api['useOfficialPrice'],
                },
              });
            }),
          ]),
          section('故障备选顺序', [
            const Text('主模型失败后按顺序尝试；留空不启用。'),
            for (var i = 0; i < fallback.length; i++)
              Row(
                children: [
                  Expanded(
                    child: dropdown(
                      '备选 ${i + 1}',
                      modelValue(object(fallback[i])),
                      modelItems(empty: true),
                      (value) {
                        redraw(() {
                          final parts = value!.split('|||');
                          fallback[i] = parts.length == 2
                              ? {'provider': parts[0], 'model': parts[1]}
                              : {'model': ''};
                          config['api'] = {...api, 'fallbackModels': fallback};
                        });
                      },
                    ),
                  ),
                  IconButton(
                    onPressed: () => redraw(() {
                      fallback.removeAt(i);
                      config['api'] = {...api, 'fallbackModels': fallback};
                    }),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ),
            button('+ 添加备选模型', () async {
              redraw(() {
                config['api'] = {
                  ...api,
                  'fallbackModels': [
                    ...fallback,
                    {'model': ''},
                  ],
                };
              });
            }),
            button('保存备选顺序', () async {
              await saveConfig({
                'api': {'fallbackModels': api['fallbackModels']},
              });
            }),
          ]),
        ),
        const Divider(height: 40),
        section('搜索服务', [
          editor('webSearch', config['webSearch']),
          input('搜索服务 API Key', 'search-key', '', secret: true),
          button('保存搜索配置', () async {
            await saveConfig({'webSearch': config['webSearch']});
            final service = object(config['webSearch'])['provider'];
            if (control('search-key').text.isNotEmpty) {
              await post('/credentials', {
                'account': widget.account,
                'slot': 'search:$service',
                'value': control('search-key').text,
              });
              control('search-key').clear();
            }
          }),
        ]),
      ],
    );
  }

  Widget archivePage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('存档', '逐条读取原生 SQL 消息；查询不会载入完整历史。'),
      input('官方格式消息副本（JSON 文件路径）', 'import-file', ''),
      button('迁入官方消息副本', () async {
        if (!await confirm('迁入官方格式消息、媒体和引用？其他字段暂不迁入；请保留原文件。')) return;
        final result = await post('/migration/official-messages', {
          'account': widget.account,
          'path': control('import-file').text.trim(),
          'confirmed': true,
        });
        rows = await get('/archive') as List;
        redraw(() => notice = '已迁入 ${result['importedMessages']} 条消息，原文件保留。');
      }),
      Row(
        children: [
          Expanded(child: input('搜索正文', 'archive-search', '')),
          const SizedBox(width: 8),
          button('搜索', () async {
            rows = await get('/archive', {
              'search': control('archive-search').text,
              'chat': target,
            }) as List;
            redraw(() {});
          }),
        ],
      ),
      dropdown(
        '会话',
        target,
        [
          const DropdownMenuItem(value: '', child: Text('全部会话')),
          for (final chat in chats)
            DropdownMenuItem(value: chat, child: Text(chat)),
        ],
        (value) => run(() async {
          target = value!;
          rows = await get('/archive', {
            'chat': target,
            'search': control('archive-search').text,
          }) as List;
          redraw(() {});
        }),
      ),
      for (final row in rows)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: SelectableText('${row['text']}'),
          subtitle: Text(
            '${row['chat']} · ${row['sender']} · ${date(row['timestamp'])}',
          ),
        ),
      Wrap(
        spacing: 8,
        children: [
          button('读取更早消息', () async {
            if (rows.isEmpty) return;
            final next = await get('/archive', {
              'chat': target,
              'search': control('archive-search').text,
              'before': '${rows.last['id']}',
            }) as List;
            redraw(() => rows.addAll(next));
          }),
          button('复制已加载内容', () async {
            await Clipboard.setData(
              ClipboardData(
                text: rows
                    .map(
                      (r) =>
                          '${date(r['timestamp'])} ${r['sender']}: ${r['text']}',
                    )
                    .join('\n'),
              ),
            );
          }),
          if (target.isNotEmpty)
            button('清理当前会话', () async {
              if (await confirm('删除 $target 的本地存档？')) {
                await post('/archive/delete', {
                  'account': widget.account,
                  'chat': target,
                  'confirmed': true,
                });
                rows = [];
                redraw(() {});
              }
            }),
        ],
      ),
    ],
  );
  String date(dynamic timestamp) => timestamp is num
      ? DateTime.fromMillisecondsSinceEpoch(timestamp.toInt() * 1000)
            .toLocal()
            .toString()
            .split('.')
            .first
      : '';
  Widget usageTable(String title, List<dynamic> rows, String name) =>
      section(title, [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            columns: [
              DataColumn(label: Text(name == 'date' ? '日期' : '模型')),
              const DataColumn(label: Text('调用')),
              const DataColumn(label: Text('输入')),
              const DataColumn(label: Text('输出')),
              const DataColumn(label: Text('估算 / 元')),
            ],
            rows: [
              for (final row in rows)
                DataRow(
                  cells: [
                    DataCell(Text('${row[name]}')),
                    DataCell(Text('${row['calls']}')),
                    DataCell(Text('${row['input']}')),
                    DataCell(Text('${row['output']}')),
                    DataCell(Text((row['cost'] as num).toStringAsFixed(4))),
                  ],
                ),
            ],
          ),
        ),
      ]);
  Widget usagePage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('用量与成本', '由已保存的模型调用记录统计。'),
      Wrap(
        spacing: 8,
        children: [
          for (final days in [1, 7, 30, 0])
            button(days == 0 ? '全部' : '$days 天', () async {
              data = object(
                await get('/usage', {
                  'since':
                      '${days == 0 ? 0 : DateTime.now().millisecondsSinceEpoch ~/ 1000 - days * 86400}',
                }),
              );
              redraw(() {});
            }),
        ],
      ),
      const SizedBox(height: 20),
      usageTable('按天', data['days'] as List? ?? [], 'date'),
      const Divider(height: 32),
      usageTable('按模型', data['models'] as List? ?? [], 'model'),
    ],
  );

  Widget personaPage() {
    final builtin = object(templates['builtin']);
    final custom = templates['custom'] as List? ?? [];
    final locked = object(persona['templateRef'])['builtin'] == true;
    final directory = <String>{
      ...chats.where((c) => !c.startsWith('model:')),
      ...object(config['personaByChat']).keys,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        heading('人设', '正文、附加规则、身份与模型分别保存；未配置的会话继承默认人设。'),
        dropdown(
          '编辑对象',
          target,
          [
            const DropdownMenuItem(value: '', child: Text('默认人设')),
            for (final chat in directory)
              DropdownMenuItem(value: chat, child: Text(chat)),
          ],
          (value) async {
            if (await confirm('切换对象？未保存的草稿不会提交。')) {
              await run(() async {
                target = value!;
                await loadPersona();
                redraw(() {});
              });
            }
          },
        ),
        Wrap(
          spacing: 8,
          children: [
            for (final entry in {
              'body': '角色正文',
              'rules': '附加规则',
              'identity': '身份与模型设置',
            }.entries)
              ChoiceChip(
                label: Text(entry.value),
                selected: tab == entry.key,
                onSelected: (_) => redraw(() => tab = entry.key),
              ),
            button('全部保存', () async {
              await commitPersona('all');
            }),
          ],
        ),
        const SizedBox(height: 20),
        if (tab == 'body') ...[
          if (locked) const Text('内置人设正文只读。可复制为自定义模板后修改。'),
          IgnorePointer(
            ignoring: locked,
            child: input('角色正文', 'persona:roleText', '', lines: 12),
          ),
        ],
        if (tab == 'rules')
          IgnorePointer(
            ignoring: locked,
            child: Column(
              children: [
                input('附加规则', 'persona:customRules', '', lines: 6),
                input('系统提示词覆盖', 'persona:systemPromptOverride', '', lines: 6),
              ],
            ),
          ),
        if (tab == 'identity') ...[
          input('人设名称', 'persona:botName', ''),
          input('群展示名', 'persona:selfNickname', ''),
          dropdown('参与度', '${persona['participation'] ?? 'medium'}', [
            for (final entry in {
              'low': '安静型',
              'medium': '普通群友',
              'high': '活跃型',
            }.entries)
              DropdownMenuItem(value: entry.key, child: Text(entry.value)),
          ], (v) => redraw(() => persona['participation'] = v)),
          if (target.isNotEmpty)
            dropdown(
              '当前会话模型',
              modelValue(
                object(object(api['apiByChat'])['byChat'])[target] is Map
                    ? object(object(object(api['apiByChat'])['byChat'])[target])
                    : {},
              ),
              modelItems(empty: true),
              (value) => redraw(() {
                final parts = value!.split('|||');
                final byChat = object(object(api['apiByChat'])['byChat']);
                byChat[target] = parts.length == 2
                    ? {'provider': parts[0], 'model': parts[1]}
                    : {'model': '', 'provider': ''};
                config['api'] = {
                  ...api,
                  'apiByChat': {'byChat': byChat},
                };
              }),
            ),
        ],
        Wrap(
          spacing: 8,
          children: [
            button('保存当前栏', () async {
              await commitPersona(tab);
            }),
            dropdownHistory(),
          ],
        ),
        const Divider(height: 36),
        heading('人设库'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final entry in builtin.entries)
              button('${entry.value['name']} · 内置', () async {
                if (!await confirm('选用模板会替换当前草稿，继续？')) return;
                redraw(() {
                  persona['templateRef'] = {'id': entry.key, 'builtin': true};
                  control('persona:roleText').text = '${entry.value['text']}';
                  control('persona:customRules').clear();
                  control('persona:systemPromptOverride').clear();
                });
              }),
            for (final entry in custom)
              button('${entry['name']}', () async {
                if (!await confirm('选用模板会替换当前草稿，继续？')) return;
                redraw(() {
                  persona['templateRef'] = {
                    'id': entry['id'],
                    'builtin': false,
                  };
                  for (final key in [
                    'roleText',
                    'customRules',
                    'systemPromptOverride',
                  ]) {
                    control('persona:$key').text = '${entry[key] ?? ''}';
                  }
                });
              }),
            button('新建 / 复制草稿为模板', () async {
              final name = await ask('模板名称');
              if (name == null || name.isEmpty) return;
              final item = {
                'id': 'persona-${DateTime.now().microsecondsSinceEpoch}',
                'name': name,
                for (final key in [
                  'roleText',
                  'customRules',
                  'systemPromptOverride',
                ])
                  key: control('persona:$key').text,
              };
              templates['custom'] = [...custom, item];
              await post('/persona/templates', templates['custom']);
              redraw(() {});
            }),
          ],
        ),
      ],
    );
  }

  Widget dropdownHistory() => SizedBox(
    width: 240,
    child: DropdownButtonFormField<int>(
      decoration: const InputDecoration(
        labelText: '最近保存记录',
        border: OutlineInputBorder(),
        isDense: true,
      ),
      items: [
        for (var i = 0; i < history.length; i++)
          DropdownMenuItem(
            value: i,
            child: Text(
              '${date(history[i]['timestamp'])} · ${history[i]['section']}',
            ),
          ),
      ],
      onChanged: (index) {
        if (index == null) return;
        redraw(() {
          final value = object(history[index]['value']);
          for (final key in [
            'roleText',
            'customRules',
            'systemPromptOverride',
            'botName',
            'selfNickname',
          ]) {
            control('persona:$key').text = '${value[key] ?? ''}';
          }
        });
      },
    ),
  );
  Future<void> commitPersona(String section) async {
    final value = {
      ...persona,
      for (final key in [
        'roleText',
        'customRules',
        'systemPromptOverride',
        'botName',
        'selfNickname',
      ])
        key: control('persona:$key').text,
    };
    if (object(persona['templateRef'])['builtin'] == true) {
      if (section == 'body' || section == 'rules') {
        throw StateError('请复制内置模板后编辑正文与规则');
      }
      for (final field in ['roleText', 'customRules', 'systemPromptOverride']) {
        value.remove(field);
      }
    }
    await post('/persona', {
      'account': widget.account,
      'target': target,
      'section': section,
      'value': value,
    });
    if (section == 'identity' || section == 'all') {
      await saveConfig({
        'api': {'apiByChat': api['apiByChat']},
      });
    }
    // Fetch history without replacing unrelated unsaved controllers.
    final result = object(await get('/persona', {'target': target}));
    if (!mounted) return;
    redraw(() {
      history = result['history'] as List? ?? [];
      notice = '当前栏已保存';
    });
  }

  Widget whitelistPage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('聊天白名单', '群聊和私聊按账号隔离。空白名单默认不响应。'),
      editor('allow', config['allow']),
      editor('deny', config['deny']),
      editor('allowAllWhenEmpty', config['allowAllWhenEmpty']),
      const SizedBox(height: 12),
      button('从 OneBot 获取群与好友', () async {
        data = object(await get('/roster'));
        redraw(() {});
      }),
      for (final group in data['groups'] as List? ?? [])
        CheckboxListTile(
          title: Text('${group['group_name']}'),
          subtitle: Text('${group['group_id']}'),
          value: (object(config['allow'])['groups'] as List? ?? [])
              .map((v) => '$v')
              .contains('${group['group_id']}'),
          onChanged: (value) {
            final allow = object(config['allow']);
            final groups = List<dynamic>.from(allow['groups'] as List? ?? []);
            groups.removeWhere((v) => '$v' == '${group['group_id']}');
            if (value == true) groups.add('${group['group_id']}');
            redraw(() => config['allow'] = {...allow, 'groups': groups});
          },
        ),
      button('保存名单', () async {
        await saveConfig({
          for (final key in ['allow', 'deny', 'allowAllWhenEmpty'])
            key: config[key],
        });
      }),
    ],
  );
  Widget accountsPage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('多账号', '每个 QQ 使用独立配置、消息、记忆和用量库。'),
      Text('当前账号：${widget.account}'),
      const SizedBox(height: 16),
      button('创建账号', () async {
        final id = await ask('QQ 账号');
        if (id == null) return;
        await post('/accounts', {'account': id});
        redraw(() => notice = '已创建账号；刷新顶栏账号列表后切换。');
      }),
      if (widget.account != null)
        button('查询登录信息', () async {
          final result = await post('/onebot/action', {
            'account': widget.account,
            'action': 'get_login_info',
            'params': {},
          });
          redraw(() => notice = '${result['nickname']} · ${result['user_id']}');
        }),
    ],
  );
  Widget extensionsPage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading(
        widget.page == 'plugins'
            ? '插件'
            : widget.page == 'skills'
            ? '技能'
            : '工具与技能',
      ),
      const Text('纯提示词技能可以本地启用；包含 JavaScript 的扩展会显示兼容状态，不执行原脚本。'),
      const SizedBox(height: 16),
      if (widget.page != 'tools') ...[
        input('扩展目录', 'extension-dir', ''),
        button('导入本地扩展', () async {
          await post('/extensions/import', {
            'account': widget.account,
            'path': control('extension-dir').text.trim(),
          });
          final entries = await get('/extensions') as List;
          if (mounted) redraw(() => rows = entries);
        }),
      ],
      for (final tool in rows)
        if (widget.page == 'tools')
          ListTile(
            title: Text('${tool['function']['name']}'),
            subtitle: Text('${tool['function']['description']}'),
          )
        else if (tool['kind'] ==
            (widget.page == 'plugins' ? 'plugin' : 'skill'))
          ListTile(
            title: Text('${tool['name']}'),
            subtitle: Text(
              '${tool['description']}\n${tool['runtime'] == 'prompt' ? '提示词技能' : '等待原生兼容实现'}',
            ),
            leading: Switch(
              value:
                  object(
                    object(config['skills'])['${tool['id']}'],
                  )['enabled'] ==
                  true,
              onChanged: tool['runtime'] != 'prompt'
                  ? null
                  : (v) => redraw(
                      () => config['skills'] = {
                        ...object(config['skills']),
                        '${tool['id']}': {'enabled': v},
                      },
                    ),
            ),
            trailing: IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: () => run(() async {
                if (!await confirm('移除扩展清单？原目录保留。')) return;
                await post('/extensions/remove', {
                  'account': widget.account,
                  'id': tool['id'],
                });
                final entries = await get('/extensions') as List;
                if (mounted) redraw(() => rows = entries);
              }),
            ),
          ),
      editor(
        widget.page == 'skills'
            ? 'skills'
            : widget.page == 'plugins'
            ? 'extensions'
            : 'tools',
        config[widget.page == 'skills'
            ? 'skills'
            : widget.page == 'plugins'
            ? 'extensions'
            : 'tools'],
      ),
      button('保存启用配置', () async {
        final key = widget.page == 'skills'
            ? 'skills'
            : widget.page == 'plugins'
            ? 'extensions'
            : 'tools';
        await saveConfig({key: config[key]});
        if (widget.page == 'plugins') {
          await saveConfig({'skills': config['skills']});
        }
      }),
    ],
  );
  Widget snowPage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Divider(height: 40),
      heading('SnowLuma 管理', '启动外部 OneBot 组件；使用它自带的运行时。'),
      input('SnowLuma 目录', 'snow-dir', object(config['snowluma'])['dir']),
      button('保存组件目录', () async {
        final snow = {
          ...object(config['snowluma']),
          'dir': control('snow-dir').text.trim(),
        };
        config['snowluma'] = snow;
        await saveConfig({'snowluma': snow});
      }),
      Wrap(
        spacing: 8,
        children: [
          button('检测状态', () async {
            final result = object(await get('/snow/status'));
            if (mounted) {
              redraw(() {
                data = result;
                notice = result['listening'] == true ? 'WebUI 端口已就绪' : '尚未监听';
              });
            }
          }),
          button('启动 SnowLuma', () async {
            final result = await post('/snow/launch', {
              'account': widget.account,
            });
            if (mounted) redraw(() => notice = '$result');
          }),
          button('停止本实例启动的组件', () async {
            if (!await confirm('停止本实例启动的 SnowLuma？')) return;
            await post('/snow/stop', {'account': widget.account});
            if (mounted) redraw(() => notice = '已停止');
          }),
          button('打开 WebUI', () async {
            final result = object(await get('/snow/status'));
            await DesktopBridge.openUrl('${result['webuiUrl']}');
          }),
          button('查看日志', () async {
            final result = await get('/snow/logs');
            if (mounted) redraw(() => notice = '${result['text']}');
          }),
        ],
      ),
      input('SnowLuma GitHub 来源 / owner/repository', 'snow-repository', ''),
      button('检查 SnowLuma Release', () async {
        final result = await post('/updates/check', {
          'account': widget.account,
          'component': 'snowluma',
          'repository': control('snow-repository').text.trim(),
        });
        if (mounted) {
          redraw(() => notice = '${result['tag']}\n${result['notes']}');
        }
      }),
    ],
  );
  Widget desktopPage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading(widget.page == 'personalize' ? '个性化' : '桌面端'),
      SettingSwitchTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('关闭窗口时留在托盘'),
        value: data['closeToTray'] == true,
        onChanged: (v) => redraw(() => data['closeToTray'] = v),
      ),
      SettingSwitchTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('实验版开机启动'),
        value: data['autoStart'] == true,
        onChanged: (v) => redraw(() => data['autoStart'] = v),
      ),
      dropdown('颜色模式', data['theme'] as String? ?? 'light', [
        for (final e in {'light': '亮色', 'dark': '暗色', 'auto': '跟随系统'}.entries)
          DropdownMenuItem(value: e.key, child: Text(e.value)),
      ], (v) => redraw(() => data['theme'] = v)),
      button('保存桌面设置', () async {
        await DesktopBridge.setStartup(data['autoStart'] == true);
        await widget.core.request('/preferences', body: data);
        if (mounted) redraw(() => notice = '已保存；颜色模式在刷新后同步。');
      }),
      const SizedBox(height: 20),
      editor('proxy', config['proxy']),
      button('保存网络代理', () async {
        await saveConfig({'proxy': config['proxy']});
      }),
    ],
  );
  Widget marketsPage() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      heading('社区与市场'),
      const Text('浏览共享内容、登录及校验安装口令。旧 JavaScript 插件仍需原生兼容层，暂不直接安装运行。'),
      const SizedBox(height: 16),
      dropdown('内容类别', data['kind'] as String? ?? 'skill', [
        for (final e in {
          'skill': '技能',
          'plugin': '插件',
          'persona': '人设',
        }.entries)
          DropdownMenuItem(value: e.key, child: Text(e.value)),
      ], (v) => redraw(() => data['kind'] = v)),
      button('刷新市场', () async {
        final result = await get('/community/list', {
          'kind': '${data['kind'] ?? 'skill'}',
        });
        final payload = object(result);
        final list = result is List
            ? result
            : payload['items'] ?? payload['list'] ?? payload['data'];
        if (mounted) {
          redraw(() {
            rows = list is List ? list : [];
            notice = rows.isEmpty ? '${payload['error'] ?? '暂无内容'}' : '';
          });
        }
      }),
      input('登录 ID', 'market-login', ''),
      input('密码', 'market-password', '', secret: true),
      Wrap(
        spacing: 8,
        children: [
          button('登录', () async {
            final result = await post('/community/login', {
              'account': widget.account,
              'login_id': control('market-login').text,
              'password': control('market-password').text,
            });
            control('market-password').clear();
            if (mounted) {
              redraw(() => notice = '登录成功 · ${object(result)['user'] ?? ''}');
            }
          }),
          button('退出登录', () async {
            await post('/community/logout', {'account': widget.account});
            if (mounted) redraw(() => notice = '已退出');
          }),
        ],
      ),
      input('安装口令（逗号分隔）', 'market-codes', ''),
      button('校验口令', () async {
        final result = await post('/community/verify', {
          'account': widget.account,
          'codes': control('market-codes').text
              .split(RegExp(r'[,，\s]+'))
              .where((v) => v.isNotEmpty)
              .toList(),
        });
        if (mounted) redraw(() => notice = '$result');
      }),
      for (final item in rows)
        ListTile(
          title: Text('${item['name'] ?? item['title'] ?? item['id']}'),
          subtitle: Text('${item['description'] ?? ''}'),
          onTap: () => showDialog<void>(
            context: context,
            builder: (_) => AlertDialog(
              title: Text('${item['name'] ?? item['id']}'),
              content: SingleChildScrollView(
                child: SelectableText(
                  const JsonEncoder.withIndent('  ').convert(item),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('关闭'),
                ),
              ],
            ),
          ),
        ),
    ],
  );
  Widget settingsPage() {
    final sections = switch (widget.page) {
      'chat-settings' => [
        'runtime',
        'send',
        'store',
        'commandMute',
        'proactive',
        'chatActive',
        'sticker',
      ],
      'desktop' => ['server', 'ui'],
      'advanced' => [
        'wakeDelayMs',
        'drainDelayMs',
        'maxConcurrentRuns',
        'sessionRetryAttempts',
        'security',
        'memory',
        'personaHistory',
      ],
      'personalize' => ['persona'],
      _ => ['snowluma'],
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        heading(switch (widget.page) {
          'chat-settings' => '聊天设置',
          'desktop' => '桌面端',
          'advanced' => '进阶',
          'personalize' => '个性化',
          _ => 'OneBot 设置',
        }),
        for (final key in sections) ...[
          if ({
            'proactive',
            'chatActive',
            'sticker',
            'memory',
            'drainDelayMs',
            'sessionRetryAttempts',
          }.contains(key))
            Text('${labels[key] ?? key}：执行链路尚未迁移，暂不开放设置。')
          else
            editor(key, config[key]),
          const Divider(height: 32),
        ],
        button('保存设置', () async {
          await saveConfig({for (final key in sections) key: config[key]});
        }),
      ],
    );
  }

  dynamic valueAt(String path) {
    dynamic value = config;
    for (final segment in path.split('.')) {
      value = value is Map ? value[segment] : null;
    }
    return value;
  }

  void setAt(String path, dynamic value) {
    final parts = path.split('.');
    dynamic node = config;
    for (final segment in parts.take(parts.length - 1)) {
      node = node[segment];
    }
    node[parts.last] = value;
  }

  Widget editor(String path, dynamic value) {
    if ({
      'store.maxMessagesPerChat',
      'store.promptAnchor',
      'store.keepSessionFiles',
      'send.hardSplitAt',
      'security.allowPrivateImageHosts',
      'security.browseLock.siteSearchUrl',
    }.contains(path)) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text('${labels[path] ?? path.split('.').last}：尚未迁移'),
      );
    }
    final label =
        labels[path] ?? labels[path.split('.').last] ?? path.split('.').last;
    if (value is bool) {
      return SettingSwitchTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        value: valueAt(path) == true,
        onChanged: (v) => redraw(() => setAt(path, v)),
      );
    }
    if (value is Map) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          for (final entry in value.entries)
            if (!{
              'apiKey',
              'accessToken',
              'httpAccessToken',
              'token',
              'active',
              'groupSliderPos',
              'groupPeakPos',
              'apiByChat',
              'modelMediaProfiles',
            }.contains(entry.key))
              editor('$path.${entry.key}', entry.value),
        ],
      );
    }
    if (value is List) {
      if (value.any((v) => v is Map)) {
        return Text('$label：${value.length} 项（使用该功能专用编辑器管理）');
      }
      return input(
        label,
        path,
        value.join(', '),
        changed: (v) => setAt(
          path,
          v
              .split(RegExp(r'[,，\n]'))
              .map((v) => v.trim())
              .where((v) => v.isNotEmpty)
              .toList(),
        ),
      );
    }
    return input(
      label,
      path,
      value,
      changed: (v) {
        if (value is num) {
          final number = num.tryParse(v);
          if (number != null) setAt(path, number);
        } else {
          setAt(path, v);
        }
      },
    );
  }
}

const labels = <String, String>{
  'send': '消息发送',
  'store': '上下文与活跃档位',
  'commandMute': '指令安静',
  'proactive': '主动话题',
  'chatActive': '持续话题',
  'sticker': '表情包',
  'server': '桌面行为',
  'ui': '界面',
  'security': '网络与安全',
  'memory': '记忆整理',
  'snowluma': 'SnowLuma',
  'tools': '工具',
  'skills': '技能',
  'extensions': '扩展',
  'allow': '允许聊天',
  'deny': '拒绝聊天',
  'groups': '群号',
  'private': '私聊 QQ 号',
  'allowAllWhenEmpty': '空白名单时允许全部',
  'enabled': '启用',
  'provider': '提供商',
  'searchUrl': '搜索地址',
  'maxResults': '结果数量',
  'webSearch': '联网搜索',
  'baseUrl': '连接地址',
  'model': '模型',
  'count': '数量',
  'timeoutMs': '超时 / 毫秒',
  'autoStart': '开机自启',
  'closeToTray': '关闭时留在托盘',
  'refreshMs': '刷新间隔 / 毫秒',
  'historyCount': '历史消息条数',
  'contextTier': '默认响应档位',
  'randomPercent': '随机响应百分比',
  'keywords': '触发关键词',
  'peakSchedule': '峰谷时段',
  'peak': '高峰',
  'valley': '低谷',
  'start': '开始时间',
  'end': '结束时间',
  'sliderPos': '响应档位位置',
  'wakeDelayMs': '连发合并等待 / 毫秒',
  'drainDelayMs': '后续消息等待 / 毫秒',
  'maxConcurrentRuns': '并发任务数',
  'sessionRetryAttempts': '失败重试次数',
  'autoLaunch': '自动启动 SnowLuma',
  'wsUrl': '正向 WebSocket 地址',
  'httpUrl': 'OneBot HTTP 地址',
  'dir': '程序目录',
  'command': '指令',
  'durationMin': '持续时间 / 分钟',
  'minGapMs': '最短发送间隔 / 毫秒',
  'maxGapMs': '最长发送间隔 / 毫秒',
  'maxPerMinute': '每分钟发送上限',
  'maxPerHour': '每小时发送上限',
  'dedupeWindowMs': '重复消息抑制 / 毫秒',
  'hardSplitAt': '长消息切分字数',
  'crossChatSend': '允许跨会话发送',
  'browseLock': '网站白名单',
  'hosts': '允许的网站',
  'hotReload': '扩展热重载',
  'consolidateEnabled': '自动整理记忆',
  'useChatModel': '整理使用会话模型',
  'consolidateMinIntervalMs': '整理冷却时间 / 毫秒',
};
