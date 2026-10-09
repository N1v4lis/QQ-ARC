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
      release = {},
      compatibility = {},
      component = {};
  String message = '';
  String? notifiedInstall;
  bool busy = false, polling = false;
  Timer? timer;
  bool get active =>
      ['downloading', 'verifying', 'installing'].contains(job['phase']);
  String get channel => 'compatible';
  String get targetVersion =>
      '${compatibility['targetVersion'] ?? compatibility['recommended'] ?? 'v1.14.22'}'
          .replaceFirst(RegExp(r'^v'), '');
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
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    }
  }

  Future<void> refresh() async {
    if (polling || !mounted) return;
    polling = true;
    try {
      final snapshot = _map(await get('/snow/download/status'));
      if (!mounted) return;
      final next = _map(snapshot['job']);
      final check = _map(snapshot['check']);
      final nextRelease = _map(check['release']);
      if (jsonEncode(next) != jsonEncode(job) ||
          jsonEncode(nextRelease) != jsonEncode(release)) {
        setState(() {
          job = next;
          release = nextRelease;
          compatibility = _map(snapshot['compatibility']);
        });
      }
      await notifyInstalled(next);
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

  Future<void> begin(bool install) async {
    final result = _map(
      await post(install ? '/snow/install' : '/snow/download/start', {
        'channel': channel,
        if (install) 'directory': directory.text.trim(),
        if (release['tag'] != null) 'expectedTag': release['tag'],
      }),
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
  @override
  Widget build(BuildContext context) {
    final received = job['received'] is num ? job['received'] as num : 0;
    final total = job['total'] is num ? job['total'] as num : 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('获取与安装', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(
          '点击安装后获取官方 v$targetVersion Windows 完整包并校验，默认安装到程序根目录的 Snowluma。组件启动与 QQ 登录由你操作。',
        ),
        const SizedBox(height: 12),
        Text('固定适配版本：SnowLuma $targetVersion'),
        if (component['available'] == true)
          Text('已安装 SL：${component['installedVersion'] ?? '版本未知'}'),
        if (component['updateAvailable'] == true)
          const Text('已有 SL 版本低于本版 QQAF 的适配目标，可点击更新。'),
        if (component['newerInstalled'] == true)
          const Text('已安装的 SL 高于当前适配目标；不会自动降级。'),
        const SizedBox(height: 12),
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
            OutlinedButton(
              onPressed: busy || active
                  ? null
                  : () => unawaited(
                      run(() async {
                        final data = _map(
                          await post('/snow/releases', {'channel': channel}),
                        );
                        if (mounted) {
                          setState(() {
                            release = _map(data['release']);
                            compatibility = _map(data['compatibility']);
                          });
                        }
                      }),
                    ),
              child: const Text('获取版本信息'),
            ),
            FilledButton(
              onPressed: busy || active
                  ? null
                  : () => unawaited(run(() => begin(true))),
              child: Text(
                component['updateAvailable'] == true
                    ? '更新 SnowLuma 至 $targetVersion'
                    : '安装 SnowLuma',
              ),
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
        if (release.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(
            '${release['tag']} · ${size(release['bytes'])} · ${release['compatibility'] == 'validated' ? '已适配' : '当前适配目标 · QQ 接入待验收'}',
          ),
          TextButton(
            onPressed: () => unawaited(
              run(() => DesktopBridge.openUrl('${release['url']}')),
            ),
            child: const Text('查看官方版本说明'),
          ),
        ],
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
