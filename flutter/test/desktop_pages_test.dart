import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qqaf/core_client.dart';
import 'package:qqaf/desktop_pages.dart';
import 'package:qqaf/startup_animation.dart';
import 'package:qqaf/workspace_page.dart';
import 'package:qqaf/app_style.dart';

class PageCore implements CoreApi {
  final calls = <(String, Map<String, String>?, Object?)>[];
  final delayed = Completer<dynamic>();
  bool delayA = false;
  @override
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    calls.add((path, query, body));
    if (body != null) return {'ok': true};
    return switch (path) {
      '/chats' => ['group:10', 'private:20'],
      '/runs' => [
        {
          'id': 'run1',
          'chat': 'group:10',
          'started': 100,
          'status': 'failed',
          'error': 'fixture failure',
        },
      ],
      '/stats' => {'messages': 12},
      '/usage' => {
        'models': [
          {
            'model': 'fixture-model',
            'calls': 2,
            'input': 100,
            'output': 20,
            'cost': 1.25,
          },
        ],
        'days': [
          {
            'date': '2026-10-01',
            'calls': 1,
            'input': 50,
            'output': 10,
            'cost': .5,
          },
          {
            'date': '2026-10-02',
            'calls': 1,
            'input': 50,
            'output': 10,
            'cost': .75,
          },
        ],
      },
      '/archive' => [
        {
          'id': query?['before'] == null ? 2 : 1,
          'chat': 'group:10',
          'sender': 'tester',
          'text': query?['before'] == null ? '最新存档' : '早期存档',
          'timestamp': 100,
        },
      ],
      '/messages' =>
        delayA && query?['chat'] == 'group:10'
            ? await delayed.future
            : [
                {
                  'id': 2,
                  'chat': query?['chat'],
                  'sender': 'tester',
                  'text': '消息 ${query?['chat']}',
                  'timestamp': 100,
                },
              ],
      '/memory' => [
        [1, '已存记忆'],
      ],
      '/config' => {
        'api': {
          'apiByChat': {'byChat': {}},
        },
        'providers': [],
        'store': {
          'contextTier': 3,
          'randomPercent': 17,
          'unifiedTier': true,
          'groupSliderPos': {},
          'groupPeakPos': {},
          'peakSchedule': {
            'enabled': false,
            'peak': {'start': '09:00', 'end': '18:00', 'sliderPos': 10},
            'valley': {'sliderPos': 100},
          },
        },
      },
      '/persona' => {
        'defaults': {
          'roleText': '原始正文',
          'customRules': '原始规则',
          'botName': '测试人设',
          'selfNickname': '',
          'participation': 'medium',
        },
        'value': {},
        'history': [],
      },
      '/persona/templates' => {'builtin': {}, 'custom': []},
      _ => [],
    };
  }

  @override
  Future<void> close() async {}
}

class CompletePageCore extends PageCore {
  @override
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    if (path == '/config' && body == null) {
      final defaults = jsonDecode(
        File('../native/resources/default-config.json').readAsStringSync(),
      ) as Map<String, dynamic>;
      defaults['providers'] = [];
      defaults['runtime'] = {'enabled': false};
      defaults['proxy'] = {'enabled': false, 'url': 'http://127.0.0.1:7890'};
      defaults['personaHistory'] = {'days': 1, 'limit': 5};
      return defaults;
    }
    if (path == '/extensions' || path == '/tools') return [];
    if (path == '/accounts') return ['123'];
    if (path == '/status') return {'connected_accounts': []};
    if (path == '/preferences') return {'theme': 'light', 'skin': 'default'};
    return super.request(path, query: query, body: body);
  }
}

Future<void> window(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1360, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: appTheme(dark: false, minecraft: false, prefs: {}),
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('dashboard and usage use the same cost records and time filter', (
    t,
  ) async {
    final core = PageCore();
    int? selected;
    await window(
      t,
      UsageWorkspace(
        core: core,
        account: '123',
        dashboard: true,
        navigate: (id) => selected = id,
      ),
    );
    expect(find.text('¥1.25'), findsOneWidget);
    await t.tap(find.text('¥1.25'));
    expect(selected, 7);
    await t.tap(find.text('全部'));
    await t.pumpAndSettle();
    expect(core.calls.where((c) => c.$1 == '/usage').last.$2!['since'], '0');
    await t.tap(find.text('输入 Token').last);
    await t.pumpAndSettle();
    expect(t.takeException(), isNull);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets(
    'changing sessions discards a delayed response from the previous chat',
    (t) async {
      final core = PageCore()..delayA = true;
      await window(
        t,
        SessionWorkspace(core: core, account: '123', connected: false),
      );
      await t.tap(find.text('group:10').last);
      await t.pump();
      await t.tap(find.text('private:20').last);
      await t.pumpAndSettle();
      core.delayed.complete([
        {'id': 1, 'sender': 'old', 'text': '过期消息', 'timestamp': 100},
      ]);
      await t.pumpAndSettle();
      expect(find.text('过期消息'), findsNothing);
      expect(find.text('消息 private:20'), findsOneWidget);
      final send = t.widget<FilledButton>(
        find.widgetWithText(FilledButton, '发送到 QQ'),
      );
      expect(send.onPressed, isNull);
      expect(core.calls.any((c) => c.$3 != null), isFalse);
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets('archive pages older messages without duplicate entries', (
    t,
  ) async {
    final core = PageCore();
    await window(t, ArchiveWorkspace(core: core, account: '123'));
    await t.tap(find.text('读取更早消息'));
    await t.pumpAndSettle();
    expect(find.text('最新存档'), findsOneWidget);
    expect(find.text('早期存档'), findsOneWidget);
    await t.tap(find.text('读取更早消息'));
    await t.pumpAndSettle();
    expect(find.text('早期存档'), findsOneWidget);
    await t.tap(find.text('最新存档'));
    await t.pumpAndSettle();
    expect(find.text('返回消息列表'), findsOneWidget);
    expect(t.takeException(), isNull);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets('persona retains unsaved body draft when saving another column', (
    t,
  ) async {
    final core = PageCore();
    await window(t, WorkspacePage(core: core, account: '123', page: 'persona'));
    final body = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.labelText == '角色正文',
    );
    await t.enterText(body, '未保存的正文');
    await t.tap(find.text('附加规则').last);
    await t.pumpAndSettle();
    final rules = find.byWidgetPredicate(
      (w) => w is TextField && w.decoration?.labelText == '附加规则',
    );
    await t.enterText(rules, '新的规则');
    await t.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await t.sendKeyEvent(LogicalKeyboardKey.keyS);
    await t.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await t.pumpAndSettle();
    final save =
        core.calls.lastWhere((c) => c.$1 == '/persona' && c.$3 != null).$3
            as Map;
    expect(save['section'], 'rules');
    await t.tap(find.text('角色正文').last);
    await t.pumpAndSettle();
    expect(t.widget<TextField>(body).controller!.text, '未保存的正文');
    expect(t.takeException(), isNull);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets('collapsed settings hide the slider and preserve its draft', (
    t,
  ) async {
    final core = PageCore();
    await window(
      t,
      SingleChildScrollView(
        child: WorkspacePage(core: core, account: '123', page: 'chat-settings'),
      ),
    );
    expect(find.byType(Slider).hitTestable(), findsNothing);
    await t.tap(find.text('活跃设置'));
    await t.pumpAndSettle();
    expect(find.byType(Slider).hitTestable(), findsOneWidget);
    await t.drag(find.byType(Slider).first, const Offset(80, 0));
    await t.pumpAndSettle();
    final value = t.widget<Slider>(find.byType(Slider).first).value;
    await t.tap(find.text('活跃设置'));
    await t.pumpAndSettle();
    expect(find.byType(Slider).hitTestable(), findsNothing);
    await t.tap(find.text('活跃设置'));
    await t.pumpAndSettle();
    expect(t.widget<Slider>(find.byType(Slider).first).value, value);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets('startup waits for core readiness and survives asset failure', (
    t,
  ) async {
    var complete = 0;
    Widget startup(bool ready) => MaterialApp(
      home: ArcfoxStartup(
        ready: ready,
        status: '真实核心状态',
        complete: () => complete++,
        pictureLoader: (_, _, _) async =>
            throw StateError('fixture unavailable'),
      ),
    );
    await t.pumpWidget(startup(false));
    await t.pump();
    await t.pump(const Duration(seconds: 3));
    expect(complete, 0);
    await t.pumpWidget(startup(true));
    await t.pump();
    await t.pump();
    expect(complete, 1);
    expect(t.takeException(), isNull);
    await t.pumpWidget(const SizedBox());
  });
  testWidgets(
    'every settings and extension page fits a narrow native workspace',
    (t) async {
      final core = CompletePageCore();
      for (final page in [
        'api',
        'whitelist',
        'chat-settings',
        'desktop',
        'personalize',
        'advanced',
        'tools',
        'skills',
        'plugins',
        'snow',
        'markets',
      ]) {
        await window(
          t,
          SingleChildScrollView(
            child: WorkspacePage(
              key: ValueKey(page),
              core: core,
              account: '123',
              page: page,
            ),
          ),
          size: const Size(600, 900),
        );
        expect(t.takeException(), isNull, reason: page);
      }
      await t.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'native account overview renders actual isolated account records',
    (t) async {
      final core = CompletePageCore();
      await window(
        t,
        AccountWorkspace(core: core, current: '123', select: (_) {}),
        size: const Size(650, 800),
      );
      expect(find.text('123'), findsOneWidget);
      expect(find.text('消息 12 · 调用 0 · ¥0.00'), findsOneWidget);
      expect(t.takeException(), isNull);
      await t.pumpWidget(const SizedBox());
    },
  );
}
