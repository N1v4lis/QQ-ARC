import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qqaf/core_client.dart';
import 'package:qqaf/qqaf_app.dart';
import 'package:qqaf/main.dart' show closeAction;

class FakeCore implements CoreApi {
  FakeCore({this.minecraft = false});
  final bool minecraft;
  final List<String> mutations = [];
  @override
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    if (body != null) {
      mutations.add(path);
      return {'ok': true};
    }
    switch (path) {
      case '/status':
        return {'connected_accounts': <String>[]};
      case '/preferences':
        return {'theme': 'light', 'skin': minecraft ? 'minecraft' : 'default'};
      case '/accounts':
        return <String>['123'];
      case '/config':
        return {
          'api': {'model': 'workspace-model'},
        };
      case '/model/config':
        return {
          'base_url': 'https://example.invalid/v1',
          'model': 'fixture-model',
          'system_prompt': '',
        };
      case '/chats':
        return <String>[];
      case '/memory':
        return <dynamic>[];
      case '/stats':
        return {
          'calls': 0,
          'input_tokens': 0,
          'output_tokens': 0,
          'estimated_cost': 0,
        };
      default:
        return <dynamic>[];
    }
  }

  @override
  Future<void> close() async {}
}

void main() {
  testWidgets('real core snapshots render and Wine Fox stays disabled', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final core = FakeCore();
    await tester.pumpWidget(QqafApp(core: core, animateStartup: false));
    await tester.pumpAndSettle();
    expect(find.text('Rust 核心已连接 · 独立迁移数据目录'), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const ValueKey('status-toolbar'))).height,
      44,
    );
    expect(
      tester.getSize(find.byKey(const ValueKey('navigation-width'))).width,
      152,
    );
    await tester.tap(find.text('收起导航'));
    await tester.pumpAndSettle();
    expect(
      tester.getSize(find.byKey(const ValueKey('navigation-width'))).width,
      60,
    );
    expect(tester.takeException(), isNull);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect(
      tester.getSize(find.byKey(const ValueKey('navigation-width'))).width,
      152,
    );
    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    expect(find.text('模型：workspace-model'), findsOneWidget);
    await tester.tap(find.text('主题'));
    await tester.pumpAndSettle();
    final pet = tester.widget<SwitchListTile>(
      find.widgetWithText(SwitchListTile, '酒狐'),
    );
    expect(pet.value, isFalse);
    expect(pet.onChanged, isNull);
    await tester.tap(find.text('暗色模式'));
    await tester.pumpAndSettle();
    expect(core.mutations, contains('/preferences'));
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('Minecraft shell remains usable at minimum window size', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      QqafApp(core: FakeCore(minecraft: true), animateStartup: false),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('收起导航'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('展开导航'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('设置'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('settings-nav')), findsNothing);
    expect(find.text('API与搜索'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  test('window close defaults to tray and supports explicit actions', () {
    expect(closeAction({}), 'tray');
    expect(closeAction({'closeToTray': true}), 'tray');
    expect(closeAction({'closeToTray': false}), 'taskbar');
    expect(closeAction({'closeAction': 'exit'}), 'exit');
    expect(closeAction({'closeAction': 'taskbar'}), 'taskbar');
  });
}
