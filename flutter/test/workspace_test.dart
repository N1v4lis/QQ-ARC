import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qqaf/core_client.dart';
import 'package:qqaf/app_style.dart';
import 'package:qqaf/workspace_page.dart';

class WorkspaceCore implements CoreApi {
  Map<String, dynamic>? saved;
  @override
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    if (body != null) {
      if (path == '/config') {
        saved = jsonDecode(jsonEncode(body)) as Map<String, dynamic>;
      }
      return {'ok': true};
    }
    if (path == '/chats') return <String>[];
    if (path == '/config') {
      return {
        'api': {
          'provider': 'first',
          'model': 'alpha',
          'fallbackModels': <dynamic>[],
          'modelMediaProfiles': <String, dynamic>{},
          'priceInputPerM': 0,
          'priceOutputPerM': 0,
          'priceCachedPerM': 0,
          'useOfficialPrice': false,
        },
        'providers': [
          {
            'id': 'first',
            'name': 'First',
            'baseUrl': 'https://first.invalid/v1',
            'models': [
              {'id': 'alpha'},
            ],
          },
          {
            'id': 'second',
            'name': 'Second',
            'baseUrl': 'https://second.invalid/v1',
            'models': [
              {'id': 'beta'},
            ],
          },
        ],
        'webSearch': {'enabled': false, 'provider': 'bing'},
      };
    }
    return <dynamic>[];
  }

  @override
  Future<void> close() async {}
}

void main() {
  testWidgets('model media drafts survive model switching and save together', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final core = WorkspaceCore();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WorkspacePage(core: core, account: '123', page: 'api'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final dropdown = find.byWidgetPredicate(
      (w) =>
          w is DropdownButtonFormField<String> &&
          w.decoration.labelText == '选择模型',
    );
    expect(tester.widget<Switch>(find.byType(Switch).first).value, true);
    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();
    await tester.tap(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Second · beta').last);
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, true);
    await tester.tap(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('First · alpha').last);
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, false);
    await tester.tap(find.text('保存模型配置'));
    await tester.pumpAndSettle();
    expect(
      core.saved!['patch']['api']['modelMediaProfiles']['["first","alpha"]']['vision'],
      false,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('empty installation can create its first account', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WorkspacePage(
            core: WorkspaceCore(),
            account: null,
            page: 'accounts',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('创建账号'), findsOneWidget);
    expect(find.text('请先在账号页面创建账号。'), findsNothing);
  });
  testWidgets('Minecraft controls fit a narrow API workspace', (tester) async {
    tester.view.physicalSize = const Size(460, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: appTheme(dark: false, minecraft: true, prefs: {}),
        home: Scaffold(
          body: SingleChildScrollView(
            child: WorkspacePage(
              core: WorkspaceCore(),
              account: '123',
              page: 'api',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(SettingSwitch), findsWidgets);
    expect(tester.takeException(), isNull);
  });
  testWidgets('Minecraft colour panel expands but cannot change accent', (
    tester,
  ) async {
    Map<String, dynamic> prefs = {
      'skin': 'minecraft',
      'theme': 'light',
      'accent': '4176e6',
    };
    await tester.pumpWidget(
      MaterialApp(
        theme: appTheme(dark: false, minecraft: true, prefs: {}),
        home: Scaffold(
          body: SingleChildScrollView(
            child: ThemeWorkspace(prefs: prefs, changed: (v) => prefs = v),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('自定义配色'));
    await tester.pumpAndSettle();
    expect(find.byType(AbsorbPointer), findsWidgets);
    expect(
      tester
          .widgetList<AbsorbPointer>(find.byType(AbsorbPointer))
          .any((w) => w.absorbing),
      isTrue,
    );
    await tester.tap(find.text('自定义配色'));
    await tester.pumpAndSettle();
    expect(prefs['accent'], '4176e6');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
