import 'package:flutter/material.dart';

import 'app_style.dart';
import 'core_client.dart';
import 'desktop_bridge.dart';

const vendorSources = <String, (String, String)>{
  'deepseek': (
    'DeepSeek',
    'https://api-docs.deepseek.com/quick_start/pricing/',
  ),
  'glm': ('GLM', 'https://docs.bigmodel.cn/cn/guide/start/pricing'),
  'gemini': ('Gemini', 'https://ai.google.dev/gemini-api/docs/pricing'),
  'mimo': ('MiMo', 'https://mimo.mi.com/docs/price/pay-as-you-go'),
  'qwen': ('Qwen', 'https://help.aliyun.com/en/model-studio/model-pricing'),
  'kimi': ('Kimi', 'https://platform.kimi.com/docs/pricing/chat'),
  'minimax': (
    'MiniMax',
    'https://platform.minimax.io/docs/guides/pricing-paygo',
  ),
  'anthropic': (
    'Anthropic',
    'https://platform.claude.com/docs/en/about-claude/pricing',
  ),
  'openai': ('OpenAI', 'https://developers.openai.com/api/docs/pricing'),
  'xai': ('Grok · xAI', 'https://docs.x.ai/developers/pricing'),
};

class PriceCatalogue extends StatefulWidget {
  const PriceCatalogue({super.key, required this.core});
  final CoreApi core;
  @override
  State<PriceCatalogue> createState() => _PriceCatalogueState();
}

class _PriceCatalogueState extends State<PriceCatalogue> {
  Map<String, dynamic> data = {};
  Set<String> vendors = {};
  String search = '', error = '';
  bool busy = true;
  int page = 0;
  @override
  void initState() {
    super.initState();
    load(false);
  }

  Future<void> load(bool refresh) async {
    setState(() => busy = true);
    try {
      final value = await widget.core.request(
        refresh ? '/prices/refresh' : '/prices',
        body: refresh ? {} : null,
      );
      if (mounted) {
        setState(() {
          data = Map<String, dynamic>.from(value as Map);
          error = '';
          page = 0;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    }
    if (mounted) setState(() => busy = false);
  }

  void toggle(String id, bool selected) => setState(() {
    if (selected) {
      vendors.add(id);
    } else {
      vendors.remove(id);
    }
    page = 0;
  });
  @override
  Widget build(BuildContext context) {
    final rows = (data['catalogue'] as List? ?? [])
        .where(
          (r) =>
              (vendors.isEmpty || vendors.contains(r['vendor'])) &&
              '${r['id']}'.toLowerCase().contains(search.toLowerCase()),
        )
        .toList();
    final pages = (rows.length / 30).ceil().clamp(1, 10000);
    return AlertDialog(
      title: const Text('官方模型价格'),
      content: SizedBox(
        width: 780,
        height: 560,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PopupMenuButton<String>(
                  tooltip: '多选厂商',
                  itemBuilder: (_) => [
                    for (final e in vendorSources.entries)
                      PopupMenuItem(
                        value: e.key,
                        child: Row(
                          children: [
                            Checkbox(
                              value: vendors.contains(e.key),
                              onChanged: (v) {
                                toggle(e.key, v!);
                                Navigator.pop(context);
                              },
                            ),
                            Text(e.value.$1),
                          ],
                        ),
                      ),
                  ],
                  onSelected: (id) => toggle(id, !vendors.contains(id)),
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      vendors.isEmpty ? '全部厂商 ▾' : '已选 ${vendors.length} 家 ▾',
                    ),
                  ),
                ),
                Expanded(
                  child: TextField(
                    decoration: const InputDecoration(hintText: '查找模型名称…'),
                    onChanged: (v) => setState(() {
                      search = v;
                      page = 0;
                    }),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final e in vendorSources.entries)
                  FilterChip(
                    label: Text(e.value.$1),
                    selected: vendors.contains(e.key),
                    onSelected: (v) => toggle(e.key, v),
                  ),
              ],
            ),
            Wrap(
              spacing: 8,
              children: [
                for (final e in vendorSources.entries.where(
                  (e) => vendors.isEmpty || vendors.contains(e.key),
                ))
                  TextButton(
                    onPressed: () async {
                      try {
                        await DesktopBridge.openUrl(e.value.$2);
                      } catch (e) {
                        if (mounted) setState(() => error = '$e');
                      }
                    },
                    child: Text('${e.value.$1} ↗'),
                  ),
              ],
            ),
            if (busy) const LinearProgressIndicator(),
            if (error.isNotEmpty) Text(error),
            Expanded(
              child: ListView(
                children: [
                  for (final r in rows.skip(page * 30).take(30))
                    ListTile(
                      leading: ModelLogo('${r['id']}'),
                      title: Text('${r['id']}'),
                      subtitle: Text(
                        '${r['currency']} / 百万 Token · 输入 ${r['in'] ?? '—'} · 输出 ${r['out'] ?? '—'} · 缓存 ${r['cached'] ?? '—'}',
                      ),
                      trailing: Text(
                        r['autoApply'] == true ? '标准 Token 单价' : '条件计费 / 参考',
                      ),
                      onTap: () => showDialog<void>(
                        context: context,
                        builder: (_) => AlertDialog(
                          title: Text('${r['id']}'),
                          content: SelectableText('${r['variants']}'),
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
              ),
            ),
            Text('${rows.length} 个模型 · ${page + 1}/$pages 页'),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: busy ? null : () => load(true),
          child: const Text('拉取价格表'),
        ),
        TextButton(
          onPressed: page == 0 ? null : () => setState(() => page--),
          child: const Text('上一页'),
        ),
        TextButton(
          onPressed: page + 1 >= pages ? null : () => setState(() => page++),
          child: const Text('下一页'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('关闭'),
        ),
      ],
    );
  }
}
