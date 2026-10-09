import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core_client.dart';
import 'app_style.dart';
import 'desktop_bridge.dart';
import 'price_catalogue.dart';
import 'desktop_pages.dart';
import 'snow_download_panel.dart';

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
    this.onSnowInstalled,
  });
  final CoreApi core;
  final String? account;
  final String page;
  final VoidCallback? onSnowInstalled;
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
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
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
  Widget columns(Widget left, Widget right, {bool bounded = false}) =>
      LayoutBuilder(
        builder: (context, constraints) => constraints.maxWidth < 780
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [left, const SizedBox(height: 24), right],
              )
            : Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: bounded
                        ? SizedBox(
                            height: 450,
                            child: ListView(
                              padding: const EdgeInsets.all(4),
                              children: [left],
                            ),
                          )
                        : left,
                  ),
                  const SizedBox(width: 20),
                  Expanded(
                    child: bounded
                        ? SizedBox(
                            height: 450,
                            child: ListView(
                              padding: const EdgeInsets.all(4),
                              children: [right],
                            ),
                          )
                        : right,
                  ),
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
    if (widget.page == 'persona') {
      return CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.keyS, control: true): () =>
              unawaited(run(() => commitPersona(tab))),
        },
        child: Focus(autofocus: true, child: personaPage()),
      );
    }
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

    final activeId = selectedParts.length == 2 ? selectedParts[1] : '';
    final activeProvider = object(selectedProvider);
    final activeModels = activeProvider['models'] as List? ?? [];
    final activeEntry = activeModels
        .where((m) => (m is String ? m : m['id']) == activeId)
        .firstOrNull;
    String capability(dynamic value) => value == true
        ? '支持'
        : value == false
        ? '不支持'
        : '未知';
    final providerList = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 8),
        button('+ 添加提供商', () async {
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
        const SizedBox(height: 12),
        SizedBox(
          height: 330,
          child: ListView(
            padding: const EdgeInsets.all(4),
            children: [
              for (final item in providers)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Material(
                    color: provider == item['id']
                        ? Theme.of(context).colorScheme.primary
                              .withValues(alpha: .12)
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(6),
                    child: InkWell(
                      onTap: () => redraw(() => provider = '${item['id']}'),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 12,
                        ),
                        child: Text(
                          '${item['name'] ?? item['id']}',
                          style: const TextStyle(fontSize: 11),
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
    final providerForm = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
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
                if (models.any((m) => (m is String ? m : m['id']) == id)) {
                  return;
                }
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
      ],
    );
    final left = section('提供商与模型目录', [
      LayoutBuilder(
        builder: (context, box) => box.maxWidth >= 420
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(width: 112, child: providerList),
                  const SizedBox(width: 12),
                  Expanded(child: providerForm),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  dropdown('提供商', provider, [
                    for (final item in providers)
                      DropdownMenuItem(
                        value: '${item['id']}',
                        child: Text('${item['name'] ?? item['id']}'),
                      ),
                  ], (v) => redraw(() => provider = v)),
                  button('+ 添加提供商', () async {
                    final name = await ask('提供商名称');
                    if (name == null || name.isEmpty) return;
                    final id =
                        'provider-${DateTime.now().microsecondsSinceEpoch}';
                    redraw(() {
                      config['providers'] = [
                        ...providers,
                        {'id': id, 'name': name, 'baseUrl': '', 'models': []},
                      ];
                      provider = id;
                    });
                    await saveConfig({'providers': providers});
                  }),
                  const SizedBox(height: 12),
                  providerForm,
                ],
              ),
      ),
    ]);
    final right = section('模型配置', [
      const Text('选择默认模型；单独配置请在人设中设置。'),
      Wrap(
        spacing: 8,
        children: [
          button('测试连通性', () async {
            final selected = selectedModel?.split('|||') ?? [];
            if (selected.length != 2) throw StateError('请选择模型');
            final result = object(
              await post('/providers/test', {
                'account': widget.account,
                'provider': selected[0],
                'model': selected[1],
              }),
            );
            redraw(
              () => notice =
                  '请求成功 · ${result['milliseconds']}ms · 输入 ${result['input']} / 输出 ${result['output']} · ${result['text']}',
            );
          }),
          button('测试图片输入', () async {
            final selected = selectedModel?.split('|||') ?? [];
            if (selected.length != 2) throw StateError('请选择模型');
            final image = await ask('测试图片 HTTP/HTTPS URL');
            if (image == null || image.isEmpty) return;
            final result = object(
              await post('/providers/test', {
                'account': widget.account,
                'provider': selected[0],
                'model': selected[1],
                'image': image,
              }),
            );
            redraw(() => notice = '图片请求成功 · ${result['text']}');
          }),
        ],
      ),
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
        Row(
          children: [
            ModelLogo(activeId),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    activeId.isEmpty ? '未选择默认模型' : activeId,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    '图片：${capability(activeEntry is Map ? activeEntry['vision'] : null)} · 视频：${capability(activeEntry is Map ? activeEntry['video'] : null)}',
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context).hintColor,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        columns(left, right, bounded: true),
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
    final names = {'body': '角色正文', 'rules': '附加规则', 'identity': '身份与模型设置'};
    Future<void> choose(String value) async {
      if (value == target || !await confirm('切换编辑对象？请先保存需要保留的草稿。')) return;
      await run(() async {
        target = value;
        await loadPersona();
        redraw(() {});
      });
    }

    final list = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(20),
          child: heading('人设', '选择要编辑的对象'),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: TextField(
            controller: control('persona-search'),
            onChanged: (_) => redraw(() {}),
            decoration: const InputDecoration(hintText: '查找群聊或私聊'),
          ),
        ),
        const SizedBox(height: 16),
        Expanded(
          child: ListView(
            children: [
              ListTile(
                selected: target.isEmpty,
                title: const Text('默认人设'),
                subtitle: const Text('所有会话的起点'),
                onTap: () => choose(''),
              ),
              const Divider(),
              for (final chat in directory.where(
                (c) => c.contains(control('persona-search').text),
              ))
                ListTile(
                  selected: target == chat,
                  title: Text(chat, overflow: TextOverflow.ellipsis),
                  subtitle: Text(chat.startsWith('group:') ? '群聊' : '私聊'),
                  onTap: () => choose(chat),
                ),
            ],
          ),
        ),
      ],
    );
    final detail = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      target.isEmpty ? '默认人设' : target,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      locked ? '选用内置人设 · 正文与规则只读' : '正文、附加规则和身份分别保存',
                      style: TextStyle(
                        fontSize: 11,
                        color: Theme.of(context).hintColor,
                      ),
                    ),
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: saving
                    ? null
                    : () => run(() => commitPersona('all')),
                child: const Text('全部保存'),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: LayoutBuilder(
            builder: (context, box) => Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: ListView(
                    key: ValueKey('persona-editor:$target:$tab'),
                    padding: const EdgeInsets.all(24),
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              names[tab]!,
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          button('保存当前栏', () => commitPersona(tab)),
                        ],
                      ),
                      const SizedBox(height: 16),
                      dropdownHistory(),
                      const SizedBox(height: 20),
                      if (box.maxWidth < 660)
                        Wrap(
                          spacing: 6,
                          children: [
                            for (final entry in names.entries)
                              ChoiceChip(
                                label: Text(entry.value),
                                selected: tab == entry.key,
                                onSelected: (_) =>
                                    redraw(() => tab = entry.key),
                              ),
                          ],
                        ),
                      const SizedBox(height: 12),
                      if (tab == 'body')
                        TextField(
                          controller: control('persona:roleText'),
                          readOnly: locked,
                          minLines: 15,
                          maxLines: null,
                          decoration: const InputDecoration(
                            labelText: '角色正文',
                            alignLabelWithHint: true,
                          ),
                        ),
                      if (tab == 'rules') ...[
                        TextField(
                          controller: control('persona:customRules'),
                          readOnly: locked,
                          minLines: 8,
                          maxLines: null,
                          decoration: const InputDecoration(
                            labelText: '附加规则',
                            alignLabelWithHint: true,
                          ),
                        ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: control('persona:systemPromptOverride'),
                          readOnly: locked,
                          minLines: 8,
                          maxLines: null,
                          decoration: const InputDecoration(
                            labelText: '系统提示词覆盖',
                            alignLabelWithHint: true,
                          ),
                        ),
                      ],
                      if (tab == 'identity') ...[
                        input('人设名称', 'persona:botName', ''),
                        input('群展示名', 'persona:selfNickname', ''),
                        section('角色行为', [
                          dropdown(
                            '参与度',
                            '${persona['participation'] ?? 'medium'}',
                            [
                              for (final entry in {
                                'low': '安静型',
                                'medium': '普通群友',
                                'high': '活跃型',
                              }.entries)
                                DropdownMenuItem(
                                  value: entry.key,
                                  child: Text(entry.value),
                                ),
                            ],
                            (v) => redraw(() => persona['participation'] = v),
                          ),
                        ]),
                        const Divider(height: 36),
                        if (target.startsWith('group:')) ...[
                          section('群响应档位', [activityEditor(group: true)]),
                          const Divider(height: 32),
                        ],
                        section('模型', [
                          if (target.isEmpty)
                            const Text('默认模型在 API 与搜索中配置。')
                          else
                            dropdown(
                              '当前会话模型',
                              modelValue(
                                object(
                                          object(api['apiByChat'])['byChat'],
                                        )[target]
                                        is Map
                                    ? object(
                                        object(
                                          object(api['apiByChat'])['byChat'],
                                        )[target],
                                      )
                                    : {},
                              ),
                              modelItems(empty: true),
                              (value) => redraw(() {
                                final parts = value!.split('|||');
                                final byChat = object(
                                  object(api['apiByChat'])['byChat'],
                                );
                                byChat[target] = parts.length == 2
                                    ? {'provider': parts[0], 'model': parts[1]}
                                    : {'model': '', 'provider': ''};
                                config['api'] = {
                                  ...api,
                                  'apiByChat': {'byChat': byChat},
                                };
                              }),
                            ),
                        ]),
                      ],
                      if (notice.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: SelectableText(notice),
                        ),
                      const Divider(height: 32),
                      ExpansionTile(
                        title: const Text('选用或新建人设模板'),
                        children: [
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              for (final entry in builtin.entries)
                                button(entry.key, () async {
                                  if (!await confirm('选用内置模板会替换当前正文草稿，继续？')) {
                                    return;
                                  }
                                  redraw(() {
                                    persona['templateRef'] = {
                                      'id': entry.key,
                                      'builtin': true,
                                    };
                                    control('persona:roleText').text =
                                        '${entry.value}';
                                    control('persona:customRules').clear();
                                    control('persona:systemPromptOverride')
                                        .clear();
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
                                      control('persona:$key').text =
                                          '${entry[key] ?? ''}';
                                    }
                                  });
                                }),
                              button('新建 / 复制草稿为模板', () async {
                                final name = await ask('模板名称');
                                if (name == null || name.isEmpty) return;
                                final item = {
                                  'id':
                                      'persona-${DateTime.now().microsecondsSinceEpoch}',
                                  'name': name,
                                  for (final key in [
                                    'roleText',
                                    'customRules',
                                    'systemPromptOverride',
                                  ])
                                    key: control('persona:$key').text,
                                };
                                templates['custom'] = [...custom, item];
                                await post(
                                  '/persona/templates',
                                  templates['custom'],
                                );
                                redraw(() {});
                              }),
                            ],
                          ),
                          for (final entry in custom)
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${entry['name'] ?? entry['id']}',
                                  ),
                                ),
                                TextButton(
                                  onPressed: saving
                                      ? null
                                      : () => run(() async {
                                          if (!await confirm(
                                            '用当前正文和规则更新此模板？',
                                          )) {
                                            return;
                                          }
                                          final name = await ask(
                                            '模板名称',
                                            initial: '${entry['name']}',
                                          );
                                          if (name == null) return;
                                          final result = object(
                                            await post('/persona/template', {
                                              'id': entry['id'],
                                              'value': {
                                                ...entry,
                                                'name': name,
                                                for (final key in [
                                                  'roleText',
                                                  'customRules',
                                                  'systemPromptOverride',
                                                ])
                                                  key: control('persona:$key')
                                                      .text,
                                              },
                                            }),
                                          );
                                          redraw(
                                            () => templates['custom'] =
                                                result['custom'],
                                          );
                                        }),
                                  child: const Text('更新'),
                                ),
                                TextButton(
                                  onPressed: saving
                                      ? null
                                      : () => run(() async {
                                          if (!await confirm(
                                            '删除此模板？已保存的会话正文保留。',
                                          )) {
                                            return;
                                          }
                                          final result = object(
                                            await post('/persona/template', {
                                              'id': entry['id'],
                                              'delete': true,
                                              'confirmed': true,
                                            }),
                                          );
                                          redraw(
                                            () => templates['custom'] =
                                                result['custom'],
                                          );
                                        }),
                                  child: const Text('删除'),
                                ),
                              ],
                            ),
                          const SizedBox(height: 16),
                        ],
                      ),
                    ],
                  ),
                ),
                if (box.maxWidth >= 660)
                  SizedBox(
                    width: 155,
                    child: Material(
                      color: Theme.of(context).cardColor,
                      child: ListView(
                        padding: const EdgeInsets.only(top: 20),
                        children: [
                          for (final entry in names.entries)
                            ListTile(
                              selected: tab == entry.key,
                              dense: true,
                              title: Text(entry.value),
                              subtitle: Text(
                                entry.key == 'body'
                                    ? 'TA 是谁'
                                    : entry.key == 'rules'
                                    ? 'TA 如何回应'
                                    : '称呼、行为与模型',
                              ),
                              onTap: () => redraw(() => tab = entry.key),
                            ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
    return SplitWorkspace(width: 250, directory: list, detail: detail);
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
        if (target.startsWith('group:'))
          'store': {
            'unifiedTier': object(config['store'])['unifiedTier'],
            'groupSliderPos': {
              target.substring(6): object(
                object(config['store'])['groupSliderPos'],
              )[target.substring(6)],
            },
            'groupPeakPos': {
              target.substring(6): object(
                object(config['store'])['groupPeakPos'],
              )[target.substring(6)],
            },
          },
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

  Widget whitelistPage() {
    Widget roster(
      String title,
      String field,
      String idField,
      String nameField,
      List<dynamic> list,
    ) => SurfacePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          heading(title),
          if (list.isEmpty) const Text('尚未加载名单。请连接 OneBot 后获取群与好友。'),
          for (final item in list)
            CheckboxListTile(
              dense: true,
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: Text('${item[nameField] ?? item[idField]}'),
              subtitle: Text('${item[idField]}'),
              value: (object(config['allow'])[field] as List? ?? [])
                  .map((v) => '$v')
                  .contains('${item[idField]}'),
              onChanged: (v) => redraw(() {
                final allow = object(config['allow']);
                final values = List<dynamic>.from(allow[field] as List? ?? []);
                values.removeWhere((x) => '$x' == '${item[idField]}');
                if (v == true) values.add(item[idField]);
                config['allow'] = {...allow, field: values};
              }),
            ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        heading('聊天白名单', '勾选允许参与的群聊与私聊；名单按账号隔离。'),
        Row(
          children: [
            Expanded(
              child: SettingSwitchTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('空白名单允许响应'),
                subtitle: const Text('首次默认关闭'),
                value: config['allowAllWhenEmpty'] == true,
                onChanged: (v) => redraw(() => config['allowAllWhenEmpty'] = v),
              ),
            ),
            button('获取群与好友', () async {
              final result = object(await get('/roster'));
              redraw(() => data = result);
            }),
          ],
        ),
        const SizedBox(height: 16),
        columns(
          roster(
            '群聊',
            'groups',
            'group_id',
            'group_name',
            data['groups'] as List? ?? [],
          ),
          roster(
            '私聊',
            'private',
            'user_id',
            'nickname',
            data['friends'] as List? ?? [],
          ),
        ),
        const SizedBox(height: 16),
        FoldPanel(
          title: '手动编辑名单',
          subtitle: '已选账号 / 排除名单',
          icon: Icons.edit_note,
          children: [
            editor('allow', config['allow']),
            editor('deny', config['deny']),
          ],
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: button(
            '保存名单',
            () async => saveConfig({
              for (final k in ['allow', 'deny', 'allowAllWhenEmpty'])
                k: config[k],
            }),
          ),
        ),
      ],
    );
  }

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
  Widget harnessEditor() {
    final profiles = config['harnesses'] as List? ?? [];
    return FoldPanel(
      title: '本机 Agent / Harness',
      subtitle: '显式配置可执行文件；直接参数调用，不通过 shell',
      icon: Icons.terminal_outlined,
      children: [
        for (final p in profiles)
          SurfacePanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text('${p['name'] ?? p['id']}')),
                    SettingSwitch(
                      value: p['enabled'] == true,
                      onChanged: (v) => redraw(() => p['enabled'] = v),
                    ),
                    IconButton(
                      tooltip: '移除配置',
                      onPressed: () => redraw(
                        () => config['harnesses'] = profiles
                            .where((x) => x != p)
                            .toList(),
                      ),
                      icon: const Icon(Icons.delete_outline, size: 18),
                    ),
                  ],
                ),
                input(
                  '名称',
                  'harness:${p['id']}:name',
                  p['name'],
                  changed: (v) => p['name'] = v,
                ),
                input(
                  '绝对可执行文件路径',
                  'harness:${p['id']}:exe',
                  p['executable'],
                  changed: (v) => p['executable'] = v,
                ),
                input(
                  '工作目录（可选）',
                  'harness:${p['id']}:cwd',
                  p['cwd'],
                  changed: (v) => p['cwd'] = v,
                ),
                input(
                  '参数（每行一个，可用 {prompt}）',
                  'harness:${p['id']}:args',
                  (p['args'] as List? ?? []).join('\n'),
                  lines: 3,
                  changed: (v) => p['args'] = v
                      .split('\n')
                      .where((s) => s.isNotEmpty)
                      .toList(),
                ),
                SettingSwitchTile(
                  title: const Text('通过标准输入传递需求'),
                  value: p['stdin'] == true,
                  onChanged: (v) => redraw(() => p['stdin'] = v),
                ),
                Row(
                  children: [
                    button(
                      '保存配置',
                      () async =>
                          saveConfig({'harnesses': config['harnesses']}),
                    ),
                    const SizedBox(width: 8),
                    button('测试需求', () async {
                      final prompt = await ask('交给本机 Agent 的需求');
                      if (prompt == null || prompt.isEmpty) return;
                      await saveConfig({'harnesses': config['harnesses']});
                      final result = object(
                        await post('/harness/test', {
                          'account': widget.account,
                          'id': p['id'],
                          'prompt': prompt,
                        }),
                      );
                      redraw(
                        () => notice =
                            '退出码 ${result['code']}\n${result['stdout']}\n${result['stderr']}',
                      );
                    }),
                  ],
                ),
              ],
            ),
          ),
        button('添加本机 Agent', () async {
          final id = 'agent-${DateTime.now().microsecondsSinceEpoch}';
          redraw(
            () => config['harnesses'] = [
              ...profiles,
              {
                'id': id,
                'name': '本机 Agent',
                'enabled': false,
                'executable': '',
                'cwd': '',
                'args': <String>[],
                'stdin': true,
                'timeoutSeconds': 120,
              },
            ],
          );
        }),
        button(
          '保存 Agent 配置',
          () async => saveConfig({'harnesses': config['harnesses']}),
        ),
        const Text('允许模型委派需求需同时开启工具 delegate_agent；启用前请自行选择已信任的本机程序。'),
      ],
    );
  }

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
      if (widget.page == 'tools' || widget.page == 'skills') harnessEditor(),
      if (widget.page == 'tools') ...[
        const Text('敏感群操作与 Agent 委派（默认关闭）'),
        for (final id in [
          'set_group_ban',
          'set_group_kick',
          'set_group_card',
          'delete_message',
          'group_poke',
          'delegate_agent',
        ])
          CheckboxListTile(
            dense: true,
            title: Text(id),
            value: object(object(config['tools'])['overrides'])[id] == true,
            onChanged: (v) => redraw(() {
              final tools = object(config['tools']);
              tools['overrides'] = {...object(tools['overrides']), id: v};
              config['tools'] = tools;
            }),
          ),
      ],
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
      heading('SnowLuma 管理', 'QQAF 安装包未内置组件；可在此获取官方完整包并安装。'),
      _snowStatusPanel(),
      const SizedBox(height: 16),
      SnowDownloadPanel(
        core: widget.core,
        account: widget.account!,
        installed: (directory) {
          if (mounted) {
            redraw(() {
              control('snow-dir').text = directory;
              widget.onSnowInstalled?.call();
              config['snowluma'] = {
                ...object(config['snowluma']),
                'dir': directory,
              };
            });
          }
        },
      ),
      const Text('已有组件也可手动填写目录；安装后默认识别程序根目录的 Snowluma。启动由你控制。'),
      button('获取官方 SnowLuma', () async {
        await DesktopBridge.openUrl(
          'https://github.com/SnowLuma/SnowLuma/releases',
        );
      }),
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
                notice = result['available'] == false
                    ? '${result['message']}'
                    : result['listening'] == true
                    ? 'WebUI 端口已就绪 · ${result['directory']}'
                    : '组件已找到，尚未启动 · ${result['directory']}';
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
            if (result['available'] == false) {
              if (mounted) redraw(() => notice = '${result['message']}');
              return;
            }
            await DesktopBridge.openUrl('${result['webuiUrl']}');
          }),
          button('查看日志', () async {
            final result = await get('/snow/logs');
            if (mounted) redraw(() => notice = '${result['text']}');
          }),
        ],
      ),
    ],
  );

  Widget _snowStatusPanel() {
    final available = data['available'];
    final listening = data['listening'] == true;
    final directory = '${data['directory'] ?? ''}';
    final webuiUrl = '${data['webuiUrl'] ?? ''}';
    final logText = '${data['log'] ?? data['message'] ?? ''}';

    Color dotColor;
    String statusLabel;
    if (available == false) {
      dotColor = Colors.red;
      statusLabel = '未找到组件';
    } else if (listening) {
      dotColor = Colors.green;
      statusLabel = 'WebUI 已就绪';
    } else if (available == true) {
      dotColor = Colors.orange;
      statusLabel = '已找到，未启动';
    } else {
      dotColor = Colors.grey;
      statusLabel = '未检测';
    }

    return SurfacePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: dotColor,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                statusLabel,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ],
          ),
          if (directory.isNotEmpty) ...[
            const SizedBox(height: 8),
            _snowField('目录', directory),
          ],
          if (webuiUrl.isNotEmpty) ...[
            const SizedBox(height: 4),
            _snowField('地址', webuiUrl),
          ],
          if (logText.isNotEmpty) ...[
            const SizedBox(height: 8),
            _SnowLogSection(logText: logText),
          ],
        ],
      ),
    );
  }

  Widget _snowField(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 40,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).hintColor,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: SelectableText(value, style: const TextStyle(fontSize: 12)),
        ),
      ],
    ),
  );
  Widget desktopPage() {
    if (widget.page == 'personalize') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          heading('个性化', '字体与显示偏好；Minecraft 的像素字体在主题页配置。'),
          FoldPanel(
            title: '界面字体',
            subtitle: '默认皮肤 / 字号 / 预览',
            icon: Icons.text_fields,
            initiallyExpanded: true,
            children: [
              dropdown('字体', '${data['fontFamily'] ?? 'Segoe UI'}', [
                for (final font in [
                  'Segoe UI',
                  'Microsoft YaHei',
                  'Arial',
                  'Consolas',
                ])
                  DropdownMenuItem(value: font, child: Text(font)),
              ], (v) => redraw(() => data['fontFamily'] = v)),
              Row(
                children: [
                  const SizedBox(width: 60, child: Text('字号')),
                  Expanded(
                    child: Slider(
                      value: ((data['fontSize'] as num?)?.toDouble() ?? 13)
                          .clamp(11, 18),
                      min: 11,
                      max: 18,
                      divisions: 7,
                      onChanged: (v) => redraw(() => data['fontSize'] = v),
                    ),
                  ),
                  SizedBox(
                    width: 40,
                    child: Text('${(data['fontSize'] as num? ?? 13).round()}'),
                  ),
                ],
              ),
              SurfacePanel(
                child: Text(
                  'QQ Agent ARCFØX\n你好，这是字体与字号预览。0123456789',
                  style: TextStyle(
                    fontFamily: '${data['fontFamily'] ?? 'Segoe UI'}',
                    fontSize: (data['fontSize'] as num? ?? 13).toDouble(),
                  ),
                ),
              ),
            ],
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: button('保存显示偏好', () async {
              await widget.core.request('/preferences', body: data);
              redraw(() => notice = '已保存，界面将同步显示偏好。');
            }),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        heading('桌面端', '窗口、托盘、开机启动与本地代理。'),
        FoldPanel(
          title: '窗口与启动',
          subtitle: '关闭行为 / 实验版开机启动',
          icon: Icons.desktop_windows_outlined,
          initiallyExpanded: true,
          children: [
            dropdown(
              '关闭窗口时',
              data['closeAction'] as String? ??
                  (data['closeToTray'] == true ? 'tray' : 'taskbar'),
              [
                const DropdownMenuItem(
                  value: 'taskbar',
                  child: Text('最小化到任务栏（默认）'),
                ),
                const DropdownMenuItem(value: 'tray', child: Text('隐藏到系统托盘')),
                const DropdownMenuItem(value: 'exit', child: Text('退出程序')),
              ],
              (v) => redraw(() => data['closeAction'] = v),
            ),
            SettingSwitchTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('实验版开机启动'),
              value: data['autoStart'] == true,
              onChanged: (v) => redraw(() => data['autoStart'] = v),
            ),
            dropdown('颜色模式', data['theme'] as String? ?? 'light', [
              for (final e in {
                'light': '亮色',
                'dark': '暗色',
                'auto': '跟随系统',
              }.entries)
                DropdownMenuItem(value: e.key, child: Text(e.value)),
            ], (v) => redraw(() => data['theme'] = v)),
            Align(
              alignment: Alignment.centerLeft,
              child: button('保存桌面设置', () async {
                await DesktopBridge.setStartup(data['autoStart'] == true);
                await widget.core.request('/preferences', body: data);
                if (mounted) redraw(() => notice = '已保存桌面设置。');
              }),
            ),
          ],
        ),
        FoldPanel(
          title: '本地网络代理',
          subtitle: '通过 HTTP/HTTPS 本地代理访问网络',
          icon: Icons.public,
          children: [
            editor('proxy', config['proxy']),
            Align(
              alignment: Alignment.centerLeft,
              child: button(
                '保存网络代理',
                () async => saveConfig({'proxy': config['proxy']}),
              ),
            ),
          ],
        ),
      ],
    );
  }

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
  Widget activityEditor({bool group = false}) {
    final store = object(config['store']);
    final groupId = target.startsWith('group:') ? target.substring(6) : target;
    final overrides = object(store['groupSliderPos']);
    double pos = (group ? overrides[groupId] : store['contextSliderPos']) is num
        ? ((group ? overrides[groupId] : store['contextSliderPos']) as num)
              .toDouble()
        : switch ((store['contextTier'] as num?)?.toInt() ?? 1) {
            4 => 100,
            3 => 20 + (store['randomPercent'] as num? ?? 10) / 100 * 70,
            2 => 15,
            _ => 5,
          };
    pos = pos.clamp(0, 100);
    final tier = pos <= 10
        ? 1
        : pos <= 20
        ? 2
        : pos <= 90
        ? 3
        : 4;
    final probability = tier == 3
        ? (pos - 20) / 70 * 100
        : tier == 4
        ? 100
        : 0;
    void change(double v) {
      redraw(() {
        if (group) {
          store['groupSliderPos'] = {...overrides, groupId: v};
        } else {
          store['contextSliderPos'] = v;
        }
        config['store'] = store;
      });
    }

    final peak = object(store['peakSchedule']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (group) ...[
          SettingSwitchTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('使用群独立档位'),
            subtitle: const Text('关闭统一设置后，未单独配置的群继续沿用默认档位。'),
            value: store['unifiedTier'] == false,
            onChanged: (v) => redraw(() {
              store['unifiedTier'] = !v;
              config['store'] = store;
            }),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => redraw(() {
                store['groupSliderPos'] = {...overrides, groupId: null};
                store['groupPeakPos'] = {
                  ...object(store['groupPeakPos']),
                  groupId: null,
                };
                config['store'] = store;
              }),
              child: const Text('清除本群单独设置（保存后生效）'),
            ),
          ),
        ],

        Row(
          children: [
            for (final n in [1, 2, 3, 4])
              Expanded(
                flex: n == 3 ? 7 : 1,
                child: Container(
                  padding: const EdgeInsets.all(10),
                  color: Theme.of(context).colorScheme.primary
                      .withValues(alpha: tier == n ? .2 : .05),
                  child: Text(
                    n == 3 ? '3 · 随机概率线性' : '$n',
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
              ),
          ],
        ),
        Slider(value: pos, min: 0, max: 100, onChanged: change),
        Row(
          children: [
            Text(
              '$tier 档',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                tier == 1
                    ? '被 @ 时响应'
                    : tier == 2
                    ? '被 @ 或命中关键词响应'
                    : tier == 3
                    ? '每条普通消息 ${probability.toStringAsFixed(1)}% 概率响应'
                    : '响应每条普通消息',
              ),
            ),
          ],
        ),

        if (group && peak['enabled'] == true) ...[
          for (final entry in {'peak': '高峰档位', 'valley': '低谷档位'}.entries)
            Row(
              children: [
                SizedBox(width: 80, child: Text(entry.value)),
                Expanded(
                  child: Slider(
                    value:
                        ((object(object(store['groupPeakPos'])[groupId])[entry
                                            .key]
                                        as num?)
                                    ?.toDouble() ??
                                (object(peak[entry.key])['sliderPos'] as num? ??
                                        10)
                                    .toDouble())
                            .clamp(0, 100),
                    min: 0,
                    max: 100,
                    onChanged: (v) => redraw(() {
                      final all = object(store['groupPeakPos']);
                      all[groupId] = {...object(all[groupId]), entry.key: v};
                      store['groupPeakPos'] = all;
                      config['store'] = store;
                    }),
                  ),
                ),
              ],
            ),
        ],
        if (!group) ...[
          const SizedBox(height: 14),
          SettingSwitchTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('统一设置'),
            value: store['unifiedTier'] != false,
            onChanged: (v) => redraw(() {
              store['unifiedTier'] = v;
              config['store'] = store;
            }),
          ),
          SettingSwitchTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('峰谷时段'),
            value: peak['enabled'] == true,
            onChanged: (v) => redraw(() {
              store['peakSchedule'] = {...peak, 'enabled': v};
              config['store'] = store;
            }),
          ),
          if (peak['enabled'] == true) ...[
            editor(
              'store.peakSchedule.peak',
              valueAt('store.peakSchedule.peak'),
            ),
            editor(
              'store.peakSchedule.valley',
              valueAt('store.peakSchedule.valley'),
            ),
          ],
        ],
      ],
    );
  }

  Widget settingsPage() {
    if (widget.page == 'chat-settings') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          heading('聊天设置', '选择默认响应档位；单独配置前往人设中的身份与模型设置。'),
          FoldPanel(
            title: '信息发送配置',
            subtitle: '自动回复 / 发送节奏 / 上下文',
            icon: Icons.message_outlined,
            children: [
              editor('runtime', config['runtime']),
              editor('send', config['send']),
              editor('store.historyCount', valueAt('store.historyCount')),
              editor('store.keywords', valueAt('store.keywords')),
            ],
          ),
          FoldPanel(
            title: '活跃设置',
            subtitle: '响应档位 / 峰谷 · 默认档位',
            icon: Icons.bolt_outlined,
            children: [activityEditor()],
          ),
          FoldPanel(
            title: '指令禁言',
            subtitle: '收到指定指令后暂停响应',
            icon: Icons.volume_off_outlined,
            children: [editor('commandMute', config['commandMute'])],
          ),
          const FoldPanel(
            title: '主动开话题',
            subtitle: '冷场时主动参与',
            icon: Icons.forum_outlined,
            children: [Text('原生执行链路尚未迁移，暂不开放设置。')],
          ),
          const FoldPanel(
            title: '表情包',
            subtitle: '收藏同步 / 发送积极度',
            icon: Icons.emoji_emotions_outlined,
            children: [Text('原生执行链路尚未迁移，暂不开放设置。')],
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: button(
              '保存聊天设置',
              () async => saveConfig({
                for (final k in ['runtime', 'send', 'store', 'commandMute'])
                  k: config[k],
              }),
            ),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        heading('进阶', '网络边界、并发和保存记录。'),
        FoldPanel(
          title: '响应调度',
          subtitle: '唤醒延迟 / 最大并发',
          icon: Icons.tune,
          children: [
            editor('wakeDelayMs', config['wakeDelayMs']),
            editor('maxConcurrentRuns', config['maxConcurrentRuns']),
          ],
        ),
        FoldPanel(
          title: '网络访问',
          subtitle: '域名锁 / 安全边界',
          icon: Icons.security_outlined,
          children: [editor('security', config['security'])],
        ),
        FoldPanel(
          title: '人设保存记录',
          subtitle: '保留天数 / 记录上限',
          icon: Icons.history,
          children: [editor('personaHistory', config['personaHistory'])],
        ),
        const FoldPanel(
          title: '记忆整合与重试',
          subtitle: '执行链路待迁移',
          icon: Icons.memory_outlined,
          children: [Text('自动记忆整合、运行重试和定时清理尚未迁移。')],
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: button(
            '保存设置',
            () async => saveConfig({
              for (final k in [
                'wakeDelayMs',
                'maxConcurrentRuns',
                'security',
                'personaHistory',
              ])
                k: config[k],
            }),
          ),
        ),
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

class _SnowLogSection extends StatefulWidget {
  const _SnowLogSection({required this.logText});
  final String logText;
  @override
  State<_SnowLogSection> createState() => _SnowLogSectionState();
}

class _SnowLogSectionState extends State<_SnowLogSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final lines = widget.logText.split('\n');
    final preview = lines.take(3).join('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          child: Row(
            children: [
              Icon(
                _expanded ? Icons.expand_less : Icons.expand_more,
                size: 16,
                color: Theme.of(context).hintColor,
              ),
              const SizedBox(width: 4),
              Text(
                '日志',
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).hintColor,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(4),
          ),
          child: SelectableText(
            _expanded ? widget.logText : preview,
            style: const TextStyle(fontSize: 11, fontFamily: 'Consolas'),
          ),
        ),
      ],
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
