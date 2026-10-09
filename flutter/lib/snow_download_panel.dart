import 'dart:async';
import 'dart:io';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core_client.dart';
import 'desktop_bridge.dart';

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : {};

class SnowDownloadPanel extends StatefulWidget {
  const SnowDownloadPanel({
    super.key,
    required this.core,
    required this.account,
    required this.installed,
  });
  final CoreApi core;
  final String account;
  final ValueChanged<String> installed;
  @override
  State<SnowDownloadPanel> createState() => _SnowDownloadPanelState();
}

class _SnowDownloadPanelState extends State<SnowDownloadPanel> {
  final directory = TextEditingController();
  Map<String, dynamic> job = {},
      compatibility = {},
      component = {};
  List<Map<String, dynamic>> releases = [];
  String? selectedTag;
  String selectedVariant = 'auto';
  String message = '';
  String? notifiedInstall;
  bool busy = false, polling = false, loadingReleases = false;
  Timer? timer;

  bool get active =>
      ['downloading', 'verifying', 'installing'].contains(job['phase']);

  String get effectiveTag =>
      selectedTag ??
      (compatibility['recommended'] as String?) ??
      (compatibility['targetVersion'] as String?) ??
      'v1.14.22';

  String get targetVersionDisplay =>
      effectiveTag.replaceFirst(RegExp(r'^v'), '');

  @override
  void initState() {
    super.initState();
    unawaited(load());
    timer = Timer.periodic(const Duration(seconds: 2), (_) {
      if (active) unawaited(refresh());
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    directory.dispose();
    super.dispose();
  }

  Future<dynamic> get(String path) =>
      widget.core.request(path, query: {'account': widget.account});
  Future<dynamic> post(String path, Map<String, dynamic> values) =>
      widget.core.request(path, body: {'account': widget.account, ...values});

  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      busy = true;
      message = '';
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> load() async {
    try {
      final plan = _map(await get('/snow/install/plan'));
      if (!mounted) return;
      directory.text = '${plan['defaultDirectory'] ?? ''}';
      compatibility = _map(plan['compatibility']);
      component = _map(plan['component']);
      if (component['available'] == true &&
          plan['configuredDirectory'] is String &&
          (plan['configuredDirectory'] as String).isNotEmpty) {
        directory.text = '${component['directory']}';
      }
      setState(() {});
      await refresh();
      unawaited(fetchReleases());
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    }
  }

  Future<void> fetchReleases() async {
    if (loadingReleases || !mounted) return;
    setState(() => loadingReleases = true);
    try {
      final data = _map(await post('/snow/releases', {}));
      if (!mounted) return;
      final list = (data['releases'] as List? ?? [])
          .map((e) => _map(e))
          .toList();
      setState(() {
        releases = list;
        compatibility = _map(data['compatibility']);
        // Default to the manifest recommended version if no selection yet.
        if (selectedTag == null && list.isNotEmpty) {
          final recommended =
              (compatibility['recommended'] as String?) ??
              (compatibility['targetVersion'] as String?);
          final hasRecommended =
              recommended != null && list.any((r) => r['tag'] == recommended);
          selectedTag = hasRecommended ? recommended : '${list.first['tag']}';
        }
      });
    } catch (error) {
      if (mounted && message.isEmpty) {
        setState(() => message = '获取版本列表失败：$error');
      }
    } finally {
      if (mounted) setState(() => loadingReleases = false);
    }
  }

  Future<void> refresh() async {
    if (polling || !mounted) return;
    polling = true;
    try {
      final snapshot = _map(await get('/snow/download/status'));
      if (!mounted) return;
      final next = _map(snapshot['job']);
      if (jsonEncode(next) != jsonEncode(job)) {
        setState(() {
          job = next;
          compatibility = _map(snapshot['compatibility']);
        });
      }
      await notifyInstalled(next);
      final check = _map(snapshot['check']);
      if (check['error'] is String && message.isEmpty) {
        setState(() => message = '${check['error']}');
      }
    } catch (error) {
      if (mounted && message.isEmpty) {
        setState(() => message = '下载状态读取失败：$error');
      }
    } finally {
      polling = false;
    }
  }

  Future<void> notifyInstalled(Map<String, dynamic> next) async {
    if (!mounted ||
        next['phase'] != 'installed' ||
        next['installDirectory'] is! String ||
        next['id'] == notifiedInstall) {
      return;
    }
    notifiedInstall = '${next['id']}';
    widget.installed(next['installDirectory'] as String);
    final plan = _map(await get('/snow/install/plan'));
    if (mounted) setState(() => component = _map(plan['component']));
  }

  bool get _isDefaultDirectory {
    // Check if the current directory.text is the default (app root / Snowluma).
    final installed = job['installDirectory'] as String?;
    if (installed == null) return false;
    final lower = installed.toLowerCase();
    return lower.endsWith('\\snowluma') || lower.endsWith('/snowluma');
  }

  Map<String, dynamic>? get _selectedRelease =>
      releases.cast<Map<String, dynamic>?>().firstWhere(
        (r) => r?['tag'] == effectiveTag,
        orElse: () => null,
      );

  /// Resolved variant name for display. 'auto' shows as 'Lite' or '完整版' based
  /// on what the server would pick, but we cannot know without asking — so we
  /// just label it '自动'.
  String _variantLabel(String v) => switch (v) {
        'lite' => 'Lite（需 Node.js）',
        'full' => '完整版（内置 Node.js）',
        _ => '自动（推荐）',
      };

  Future<void> begin(bool install) async {
    final body = <String, dynamic>{
      'tag': effectiveTag,
      'variant': selectedVariant == 'auto' ? null : selectedVariant,
      if (install) 'directory': directory.text.trim(),
      if (job['tag'] != null && job['tag'] == effectiveTag)
        'expectedTag': effectiveTag,
    };
    // Remove null variant so the backend uses auto-detection.
    body.removeWhere((k, v) => v == null);
    final result = _map(
      await post(install ? '/snow/install' : '/snow/download/start', body),
    );
    if (mounted) setState(() => job = _map(result['job']));
    await notifyInstalled(_map(result['job']));
    await refresh();
  }

  String size(dynamic bytes) =>
      '${((bytes is num ? bytes : 0) / 1024 / 1024).toStringAsFixed(1)} MB';

  String phase() => switch (job['phase']) {
        'downloading' => '正在下载',
        'verifying' => '正在校验',
        'installing' => '正在安装',
        'completed' => '下载完成，SHA-256 校验通过',
        'installed' => '安装完成，SHA-256 校验通过',
        'cancelled' => '已取消',
        'interrupted' => '上次任务中断，可重新安装',
        'failed' => '任务失败，可重试',
        _ => '尚未开始',
      };

  String _installButtonLabel() {
    final v = selectedVariant == 'auto'
        ? ''
        : '（${_variantLabel(selectedVariant).split('（').first}）';
    if (component['updateAvailable'] == true) {
      return '更新 SnowLuma 至 $targetVersionDisplay$v';
    }
    return '安装 SnowLuma $targetVersionDisplay$v';
  }

  @override
  Widget build(BuildContext context) {
    final received = job['received'] is num ? job['received'] as num : 0;
    final total = job['total'] is num ? job['total'] as num : 0;
    final rel = _selectedRelease;
    final installedVariant =
        (component['available'] == true)
            ? (component['variant'] as String? ?? '')
            : '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('获取与安装', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        const Text(
          '选择版本和类型后安装。Lite 包体积更小，需要系统预装 Node.js 22.13+ 或 23.4+。完整版内置 Node.js，开箱即用。',
        ),
        const SizedBox(height: 12),

        // ── Version and variant selectors ──────────────────────────────────
        Row(
          children: [
            Expanded(
              flex: 3,
              child: _VersionDropdown(
                releases: releases,
                selected: selectedTag,
                loading: loadingReleases,
                enabled: !busy && !active,
                onChanged: (tag) => setState(() => selectedTag = tag),
                onRefresh: () => unawaited(run(fetchReleases)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 2,
              child: DropdownButtonFormField<String>(
                key: ValueKey('variant:$selectedVariant'),
                initialValue: selectedVariant,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: '类型',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: ['auto', 'lite', 'full']
                    .map(
                      (v) => DropdownMenuItem(
                        value: v,
                        child: Text(
                          _variantLabel(v),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(),
                onChanged: busy || active
                    ? null
                    : (v) => setState(() => selectedVariant = v ?? 'auto'),
              ),
            ),
          ],
        ),

        const SizedBox(height: 8),
        if (component['available'] == true) ...[
          Text(
            '已安装 SL：${component['installedVersion'] ?? '版本未知'}'
            '${installedVariant.isNotEmpty ? '（$installedVariant）' : ''}',
          ),
          if (component['updateAvailable'] == true)
            const Text('已有 SL 版本低于当前选择，可点击更新。'),
          if (component['newerInstalled'] == true)
            const Text('已安装的 SL 高于当前选择；不会自动降级。'),
          const SizedBox(height: 8),
        ],

        // ── Install directory ──────────────────────────────────────────────
        TextField(
          controller: directory,
          enabled: !busy && !active,
          decoration: const InputDecoration(
            labelText: '安装目录',
            helperText: '默认：QQAF 根目录 / Snowluma，可修改完整路径',
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton(
              onPressed: busy || active
                  ? null
                  : () => unawaited(
                      run(() async {
                        final parent = await DesktopBridge.chooseDirectory();
                        if (parent != null && mounted) {
                          directory.text =
                              '$parent${Platform.pathSeparator}Snowluma';
                        }
                      }),
                    ),
              child: const Text('选择父文件夹'),
            ),
            FilledButton(
              onPressed: busy || active
                  ? null
                  : () => unawaited(run(() => begin(true))),
              child: Text(_installButtonLabel()),
            ),
            OutlinedButton(
              onPressed: busy || active
                  ? null
                  : () => unawaited(run(() => begin(false))),
              child: const Text('仅下载原包'),
            ),
            if (active)
              OutlinedButton(
                onPressed: busy
                    ? null
                    : () => unawaited(
                        run(() async {
                          await post('/snow/download/cancel', {});
                          await refresh();
                        }),
                      ),
                child: const Text('取消任务'),
              ),
          ],
        ),

        // ── Release info ───────────────────────────────────────────────────
        if (rel != null) ...[
          const SizedBox(height: 12),
          Text(
            '${rel['tag']} · '
            '${rel['compatibility'] == 'validated' ? '已适配' : rel['compatibility'] == 'targeted' ? '当前适配目标' : '未验收'}'
            '${rel['hasLite'] == true ? ' · 有 Lite' : ''}'
            '${rel['hasFull'] == true ? ' · 有完整版' : ''}',
          ),
          TextButton(
            onPressed: () => unawaited(
              run(() => DesktopBridge.openUrl(
                  'https://github.com/SnowLuma/SnowLuma/releases/tag/${rel['tag']}')),
            ),
            child: const Text('查看官方版本说明'),
          ),
        ],

        // ── Job progress ───────────────────────────────────────────────────
        if (job.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('${job['tag']} · ${phase()}'),
          if (active) ...[
            const SizedBox(height: 6),
            LinearProgressIndicator(
              value: total > 0
                  ? (received / total).clamp(0, 1).toDouble()
                  : null,
            ),
            Text('${size(received)} / ${size(total)}'),
          ],
          if (job['error'] is String) SelectableText('${job['error']}'),
          if (job['installDirectory'] is String)
            SelectableText('安装位置：${job['installDirectory']}'),
          if (job['backupDirectory'] is String)
            SelectableText('原组件备份：${job['backupDirectory']}'),
          // Installed to default directory: show restart hint.
          if (job['phase'] == 'installed' && _isDefaultDirectory)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                '已安装到程序根目录 Snowluma 文件夹，重启 QQAF 后自动发现。',
                style: TextStyle(fontStyle: FontStyle.italic),
              ),
            ),
          Wrap(
            spacing: 8,
            children: [
              if (job['path'] is String)
                TextButton(
                  onPressed: () => unawaited(
                    run(
                      () => DesktopBridge.openDirectory(
                        File(job['path'] as String).parent.path,
                      ),
                    ),
                  ),
                  child: const Text('打开下载位置'),
                ),
              if (job['phase'] == 'installed' &&
                  job['installDirectory'] is String)
                TextButton(
                  onPressed: () => unawaited(
                    run(
                      () => DesktopBridge.openDirectory(
                        job['installDirectory'] as String,
                      ),
                    ),
                  ),
                  child: const Text('打开安装目录'),
                ),
              if (job['path'] is String)
                TextButton(
                  onPressed: () => unawaited(
                    run(() async {
                      await Clipboard.setData(
                        ClipboardData(text: job['path'] as String),
                      );
                    }),
                  ),
                  child: const Text('复制原包路径'),
                ),
            ],
          ),
        ],

        const SizedBox(height: 10),
        if (busy)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: LinearProgressIndicator(),
          ),
        if (message.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: SelectableText(message),
          ),
        const Divider(height: 32),
      ],
    );
  }
}

/// Dropdown that lists available release versions, with a refresh button.
class _VersionDropdown extends StatelessWidget {
  const _VersionDropdown({
    required this.releases,
    required this.selected,
    required this.loading,
    required this.enabled,
    required this.onChanged,
    required this.onRefresh,
  });

  final List<Map<String, dynamic>> releases;
  final String? selected;
  final bool loading;
  final bool enabled;
  final ValueChanged<String?> onChanged;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const SizedBox(
        height: 48,
        child: Center(child: LinearProgressIndicator()),
      );
    }
    if (releases.isEmpty) {
      return OutlinedButton.icon(
        onPressed: enabled ? onRefresh : null,
        icon: const Icon(Icons.refresh, size: 14),
        label: const Text('获取版本列表'),
      );
    }
    final validSelected =
        releases.any((r) => r['tag'] == selected) ? selected : null;
    return DropdownButtonFormField<String>(
      key: ValueKey('version:$selected'),
      initialValue: validSelected,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: '版本',
        border: const OutlineInputBorder(),
        isDense: true,
        suffixIcon: IconButton(
          icon: const Icon(Icons.refresh, size: 16),
          tooltip: '刷新版本列表',
          onPressed: enabled ? onRefresh : null,
        ),
      ),
      items: releases
          .map(
            (r) => DropdownMenuItem<String>(
              value: '${r['tag']}',
              child: Text(
                '${r['tag']}'
                '${r['compatibility'] == 'targeted' ? ' ★' : r['compatibility'] == 'validated' ? ' ✓' : ''}',
                overflow: TextOverflow.ellipsis,
              ),
            ),
          )
          .toList(),
      onChanged: enabled ? onChanged : null,
    );
  }
}
