import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_style.dart';
import 'core_client.dart';
import 'desktop_bridge.dart';

typedef MapData = Map<String, dynamic>;
MapData asMap(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : {};
List<MapData> asRows(dynamic value) =>
    value is List ? value.map(asMap).toList() : [];
String number(num n) => n >= 1000000
    ? '${(n / 1000000).toStringAsFixed(2)}M'
    : n >= 1000
    ? '${(n / 1000).toStringAsFixed(1)}k'
    : '$n';
String stamp(dynamic value) => value is num
    ? DateTime.fromMillisecondsSinceEpoch(value.toInt() * 1000)
          .toLocal()
          .toString()
          .split('.')
          .first
    : '';

class SurfacePanel extends StatelessWidget {
  const SurfacePanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: Theme.of(context).cardColor,
      border: Border.all(color: Theme.of(context).dividerColor),
      borderRadius: BorderRadius.circular(
        Theme.of(context).extension<SkinStyle>()?.minecraft == true ? 0 : 10,
      ),
    ),
    child: child,
  );
}

class SplitWorkspace extends StatelessWidget {
  const SplitWorkspace({
    super.key,
    required this.directory,
    required this.detail,
    this.width = 280,
  });
  final Widget directory, detail;
  final double width;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      if (box.maxWidth < 660) {
        return Column(
          children: [
            SizedBox(height: 170, child: directory),
            const Divider(height: 1),
            Expanded(child: detail),
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(width: width, child: directory),
          const VerticalDivider(width: 1),
          Expanded(child: detail),
        ],
      );
    },
  );
}

class UsageWorkspace extends StatefulWidget {
  const UsageWorkspace({
    super.key,
    required this.core,
    required this.account,
    required this.dashboard,
    required this.navigate,
  });
  final CoreApi core;
  final String? account;
  final bool dashboard;
  final ValueChanged<int> navigate;
  @override
  State<UsageWorkspace> createState() => _UsageWorkspaceState();
}

class _UsageWorkspaceState extends State<UsageWorkspace> {
  MapData usage = {}, stats = {};
  List<MapData> runs = [];
  String error = '', metric = 'cost';
  int days = 7, generation = 0;
  bool loading = true;
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  Future<void> load() async {
    final current = ++generation;
    if (widget.account == null) {
      setState(() => loading = false);
      return;
    }
    setState(() {
      loading = true;
      error = '';
    });
    try {
      final now = DateTime.now();
      final since = days == 0
          ? 0
          : (days == 1
                        ? DateTime(now.year, now.month, now.day)
                        : now.subtract(Duration(days: days)))
                    .millisecondsSinceEpoch ~/
                1000;
      final values = await Future.wait([
        widget.core.request(
          '/usage',
          query: {'account': widget.account!, 'since': '$since'},
        ),
        widget.core.request('/stats', query: {'account': widget.account!}),
        widget.core.request('/runs', query: {'account': widget.account!}),
      ]);
      if (!mounted || generation != current) return;
      setState(() {
        usage = asMap(values[0]);
        stats = asMap(values[1]);
        runs = asRows(values[2]);
      });
    } catch (e) {
      if (mounted && generation == current) setState(() => error = '$e');
    } finally {
      if (mounted && generation == current) setState(() => loading = false);
    }
  }

  num total(String key) =>
      asRows(usage['models']).fold<num>(0, (a, b) => a + (b[key] as num? ?? 0));
  Widget card(String title, String value, String note, int route) => InkWell(
    onTap: () => widget.navigate(route),
    borderRadius: BorderRadius.circular(10),
    child: SurfacePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(color: Theme.of(context).hintColor, fontSize: 12),
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            note,
            style: TextStyle(color: Theme.of(context).hintColor, fontSize: 11),
          ),
        ],
      ),
    ),
  );
  Widget table(String title, List<MapData> items, String field) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      SurfacePanel(
        padding: EdgeInsets.zero,
        child: items.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Text('所选时间内没有模型调用记录。'),
              )
            : LayoutBuilder(
                builder: (context, box) => SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(minWidth: box.maxWidth),
                    child: DataTable(
                      headingRowHeight: 36,
                      dataRowMinHeight: 36,
                      dataRowMaxHeight: 44,
                      horizontalMargin: 12,
                      columnSpacing: 24,
                      columns: [
                        DataColumn(label: Text(field == 'date' ? '日期' : '模型')),
                        const DataColumn(label: Text('调用'), numeric: true),
                        const DataColumn(
                          label: Text('输入 Token'),
                          numeric: true,
                        ),
                        const DataColumn(
                          label: Text('输出 Token'),
                          numeric: true,
                        ),
                        const DataColumn(label: Text('成本 / 元'), numeric: true),
                      ],
                      rows: items
                          .map(
                            (r) => DataRow(
                              cells: [
                                DataCell(
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      if (field == 'model') ...[
                                        ModelLogo('${r[field]}'),
                                        const SizedBox(width: 8),
                                      ],
                                      Text('${r[field]}'),
                                    ],
                                  ),
                                ),
                                DataCell(Text('${r['calls'] ?? 0}')),
                                DataCell(Text(number(r['input'] as num? ?? 0))),
                                DataCell(
                                  Text(number(r['output'] as num? ?? 0)),
                                ),
                                DataCell(
                                  Text(
                                    (r['cost'] as num? ?? 0).toStringAsFixed(4),
                                  ),
                                ),
                              ],
                            ),
                          )
                          .toList(),
                    ),
                  ),
                ),
              ),
      ),
      const SizedBox(height: 24),
    ],
  );
  @override
  Widget build(BuildContext context) {
    final daily = asRows(usage['days']).reversed.toList();
    final models = asRows(usage['models']);
    return ListView(
      key: const ValueKey('usage-scroll'),
      padding: const EdgeInsets.all(24),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                widget.dashboard ? '仪表盘' : '用量与成本',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            for (final day in [1, 7, 30, 0])
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: TextButton(
                  style: TextButton.styleFrom(
                    backgroundColor: days == day
                        ? Theme.of(context).colorScheme.primary
                              .withValues(alpha: .12)
                        : null,
                  ),
                  onPressed: loading
                      ? null
                      : () {
                          days = day;
                          unawaited(load());
                        },
                  child: Text(
                    day == 1
                        ? '今天'
                        : day == 0
                        ? '全部'
                        : '近 $day 天',
                  ),
                ),
              ),
            IconButton(
              tooltip: '刷新用量',
              onPressed: loading ? null : load,
              icon: const Icon(Icons.refresh, size: 18),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          '模型调用的实际记录与估算成本；${days == 0 ? '全部时间' : '当前时间范围'}。',
          style: TextStyle(color: Theme.of(context).hintColor),
        ),
        if (widget.account == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text('请在账号页面创建或选择账号。'),
          ),
        if (error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: SelectableText(error),
          ),
        if (loading) const LinearProgressIndicator(minHeight: 2),
        const SizedBox(height: 20),
        LayoutBuilder(
          builder: (context, box) {
            final count = box.maxWidth >= 1050
                ? 6
                : box.maxWidth >= 760
                ? 3
                : 2;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final entry in <(String, String, String, int)>[
                  ('估算成本', '¥${total('cost').toStringAsFixed(2)}', '所选区间合计', 7),
                  ('调用次数', '${total('calls')}', '成功返回的计费请求', 7),
                  ('输入 Token', number(total('input')), '所选区间', 7),
                  ('输出 Token', number(total('output')), '所选区间', 7),
                  ('会话运行', '${runs.length}', '最近最多 200 条', 1),
                  ('存档消息', '${stats['messages'] ?? 0}', '当前账号全部消息', 6),
                ])
                  SizedBox(
                    width: (box.maxWidth - (count - 1) * 12) / count,
                    child: card(entry.$1, entry.$2, entry.$3, entry.$4),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 20),
        LayoutBuilder(
          builder: (context, box) {
            final chart = SurfacePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          '用量趋势',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                      for (final entry in {
                        'cost': '成本',
                        'calls': '调用次数',
                        'input': '输入 Token',
                      }.entries)
                        TextButton(
                          onPressed: () => setState(() => metric = entry.key),
                          child: Text(
                            entry.value,
                            style: TextStyle(
                              fontWeight: metric == entry.key
                                  ? FontWeight.w700
                                  : FontWeight.normal,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 205,
                    child: daily.isEmpty
                        ? const Center(child: Text('暂无趋势数据'))
                        : UsageChart(rows: daily, metric: metric),
                  ),
                ],
              ),
            );
            final donut = SurfacePanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '模型成本占比',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 12),
                  if (models.isEmpty || total('cost') <= 0)
                    const SizedBox(
                      height: 205,
                      child: Center(child: Text('暂无计费记录')),
                    )
                  else
                    Row(
                      children: [
                        SizedBox(
                          width: 130,
                          height: 190,
                          child: CustomPaint(painter: DonutPainter(models)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (
                                var i = 0;
                                i < math.min(models.length, 6);
                                i++
                              )
                                Padding(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 5,
                                  ),
                                  child: Row(
                                    children: [
                                      Container(
                                        width: 8,
                                        height: 8,
                                        color:
                                            graphColors[i % graphColors.length],
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          '${models[i]['model']}',
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      Text(
                                        ' ${(100 * (models[i]['cost'] as num) / total('cost')).toStringAsFixed(1)}%',
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            );
            return box.maxWidth >= 900
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(flex: 2, child: chart),
                      const SizedBox(width: 16),
                      Expanded(child: donut),
                    ],
                  )
                : Column(children: [chart, const SizedBox(height: 16), donut]);
          },
        ),
        const SizedBox(height: 24),
        if (!widget.dashboard) ...[
          table('按天', asRows(usage['days']), 'date'),
          table('按模型', models, 'model'),
        ] else
          SurfacePanel(
            child: Row(
              children: [
                const Icon(Icons.info_outline, size: 18),
                const SizedBox(width: 10),
                const Expanded(child: Text('当前为架构迁移实验版；完整功能验收仍在进行。')),
                TextButton(
                  onPressed: () => widget.navigate(2),
                  child: const Text('配置 API 与搜索'),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

const graphColors = [
  Color(0xff4176e6),
  Color(0xff218c72),
  Color(0xff8053c8),
  Color(0xffd47d27),
  Color(0xffd15a76),
  Color(0xff23b4bf),
];

class UsageChart extends StatefulWidget {
  const UsageChart({super.key, required this.rows, required this.metric});
  final List<MapData> rows;
  final String metric;
  @override
  State<UsageChart> createState() => _UsageChartState();
}

class _UsageChartState extends State<UsageChart> {
  int? hovered;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) => MouseRegion(
      onExit: (_) => setState(() => hovered = null),
      onHover: (event) => setState(
        () => hovered =
            ((event.localPosition.dx - 44) /
                    math.max(1, box.maxWidth - 60) *
                    (widget.rows.length - 1))
                .round()
                .clamp(0, widget.rows.length - 1),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 24,
            child: Align(
              alignment: Alignment.centerRight,
              child: Text(
                hovered == null
                    ? ''
                    : '${widget.rows[hovered!]['date']} · ${widget.rows[hovered!][widget.metric]}',
                style: const TextStyle(fontSize: 11),
              ),
            ),
          ),
          Expanded(
            child: CustomPaint(
              size: Size.infinite,
              painter: LinePainter(
                widget.rows,
                widget.metric,
                Theme.of(context).colorScheme.primary,
                Theme.of(context).hintColor,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class LinePainter extends CustomPainter {
  LinePainter(this.rows, this.metric, this.color, this.labelColor);
  final List<MapData> rows;
  final String metric;
  final Color color, labelColor;
  @override
  void paint(Canvas canvas, Size size) {
    final values = rows
        .map((r) => (r[metric] as num? ?? 0).toDouble())
        .toList();
    final max = math.max(1.0, values.fold<double>(0, math.max));
    final width = math.max(1.0, size.width - 60),
        height = math.max(1.0, size.height - 26);
    final p = Paint()
      ..color = labelColor.withValues(alpha: .18)
      ..strokeWidth = 1;
    void label(String text, Offset at) {
      final t = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(fontSize: 10, color: labelColor),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      t.paint(canvas, at);
    }

    for (var i = 0; i <= 4; i++) {
      final y = height * i / 4;
      canvas.drawLine(Offset(44, y), Offset(size.width - 16, y), p);
      label(number(max * (4 - i) / 4), Offset(0, y));
    }
    final points = [
      for (var i = 0; i < values.length; i++)
        Offset(
          44 + width * i / math.max(1, values.length - 1),
          height * (1 - values[i] / max),
        ),
    ];
    final line = Path()..moveTo(points.first.dx, points.first.dy);
    for (final point in points.skip(1)) {
      line.lineTo(point.dx, point.dy);
    }
    final area = Path.from(line)
      ..lineTo(points.last.dx, height)
      ..lineTo(points.first.dx, height)
      ..close();
    canvas.drawPath(area, Paint()..color = color.withValues(alpha: .12));
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke,
    );
    for (final point in points) {
      canvas.drawCircle(point, 3, Paint()..color = color);
    }
    label('${rows.first['date']}', Offset(44, height + 8));
    if (rows.length > 1) {
      label(
        '${rows.last['date']}',
        Offset(math.max(44, size.width - 88), height + 8),
      );
    }
  }

  @override
  bool shouldRepaint(LinePainter old) =>
      old.rows != rows || old.metric != metric || old.color != color;
}

class DonutPainter extends CustomPainter {
  DonutPainter(this.rows);
  final List<MapData> rows;
  @override
  void paint(Canvas canvas, Size size) {
    final sum = rows.fold<double>(
      0,
      (a, r) => a + (r['cost'] as num? ?? 0).toDouble(),
    );
    var start = -math.pi / 2;
    for (var i = 0; i < rows.length; i++) {
      final sweep =
          (rows[i]['cost'] as num? ?? 0).toDouble() / sum * math.pi * 2;
      canvas.drawArc(
        Rect.fromCenter(
          center: size.center(Offset.zero),
          width: 106,
          height: 106,
        ),
        start,
        sweep,
        false,
        Paint()
          ..color = graphColors[i % graphColors.length]
          ..strokeWidth = 17
          ..style = PaintingStyle.stroke,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(DonutPainter old) => old.rows != rows;
}

class SessionWorkspace extends StatefulWidget {
  const SessionWorkspace({
    super.key,
    required this.core,
    required this.account,
    required this.connected,
  });
  final CoreApi core;
  final String? account;
  final bool connected;
  @override
  State<SessionWorkspace> createState() => _SessionWorkspaceState();
}

class _SessionWorkspaceState extends State<SessionWorkspace> {
  final search = TextEditingController(), message = TextEditingController(), imageUrls = TextEditingController();
  List<MapData> runs = [], messages = [], events = [];
  List<String> chats = [];
  String? chat;
  MapData selectedRun = {};
  String notice = '';
  bool busy = false, structure = false;
  int generation = 0;
  Timer? refresh;

  static String _statusLabel(dynamic s) => switch ('$s') {
    'running'   => '运行中',
    'completed' => '已完成',
    'cancelled' => '已取消',
    'failed'    => '失败',
    _           => '$s',
  };

  static Widget _statusIcon(dynamic s) {
    final (icon, color) = switch ('$s') {
      'running'   => (Icons.sync, Colors.blue),
      'completed' => (Icons.check_circle_outline, Colors.green),
      'cancelled' => (Icons.cancel_outlined, Colors.orange),
      'failed'    => (Icons.error_outline, Colors.red),
      _           => (Icons.chat_bubble_outline, Colors.grey),
    };
    return Icon(icon, size: 16, color: color);
  }

  static const _toolMeta = <String, (IconData, String)>{
    'send_message':        (Icons.send_outlined,         '发送消息'),
    'remember':            (Icons.bookmark_add_outlined,  '保存记忆'),
    'recall_memory':       (Icons.bookmark_outlined,      '读取记忆'),
    'memory_append':       (Icons.person_add_outlined,    '保存印象'),
    'memory_query':        (Icons.manage_search_outlined, '查询记忆'),
    'memory_remove':       (Icons.bookmark_remove_outlined,'删除记忆'),
    'get_recent_messages': (Icons.history_outlined,       '最近消息'),
    'read_messages':       (Icons.search_outlined,        '查找消息'),
    'web_search':          (Icons.public_outlined,        '网络搜索'),
    'web_fetch':           (Icons.link_outlined,          '读取网页'),
    'finish':              (Icons.stop_circle_outlined,   '结束处理'),
    'delegate_agent':      (Icons.smart_toy_outlined,     '委派 Agent'),
    'query_group_member':  (Icons.groups_outlined,        '查询成员'),
    'send_like':           (Icons.thumb_up_outlined,      '发送点赞'),
    'get_group_info':      (Icons.info_outline,           '群信息'),
  };
  @override
  void initState() {
    super.initState();
    unawaited(load());
    refresh = Timer.periodic(const Duration(seconds: 3), (_) {
      unawaited(load());
    });
  }

  @override
  void dispose() {
    refresh?.cancel();
    search.dispose();
    message.dispose();
    imageUrls.dispose();
    super.dispose();
  }

  Future<void> load({bool earlier = false}) async {
    if (widget.account == null) return;
    final current = ++generation;
    final selected = chat;
    final runId = selectedRun['id'];
    try {
      final query = {
        'account': widget.account!,
        'chat': ?selected,
        if (earlier && messages.isNotEmpty) 'before': '${messages.last['id']}',
      };
      final values = await Future.wait([
        widget.core.request('/runs', query: {'account': widget.account!}),
        widget.core.request('/chats', query: {'account': widget.account!}),
        if (selected != null) widget.core.request('/messages', query: query),
        if (runId != null)
          widget.core.request(
            '/runs/events',
            query: {'account': widget.account!, 'run_id': '$runId'},
          ),
      ]);
      if (!mounted || current != generation) return;
      setState(() {
        runs = asRows(values[0]);
        chats = List<String>.from(values[1] as List);
        if (runId != null) {
          events = asRows(values[selected == null ? 2 : 3]);
          selectedRun =
              runs.where((r) => r['id'] == runId).firstOrNull ?? selectedRun;
        }
        if (selected != null) {
          final rows = asRows(values[2]);
          if (earlier) {
            final ids = messages.map((r) => r['id']).toSet();
            messages.addAll(rows.where((r) => !ids.contains(r['id'])));
          } else {
            final ids = rows.map((r) => r['id']).toSet();
            messages = [
              ...rows,
              ...messages.where((r) => !ids.contains(r['id'])),
            ];
          }
        }
      });
    } catch (e) {
      if (mounted && current == generation) setState(() => notice = '$e');
    }
  }

  Future<void> execute(Future<void> Function() action) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => notice = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void select(String id, [MapData? run]) {
    setState(() {
      chat = id;
      selectedRun = run ?? {};
      messages = [];
      events = [];
    });
    unawaited(load());
  }

  List<Widget> _buildEventCards(List<MapData> evts) {
    final rendered = <String>{};
    final widgets = <Widget>[];
    for (int i = 0; i < evts.length; i++) {
      final e = evts[i];
      final kind = e['kind'] as String? ?? '';
      if (kind == 'model_delta') continue;
      if (kind == 'tool_call') {
        final callId = '${e['id'] ?? i}';
        rendered.add(callId);
        final result = evts.firstWhere(
          (r) => r['kind'] == 'tool_result' && '${r['id'] ?? ''}' == callId,
          orElse: () => {},
        );
        if (result.isNotEmpty) rendered.add('result:$callId');
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _ToolEventCard(call: e, result: result.isEmpty ? null : result, meta: _toolMeta),
        ));
      } else if (kind == 'tool_result') {
        final resultId = 'result:${e['id'] ?? ''}';
        if (rendered.contains(resultId)) continue;
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _EventTile(event: e),
        ));
      } else {
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _EventTile(event: e),
        ));
      }
    }
    return widgets;
  }

  Future<void> newChat() async {
    final controller = TextEditingController();
    final id = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('指定群聊或私聊'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'group:群号 或 private:QQ号'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('打开'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (id != null && id.isNotEmpty && mounted) select(id);
  }

  @override
  Widget build(BuildContext context) {
    final term = search.text.toLowerCase();
    final visibleRuns = runs.where(
      (r) => '${r['chat']} ${r['status']}'.toLowerCase().contains(term),
    );
    return SplitWorkspace(
      directory: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                const Expanded(
                  child: Text(
                    '会话',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  tooltip: '刷新会话',
                  onPressed: load,
                  icon: const Icon(Icons.refresh, size: 18),
                ),
                IconButton(
                  tooltip: '指定会话',
                  onPressed: widget.account == null ? null : newChat,
                  icon: const Icon(Icons.add, size: 18),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: TextField(
              controller: search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: '查找会话或运行',
                prefixIcon: Icon(Icons.search, size: 18),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: ListView(
              children: [
                for (final r in visibleRuns)
                  ListTile(
                    dense: true,
                    selected:
                        selectedRun['id'] != null &&
                        selectedRun['id'] == r['id'],
                    title: Text(
                      '${r['chat']}',
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      '${stamp(r['started'])}  ·  ${_statusLabel(r['status'])}'
                      '${(r['tool_calls'] as int? ?? 0) > 0 ? "  ·  ${r['tool_calls']} 工具" : ""}'
                      '${((r['input_tokens'] as int? ?? 0) + (r['output_tokens'] as int? ?? 0)) > 0 ? "  ·  ${(r['input_tokens'] as int? ?? 0) + (r['output_tokens'] as int? ?? 0)} tok" : ""}',
                    ),
                    trailing: _statusIcon(r['status']),
                    onTap: () => select('${r['chat']}', r),
                  ),
                if (chats.isNotEmpty)
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Text('消息会话', style: TextStyle(fontSize: 11)),
                  ),
                for (final id in chats.where(
                  (c) => c.toLowerCase().contains(term),
                ))
                  ListTile(
                    dense: true,
                    selected: chat == id && selectedRun.isEmpty,
                    leading: Icon(
                      id.startsWith('group:')
                          ? Icons.groups_outlined
                          : Icons.person_outline,
                      size: 18,
                    ),
                    title: Text(id, overflow: TextOverflow.ellipsis),
                    onTap: () => select(id),
                  ),
                if (runs.isEmpty && chats.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(20),
                    child: Text('暂无会话。连接 OneBot 后接收消息，或手动指定会话。'),
                  ),
              ],
            ),
          ),
        ],
      ),
      detail: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Run header ──────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        chat ?? '选择会话',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                      ),
                      if (selectedRun.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Row(children: [
                          _statusIcon(selectedRun['status']),
                          const SizedBox(width: 6),
                          Text(
                            _statusLabel(selectedRun['status']),
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            stamp(selectedRun['started']),
                            style: const TextStyle(fontSize: 11),
                          ),
                          if ((selectedRun['finished'] as int?) != null) ...[
                            Text(
                              '  →  ${stamp(selectedRun['finished'])}',
                              style: const TextStyle(fontSize: 11),
                            ),
                          ],
                        ]),
                        if (((selectedRun['input_tokens'] as int? ?? 0) +
                                (selectedRun['output_tokens'] as int? ?? 0)) >
                            0)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(
                              '输入 ${selectedRun['input_tokens']} · 输出 ${selectedRun['output_tokens']} Token'
                              '${(selectedRun['tool_calls'] as int? ?? 0) > 0 ? " · ${selectedRun['tool_calls']} 工具调用" : ""}',
                              style: const TextStyle(fontSize: 11),
                            ),
                          ),
                      ],
                    ],
                  ),
                ),
                // action buttons
                if (selectedRun['status'] == 'running')
                  TextButton.icon(
                    onPressed: () => execute(() async {
                      await widget.core.request('/runs/cancel', body: {
                        'account': widget.account,
                        'run_id': selectedRun['id'],
                      });
                      await load();
                    }),
                    icon: const Icon(Icons.stop_circle_outlined, size: 16),
                    label: const Text('取消'),
                  ),
                if (selectedRun.isNotEmpty &&
                    selectedRun['status'] != 'running')
                  IconButton(
                    tooltip: '删除运行记录',
                    icon: const Icon(Icons.delete_outline, size: 18),
                    onPressed: () async {
                      final confirm = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('删除运行记录'),
                          content: const Text('将永久删除此运行记录及其所有事件，无法恢复。'),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(ctx, false),
                              child: const Text('取消'),
                            ),
                            FilledButton(
                              onPressed: () => Navigator.pop(ctx, true),
                              child: const Text('删除'),
                            ),
                          ],
                        ),
                      );
                      if (confirm == true && mounted) {
                        await execute(() async {
                          await widget.core.request('/runs/delete', body: {
                            'account': widget.account,
                            'run_id': selectedRun['id'],
                          });
                          setState(() {
                            selectedRun = {};
                            events = [];
                          });
                          await load();
                        });
                      }
                    },
                  ),
                TextButton(
                  onPressed: chat == null
                      ? null
                      : () => setState(() => structure = !structure),
                  child: Text(structure ? '正文视图' : '结构视图'),
                ),
              ],
            ),
          ),
          if ('${selectedRun['error'] ?? ''}'.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: SurfacePanel(
                padding: const EdgeInsets.all(10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.error_outline, size: 16,
                        color: Theme.of(context).colorScheme.error),
                    const SizedBox(width: 8),
                    Expanded(
                      child: SelectableText(
                        '${selectedRun['error']}',
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                            fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const Divider(height: 1),
          // ── Detail body ──────────────────────────────────────────────────
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (chat == null)
                  const Padding(
                    padding: EdgeInsets.all(40),
                    child: Text('从左侧选择会话或运行。'),
                  ),
                // Load earlier messages button
                if (chat != null)
                  Center(
                    child: TextButton(
                      onPressed: busy ? null : () => load(earlier: true),
                      child: const Text('读取更早消息'),
                    ),
                  ),
                // ── Run events (structured) ──────────────────────────────
                if (events.isNotEmpty) ...[
                  // Accumulated model text as a single readable panel
                  if (events.any((e) => e['kind'] == 'model_delta'))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SurfacePanel(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              const Icon(Icons.smart_toy_outlined, size: 14),
                              const SizedBox(width: 6),
                              Text('模型输出',
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: Theme.of(context).hintColor)),
                            ]),
                            const SizedBox(height: 8),
                            SelectableText(
                              events
                                  .where((e) => e['kind'] == 'model_delta')
                                  .map((e) => '${e['content']}')
                                  .join(),
                            ),
                          ],
                        ),
                      ),
                    ),
                  // Tool call + result pairs and other events
                  ..._buildEventCards(events),
                  const SizedBox(height: 12),
                ],
                // ── Message history ──────────────────────────────────────
                if (structure)
                  SelectableText(
                    const JsonEncoder.withIndent('  ').convert(messages),
                  )
                else
                  for (final row in messages.reversed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: SurfacePanel(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${row['sender']} · ${stamp(row['timestamp'])}',
                              style: TextStyle(
                                  fontSize: 11,
                                  color: Theme.of(context).hintColor),
                            ),
                            const SizedBox(height: 8),
                            SelectableText('${row['text']}'),
                            if (row['media'] is List)
                              for (final media in row['media'] as List)
                                MediaLink(media: asMap(media)),
                            if (row['reply'] is Map)
                              Text(
                                '引用：${row['reply']['text']}',
                                style: const TextStyle(fontSize: 11),
                              ),
                          ],
                        ),
                      ),
                    ),
              ],
            ),
          ),
          if (notice.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: SelectableText(notice),
            ),
          if (busy) const LinearProgressIndicator(minHeight: 2),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
            child: Column(
              children: [
                TextField(
                  controller: message,
                  onChanged: (_) => setState(() {}),
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(hintText: '输入消息…'),
                ),
                TextField(controller:imageUrls,maxLines:2,decoration:const InputDecoration(hintText:'图片 URL（模型测试用，每行一张，可选）')),
                const SizedBox(height: 8),
                Row(
                  children: [
                    TextButton(
                      onPressed: chat == null || busy
                          ? null
                          : () async {
                              await Clipboard.setData(
                                ClipboardData(
                                  text: messages.reversed
                                      .map(
                                        (r) => '${r['sender']}: ${r['text']}',
                                      )
                                      .join('\n'),
                                ),
                              );
                            },
                      child: const Text('复制消息'),
                    ),
                    const Spacer(),
                    OutlinedButton(
                      onPressed:
                          busy ||
                              widget.account == null ||
                              message.text.trim().isEmpty
                          ? null
                          : () => execute(() async {
                              final result = asMap(
                                await widget.core.request(
                                  '/model/chat',
                                  body: {
                                    'account': widget.account,
                                    'chat': (chat ?? 'scratch').replaceFirst(
                                      RegExp(r'^model:'),
                                      '',
                                    ),
                                    'text': message.text,
                    'images': imageUrls.text.split('\n').map((s)=>s.trim()).where((s)=>s.isNotEmpty).toList(),
                                  },
                                ),
                              );
                              if (mounted) {
                                setState(() {
                                  chat ??= 'scratch';
                                  notice =
                                      '模型返回 · 输入 ${result['input_tokens'] ?? 0} / 输出 ${result['output_tokens'] ?? 0} Token';
                                  message.clear();
                                });
                              }
                              await load();
                            }),
                      child: const Text('模型测试'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: !widget.connected || chat == null || busy
                          ? null
                          : () => execute(() async {
                              if (message.text.trim().isEmpty) return;
                              await widget.core.request(
                                '/onebot/send',
                                body: {
                                  'account': widget.account,
                                  'chat': chat,
                                  'text': message.text,
                                },
                              );
                              message.clear();
                              await load();
                            }),
                      child: const Text('发送到 QQ'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class MemoryWorkspace extends StatefulWidget {
  const MemoryWorkspace({super.key, required this.core, required this.account});
  final CoreApi core;
  final String? account;
  @override
  State<MemoryWorkspace> createState() => _MemoryWorkspaceState();
}

class _MemoryWorkspaceState extends State<MemoryWorkspace> {
  final editor = TextEditingController(), search = TextEditingController();
  List<String> chats = [];
  List<dynamic> notes = [];
  List<MapData> documents = [];
  String kind = 'notes';
  final documentSearch = TextEditingController();
  String target = 'scratch', notice = '';
  bool busy = false;
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  @override
  void dispose() {
    editor.dispose();
    search.dispose();
    documentSearch.dispose();
    super.dispose();
  }

  Future<void> load() async {
    if (widget.account == null) return;
    final selected = target;
    try {
      final values = await Future.wait([
        widget.core.request('/chats', query: {'account': widget.account!}),
        widget.core.request(
          '/memory',
          query: {'account': widget.account!, 'chat': selected},
        ),
        widget.core.request(
          '/memory/documents',
          query: {
            'account': widget.account!,
            'chat': selected,
            'kind': kind == 'notes' ? '' : kind,
            'search': documentSearch.text,
          },
        ),
      ]);
      if (!mounted || selected != target) return;
      setState(() {
        chats = List<String>.from(values[0] as List);
        notes = values[1] as List;
        documents = asRows(values[2]);
      });
    } catch (e) {
      if (mounted) setState(() => notice = '$e');
    }
  }

  Future<void> write(String path, MapData body) async {
    if (busy || widget.account == null) return;
    setState(() => busy = true);
    try {
      await widget.core.request(
        path,
        body: {'account': widget.account!, ...body},
      );
      if (path == '/memory') editor.clear();
      await load();
    } catch (e) {
      if (mounted) setState(() => notice = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> editDocument([MapData? document]) async {
    final name = TextEditingController(text: '${document?['title'] ?? ''}');
    final text = TextEditingController(text: '${document?['content'] ?? ''}');
    final selected = target;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          kind == 'member'
              ? '成员档案'
              : kind == 'summary'
              ? '会话摘要'
              : '记忆文档',
        ),
        content: SizedBox(
          width: 580,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  decoration: InputDecoration(
                    labelText: kind == 'member' ? '成员 QQ / 名称' : '标题',
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: text,
                  minLines: 8,
                  maxLines: 16,
                  decoration: const InputDecoration(
                    labelText: '正文',
                    alignLabelWithHint: true,
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    final title = name.text, content = text.text;
    name.dispose();
    text.dispose();
    if (accepted == true && mounted) {
      await write('/memory/documents', {
        'chat': selected,
        if (document != null) 'id': document['id'],
        'kind': kind,
        'title': title,
        'content': content,
      });
    }
  }

  @override
  Widget build(BuildContext context) => SplitWorkspace(
    directory: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            '记忆',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: TextField(
            controller: search,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(hintText: '查找会话'),
          ),
        ),
        const SizedBox(height: 12),
        Expanded(
          child: ListView(
            children: [
              for (final chat in {
                'scratch',
                ...chats,
              }.where((c) => c.contains(search.text)))
                ListTile(
                  dense: true,
                  selected: target == chat,
                  title: Text(
                    chat == 'scratch' ? '手动测试记忆' : chat,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: () {
                    setState(() {
                      target = chat;
                      notes = [];
                    });
                    unawaited(load());
                  },
                ),
            ],
          ),
        ),
      ],
    ),
    detail: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          target,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        const Text('以下记忆参与该会话的模型上下文。其他会话独立保存。'),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          children: [
            for (final entry in {
              'notes': '长期记忆',
              'document': '文档',
              'member': '成员档案',
              'summary': '会话摘要',
            }.entries)
              ChoiceChip(
                label: Text(entry.value),
                selected: kind == entry.key,
                onSelected: (_) {
                  setState(() => kind = entry.key);
                  unawaited(load());
                },
              ),
          ],
        ),
        if (kind != 'notes') ...[
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: documentSearch,
                  onSubmitted: (_) => load(),
                  decoration: const InputDecoration(hintText: '查找标题或正文'),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(onPressed: load, child: const Text('搜索')),
              FilledButton(
                onPressed: busy || widget.account == null ? null : editDocument,
                child: const Text('新建'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          for (final document in documents)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SurfacePanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${document['title']}',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                        IconButton(
                          tooltip: '编辑文档',
                          onPressed: () => editDocument(document),
                          icon: const Icon(Icons.edit_outlined, size: 18),
                        ),
                        IconButton(
                          tooltip: '删除文档',
                          onPressed: () async {
                            final yes = await showDialog<bool>(
                              context: context,
                              builder: (context) => AlertDialog(
                                title: const Text('删除文档？'),
                                actions: [
                                  TextButton(
                                    onPressed: () =>
                                        Navigator.pop(context, false),
                                    child: const Text('取消'),
                                  ),
                                  FilledButton(
                                    onPressed: () =>
                                        Navigator.pop(context, true),
                                    child: const Text('删除'),
                                  ),
                                ],
                              ),
                            );
                            if (yes == true) {
                              await write('/memory/documents/delete', {
                                'chat': target,
                                'id': document['id'],
                                'confirmed': true,
                              });
                            }
                          },
                          icon: const Icon(Icons.delete_outline, size: 18),
                        ),
                      ],
                    ),
                    SelectableText('${document['content']}'),
                  ],
                ),
              ),
            ),
          if (documents.isEmpty) const Text('此分类暂无内容。'),
          if (notice.isNotEmpty) SelectableText(notice),
        ],
        if (kind == 'notes') ...[
          const SizedBox(height: 20),
          TextField(
            controller: editor,
            minLines: 4,
            maxLines: 10,
            decoration: const InputDecoration(labelText: '新增记忆'),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: busy || widget.account == null
                  ? null
                  : () {
                      if (editor.text.trim().isNotEmpty) {
                        unawaited(
                          write('/memory', {
                            'chat': target,
                            'text': editor.text,
                          }),
                        );
                      }
                    },
              child: const Text('保存记忆'),
            ),
          ),
          if (busy) const LinearProgressIndicator(minHeight: 2),
          if (notice.isNotEmpty) SelectableText(notice),
          const SizedBox(height: 20),
          for (final row in notes)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: SurfacePanel(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: SelectableText('${row[1]}')),
                    IconButton(
                      tooltip: '删除记忆',
                      icon: const Icon(Icons.delete_outline, size: 18),
                      onPressed: busy
                          ? null
                          : () async {
                              final yes = await showDialog<bool>(
                                context: context,
                                builder: (context) => AlertDialog(
                                  title: const Text('删除记忆？'),
                                  content: const Text('删除后该条内容将不再参与上下文。'),
                                  actions: [
                                    TextButton(
                                      onPressed: () =>
                                          Navigator.pop(context, false),
                                      child: const Text('取消'),
                                    ),
                                    FilledButton(
                                      onPressed: () =>
                                          Navigator.pop(context, true),
                                      child: const Text('删除'),
                                    ),
                                  ],
                                ),
                              );
                              if (yes == true) {
                                await write('/memory/delete', {'id': row[0]});
                              }
                            },
                    ),
                  ],
                ),
              ),
            ),
          if (notes.isEmpty) const Text('该会话暂无记忆。'),
        ],
      ],
    ),
  );
}

class FoldPanel extends StatelessWidget {
  const FoldPanel({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.children,
    this.initiallyExpanded = false,
  });
  final String title, subtitle;
  final IconData icon;
  final List<Widget> children;
  final bool initiallyExpanded;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: SurfacePanel(
      padding: EdgeInsets.zero,
      child: ExpansionTile(
        key: PageStorageKey(title),
        initiallyExpanded: initiallyExpanded,
        maintainState: true,
        leading: Icon(icon, size: 22),
        title: Text(
          title,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          subtitle,
          style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor),
        ),
        shape: const Border(),
        collapsedShape: const Border(),
        childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
        children: children,
      ),
    ),
  );
}

class ArchiveWorkspace extends StatefulWidget {
  const ArchiveWorkspace({
    super.key,
    required this.core,
    required this.account,
  });
  final CoreApi core;
  final String? account;
  @override
  State<ArchiveWorkspace> createState() => _ArchiveWorkspaceState();
}

class _ArchiveWorkspaceState extends State<ArchiveWorkspace> {
  final search = TextEditingController();
  List<String> chats = [];
  List<MapData> rows = [];
  MapData? selected;
  String target = '', notice = '';
  bool busy = false;
  int generation = 0;
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> load({bool earlier = false}) async {
    if (widget.account == null) return;
    final current = ++generation;
    setState(() => busy = true);
    try {
      final values = await Future.wait([
        widget.core.request('/chats', query: {'account': widget.account!}),
        widget.core.request(
          '/archive',
          query: {
            'account': widget.account!,
            'chat': target,
            'search': search.text,
            if (earlier && rows.isNotEmpty) 'before': '${rows.last['id']}',
          },
        ),
      ]);
      if (!mounted || generation != current) return;
      setState(() {
        chats = List<String>.from(values[0] as List);
        final next = asRows(values[1]);
        if (earlier) {
          final ids = rows.map((r) => r['id']).toSet();
          rows.addAll(next.where((r) => !ids.contains(r['id'])));
        } else {
          rows = next;
          selected = null;
        }
      });
    } catch (e) {
      if (mounted && current == generation) setState(() => notice = '$e');
    } finally {
      if (mounted && current == generation) setState(() => busy = false);
    }
  }

  Future<void> import() async {
    final path = TextEditingController();
    final file = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('迁入官方格式消息副本'),
        content: SizedBox(
          width: 460,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('仅导入官方格式 JSON 消息副本；不是整个旧库迁移。原文件保留，请先备份。'),
              const SizedBox(height: 16),
              TextField(
                controller: path,
                decoration: const InputDecoration(labelText: 'JSON 文件路径'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, path.text.trim()),
            child: const Text('确认迁入'),
          ),
        ],
      ),
    );
    path.dispose();
    if (file == null || file.isEmpty || widget.account == null) return;
    setState(() => busy = true);
    try {
      final result = asMap(
        await widget.core.request(
          '/migration/official-messages',
          body: {'account': widget.account!, 'path': file, 'confirmed': true},
        ),
      );
      if (mounted) {
        setState(() => notice = '已迁入 ${result['importedMessages']} 条消息。');
      }
      await load();
    } catch (e) {
      if (mounted) {
        setState(() {
          notice = '$e';
          busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => SplitWorkspace(
    directory: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            '存档',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
        ),
        Expanded(
          child: ListView(
            children: [
              for (final id in ['', ...chats])
                ListTile(
                  selected: target == id,
                  dense: true,
                  leading: Icon(
                    id.isEmpty
                        ? Icons.all_inbox_outlined
                        : id.startsWith('group:')
                        ? Icons.groups_outlined
                        : Icons.person_outline,
                    size: 18,
                  ),
                  title: Text(
                    id.isEmpty ? '全部会话' : id,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: busy
                      ? null
                      : () {
                          setState(() => target = id);
                          unawaited(load());
                        },
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(12),
          child: OutlinedButton(
            onPressed: busy || widget.account == null ? null : import,
            child: const Text('迁入消息副本'),
          ),
        ),
      ],
    ),
    detail: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: search,
                  onSubmitted: (_) => load(),
                  decoration: const InputDecoration(
                    hintText: '搜索消息正文',
                    prefixIcon: Icon(Icons.search, size: 18),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: busy ? null : load,
                child: const Text('搜索'),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: '复制已加载消息',
                onPressed: rows.isEmpty
                    ? null
                    : () => Clipboard.setData(
                        ClipboardData(
                          text: rows.reversed
                              .map(
                                (r) =>
                                    '${stamp(r['timestamp'])} ${r['sender']}: ${r['text']}',
                              )
                              .join('\n'),
                        ),
                      ),
                icon: const Icon(Icons.copy, size: 18),
              ),
            ],
          ),
        ),
        if (busy) const LinearProgressIndicator(minHeight: 2),
        if (notice.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: SelectableText(notice),
          ),
        Expanded(
          child: selected != null
              ? ListView(
                  padding: const EdgeInsets.all(24),
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => setState(() => selected = null),
                        icon: const Icon(Icons.arrow_back, size: 16),
                        label: const Text('返回消息列表'),
                      ),
                    ),
                    Text(
                      '${selected!['chat']} · ${selected!['sender']} · ${stamp(selected!['timestamp'])}',
                      style: TextStyle(color: Theme.of(context).hintColor),
                    ),
                    const SizedBox(height: 18),
                    SelectableText('${selected!['text']}'),
                  ],
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  itemCount: rows.length + 1,
                  itemBuilder: (context, i) {
                    if (i == rows.length) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Center(
                          child: TextButton(
                            onPressed: busy || rows.isEmpty
                                ? null
                                : () => load(earlier: true),
                            child: Text(rows.isEmpty ? '暂无消息' : '读取更早消息'),
                          ),
                        ),
                      );
                    }
                    final row = rows[i];
                    return Column(
                      children: [
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            '${row['text']}',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            '${row['chat']} · ${row['sender']} · ${stamp(row['timestamp'])}',
                            style: const TextStyle(fontSize: 11),
                          ),
                          trailing: const Icon(Icons.chevron_right, size: 18),
                          onTap: () => setState(() => selected = row),
                        ),
                        const Divider(height: 1),
                      ],
                    );
                  },
                ),
        ),
        if (target.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: busy
                    ? null
                    : () async {
                        final yes = await showDialog<bool>(
                          context: context,
                          builder: (context) => AlertDialog(
                            title: const Text('清理会话存档？'),
                            content: Text('删除 $target 的本地消息。此操作不可撤销。'),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(context, false),
                                child: const Text('取消'),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.pop(context, true),
                                child: const Text('删除'),
                              ),
                            ],
                          ),
                        );
                        if (yes != true || widget.account == null || !mounted) {
                          return;
                        }
                        try {
                          await widget.core.request(
                            '/archive/delete',
                            body: {
                              'account': widget.account,
                              'chat': target,
                              'confirmed': true,
                            },
                          );
                          await load();
                        } catch (e) {
                          if (mounted) setState(() => notice = '$e');
                        }
                      },
                child: const Text('清理当前会话'),
              ),
            ),
          ),
      ],
    ),
  );
}

class AccountWorkspace extends StatefulWidget {
  const AccountWorkspace({
    super.key,
    required this.core,
    required this.current,
    required this.select,
  });
  final CoreApi core;
  final String? current;
  final ValueChanged<String> select;
  @override
  State<AccountWorkspace> createState() => _AccountWorkspaceState();
}

class _AccountWorkspaceState extends State<AccountWorkspace> {
  List<String> accounts = [], connected = [];
  final Map<String, MapData> configs = {}, stats = {};
  String notice = '';
  bool busy = false;
  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  Future<void> load() async {
    setState(() => busy = true);
    try {
      final ids = List<String>.from(
        await widget.core.request('/accounts') as List,
      );
      final status = asMap(await widget.core.request('/status'));
      final info = await Future.wait(
        ids.map(
          (id) async => (
            id,
            asMap(await widget.core.request('/config', query: {'account': id})),
            asMap(await widget.core.request('/stats', query: {'account': id})),
          ),
        ),
      );
      if (!mounted) return;
      setState(() {
        accounts = ids;
        connected = List<String>.from(
          status['connected_accounts'] as List? ?? [],
        );
        for (final item in info) {
          configs[item.$1] = item.$2;
          stats[item.$1] = item.$3;
        }
      });
    } catch (e) {
      if (mounted) setState(() => notice = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> create() async {
    final qq = TextEditingController();
    final id = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('创建账号'),
        content: TextField(
          controller: qq,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'QQ 账号'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, qq.text.trim()),
            child: const Text('创建'),
          ),
        ],
      ),
    );
    qq.dispose();
    if (id == null || id.isEmpty) return;
    try {
      await widget.core.request('/accounts', body: {'account': id});
      await load();
      if (mounted) widget.select(id);
    } catch (e) {
      if (mounted) setState(() => notice = '$e');
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Row(
        children: [
          const Expanded(
            child: Text(
              '多账号',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
          ),
          OutlinedButton(
            onPressed: busy ? null : create,
            child: const Text('创建账号'),
          ),
          IconButton(
            tooltip: '刷新账号',
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh, size: 18),
          ),
        ],
      ),
      const SizedBox(height: 8),
      const Text('每个账号独立保存连接、消息、记忆、模型和用量。'),
      const SizedBox(height: 20),
      if (busy) const LinearProgressIndicator(minHeight: 2),
      if (notice.isNotEmpty) SelectableText(notice),
      if (accounts.isEmpty && !busy)
        const SurfacePanel(child: Text('尚未创建账号。创建后在 OneBot 设置连接用户自带的 QQ 客户端。')),
      LayoutBuilder(
        builder: (context, box) => Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            for (final id in accounts)
              SizedBox(
                width: box.maxWidth >= 780
                    ? (box.maxWidth - 16) / 2
                    : box.maxWidth,
                child: SurfacePanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.person_outline, size: 24),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              id,
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (widget.current == id)
                            const Text('当前', style: TextStyle(fontSize: 11)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Icon(
                            Icons.circle,
                            size: 8,
                            color: connected.contains(id)
                                ? Colors.green
                                : Colors.grey,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            connected.contains(id)
                                ? 'OneBot 已连接'
                                : 'OneBot 未连接',
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          ModelLogo(
                            '${asMap(configs[id]?['api'])['model'] ?? ''}',
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${asMap(configs[id]?['api'])['model'] ?? '未配置模型'}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '消息 ${stats[id]?['messages'] ?? 0} · 调用 ${stats[id]?['calls'] ?? 0} · ¥${(stats[id]?['estimated_cost'] as num? ?? 0).toStringAsFixed(2)}',
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton(
                        onPressed: widget.current == id
                            ? null
                            : () => widget.select(id),
                        child: const Text('切换账号'),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    ],
  );
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event});
  final MapData event;

  static const _kindLabel = <String, String>{
    'run_start':    '运行开始',
    'run_end':      '运行结束',
    'tool_call':    '工具调用',
    'tool_result':  '工具结果',
    'model_delta':  '模型输出',
    'send':         '已发送',
    'error':        '错误',
    'cancelled':    '已取消',
  };

  @override
  Widget build(BuildContext context) {
    final kind = '${event['kind'] ?? ''}';
    final label = _kindLabel[kind] ?? kind;
    return SurfacePanel(
      padding: const EdgeInsets.all(10),
      child: ExpansionTile(
        dense: true,
        title: Text(label, style: const TextStyle(fontSize: 12)),
        subtitle: Text(stamp(event['timestamp']), style: const TextStyle(fontSize: 10)),
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: SelectableText('${event['content'] ?? ''}'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolEventCard extends StatelessWidget {
  const _ToolEventCard({required this.call, required this.meta, this.result});
  final MapData call;
  final MapData? result;
  final Map<String, (IconData, String)> meta;

  @override
  Widget build(BuildContext context) {
    final name = '${call['content'] ?? ''}';
    // content is the raw tool name or JSON; try to extract name from JSON
    String toolName = name;
    String argsText = '';
    try {
      final decoded = jsonDecode(name) as Map<String, dynamic>;
      toolName = '${decoded['name'] ?? name}';
      final args = decoded['arguments'];
      if (args != null) {
        argsText = args is String ? args : jsonEncode(args);
      }
    } catch (_) {}

    final (icon, label) = meta[toolName] ?? (Icons.build_outlined, toolName);
    final hasResult = result != null && result!.isNotEmpty;
    final resultText = '${result?['content'] ?? ''}';
    final isError = resultText.contains('"error"') || resultText.startsWith('{"error"');
    final colorScheme = Theme.of(context).colorScheme;

    return SurfacePanel(
      padding: EdgeInsets.zero,
      child: ExpansionTile(
        leading: Icon(icon, size: 16, color: colorScheme.primary),
        title: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        subtitle: Text(
          stamp(call['timestamp']),
          style: const TextStyle(fontSize: 10),
        ),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          if (hasResult)
            Icon(
              isError ? Icons.cancel_outlined : Icons.check_circle_outline,
              size: 14,
              color: isError ? colorScheme.error : Colors.green,
            ),
          const Icon(Icons.expand_more, size: 18),
        ]),
        children: [
          if (argsText.isNotEmpty)
            _Section(label: '参数', text: argsText),
          if (hasResult)
            _Section(label: isError ? '错误' : '结果', text: resultText, error: isError),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.label, required this.text, this.error = false});
  final String label, text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(
          fontSize: 10,
          color: error
              ? Theme.of(context).colorScheme.error
              : Theme.of(context).hintColor,
        )),
        const SizedBox(height: 4),
        SelectableText(text, style: const TextStyle(fontSize: 12)),
      ]),
    );
  }
}

class MediaLink extends StatelessWidget {
  const MediaLink({super.key,required this.media});
  final MapData media;
  @override Widget build(BuildContext context){
    final value='${media['url'] ?? ''}'.isNotEmpty?'${media['url']}':'${media['file'] ?? ''}';final uri=Uri.tryParse(value);final remote=uri!=null&&['http','https'].contains(uri.scheme)&&uri.host.isNotEmpty&&uri.userInfo.isEmpty;
    return Padding(padding:const EdgeInsets.only(top:6),child:Row(children:[Icon(media['kind']=='image'?Icons.image_outlined:media['kind']=='video'?Icons.videocam_outlined:Icons.attach_file,size:16),const SizedBox(width:6),Expanded(child:Text('${media['kind']} · ${media['summary'] ?? value}',maxLines:2,overflow:TextOverflow.ellipsis)),if(remote)TextButton(onPressed:()=>DesktopBridge.openUrl(value),child:const Text('打开'))]));
  }
}
