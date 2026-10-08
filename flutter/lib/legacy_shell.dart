import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:window_manager/window_manager.dart';

import 'app_style.dart';

const primaryPages = <(int, String, IconData)>[
  (0, '仪表盘', Icons.speed_outlined),
  (1, '会话', Icons.chat_bubble_outline),
  (6, '存档', Icons.inventory_2_outlined),
  (4, '记忆', Icons.memory_outlined),
  (7, '用量', Icons.bar_chart),
  (8, '人设', Icons.badge_outlined),
  (9, '技能', Icons.auto_awesome_outlined),
  (10, '插件', Icons.extension_outlined),
  (11, '账号', Icons.people_outline),
  (2, '设置', Icons.settings_outlined),
  (18, '社区与市场', Icons.storefront_outlined),
];
const settingsPages = <(int, String)>[
  (2, 'API与搜索'),
  (4, '记忆'),
  (12, '聊天白名单'),
  (13, '聊天设置'),
  (14, '桌面端'),
  (15, '个性化'),
  (5, '主题'),
  (3, 'OneBot (SnowLuma)'),
  (16, '进阶'),
  (17, '工具与技能'),
];

/// Native Flutter recreation of the archived desktop shell's geometry.
class LegacyShell extends StatefulWidget {
  const LegacyShell({
    super.key,
    required this.section,
    required this.select,
    required this.minecraft,
    required this.toolbar,
    required this.content,
    required this.notice,
    required this.busy,
    required this.model,
    required this.refresh,
  });
  final int section;
  final ValueChanged<int> select;
  final bool minecraft, busy;
  final Widget toolbar, content;
  final String notice, model;
  final VoidCallback refresh;
  @override
  State<LegacyShell> createState() => _LegacyShellState();
}

class _LegacyShellState extends State<LegacyShell> {
  bool collapsed = false;
  bool get settings =>
      [2, 3, 5, 12, 13, 14, 15, 16, 17].contains(widget.section);

  Widget nav(BuildContext context, int id, String label, {IconData? icon}) {
    final selected = widget.section == id || (id == 2 && settings);
    final accent = Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Material(
        color: selected ? accent.withValues(alpha: .12) : Colors.transparent,
        borderRadius: BorderRadius.circular(widget.minecraft ? 0 : 8),
        child: InkWell(
          borderRadius: BorderRadius.circular(widget.minecraft ? 0 : 8),
          onTap: () => widget.select(id),
          child: Container(
            height: 36,
            padding: EdgeInsets.symmetric(
              horizontal: collapsed && icon != null ? 8 : 10,
            ),
            decoration: BoxDecoration(
              border: selected
                  ? Border(left: BorderSide(color: accent, width: 2))
                  : null,
            ),
            child: Row(
              children: [
                if (icon != null) ...[
                  widget.minecraft
                      ? PixelIcon(pixelNav[id] ?? 'gear')
                      : Icon(
                          icon,
                          size: 18,
                          color: selected
                              ? accent
                              : Theme.of(context).hintColor,
                        ),
                  if (!collapsed) const SizedBox(width: 12),
                ],
                if (icon == null || !collapsed)
                  Expanded(
                    child: Text(
                      label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: selected ? accent : null),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = settings
        ? '设置'
        : primaryPages
              .firstWhere(
                (p) => p.$1 == widget.section,
                orElse: () => primaryPages.first,
              )
              .$2;
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.keyB, control: true): () =>
            setState(() => collapsed = !collapsed),
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          appBar: AppBar(
            toolbarHeight: 40,
            titleSpacing: 10,
            title: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanStart: (_) => windowManager.startDragging(),
              onDoubleTap: () async {
                if (await windowManager.isMaximized()) {
                  await windowManager.unmaximize();
                } else {
                  await windowManager.maximize();
                }
              },
              child: Row(
                children: [
                  widget.minecraft
                      ? const PixelIcon('gear')
                      : SvgPicture.asset(
                          'assets/startup/arcfox-logo.svg',
                          width: 24,
                          height: 24,
                        ),
                  const SizedBox(width: 8),
                  const Text(
                    'QQ Agent ARCFØX',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context).hintColor,
                    ),
                  ),
                  IconButton(
                    tooltip: '刷新',
                    onPressed: widget.refresh,
                    icon: const Icon(Icons.refresh, size: 16),
                  ),
                ],
              ),
            ),
            actions: [
              const Center(
                child: Text('0.1.1 · 实验版', style: TextStyle(fontSize: 11)),
              ),
              const SizedBox(width: 12),
              IconButton(
                tooltip: '最小化',
                onPressed: windowManager.minimize,
                icon: const Icon(Icons.remove, size: 16),
              ),
              IconButton(
                tooltip: '最大化 / 还原',
                onPressed: () async {
                  if (await windowManager.isMaximized()) {
                    await windowManager.unmaximize();
                  } else {
                    await windowManager.maximize();
                  }
                },
                icon: const Icon(Icons.crop_square, size: 14),
              ),
              IconButton(
                tooltip: '关闭',
                onPressed: windowManager.close,
                icon: const Icon(Icons.close, size: 16),
              ),
            ],
          ),
          body: Column(
            children: [
              SizedBox(
                key: const ValueKey('status-toolbar'),
                height: 44,
                child: widget.toolbar,
              ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) => Row(
                    children: [
                      SizedBox(
                        key: const ValueKey('navigation-width'),
                        width: collapsed
                            ? 60
                            : widget.minecraft
                            ? 168
                            : 152,
                        child: ListView(
                          key: const ValueKey('main-nav'),
                          children: [
                            Tooltip(
                              message: collapsed ? '展开导航' : '收起导航',
                              child: TextButton(
                                onPressed: () =>
                                    setState(() => collapsed = !collapsed),
                                child: Row(
                                  children: [
                                    const Icon(Icons.menu, size: 18),
                                    if (!collapsed) ...[
                                      const SizedBox(width: 12),
                                      const Text('收起导航'),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            for (final p in primaryPages)
                              nav(context, p.$1, p.$2, icon: p.$3),
                          ],
                        ),
                      ),
                      if (settings && constraints.maxWidth >= 1050)
                        SizedBox(
                          width: widget.minecraft ? 188 : 202,
                          child: ListView(
                            key: const ValueKey('settings-nav'),
                            children: [
                              Card(
                                margin: const EdgeInsets.fromLTRB(8, 12, 8, 14),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text('机器人运行状态'),
                                      const SizedBox(height: 8),
                                      Text(
                                        widget.notice,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(fontSize: 11),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        '模型：${widget.model}',
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              for (final p in settingsPages)
                                nav(context, p.$1, p.$2),
                            ],
                          ),
                        ),
                      Expanded(
                        child: Column(
                          children: [
                            if (settings && constraints.maxWidth < 1050)
                              SizedBox(
                                height: 40,
                                child: ListView(
                                  scrollDirection: Axis.horizontal,
                                  children: [
                                    for (final p in settingsPages)
                                      TextButton(
                                        onPressed: () => widget.select(p.$1),
                                        child: Text(p.$2),
                                      ),
                                  ],
                                ),
                              ),
                            Expanded(child: widget.content),
                            if (widget.busy)
                              const LinearProgressIndicator(minHeight: 2),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 24,
                                vertical: 5,
                              ),
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  widget.notice,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Theme.of(context).hintColor,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
