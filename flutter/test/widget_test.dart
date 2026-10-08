import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qqaf/core_client.dart';
import 'package:qqaf/qqaf_app.dart';

class FakeCore implements CoreApi {
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
        return {'theme': 'light', 'skin': 'default'};
      case '/accounts':
        return <String>['123'];
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
    await tester.pumpWidget(QqafApp(core: core));
    await tester.pumpAndSettle();
    expect(find.text('Rust 核心已连接 · 独立迁移数据目录'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('主题'),
      80,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('main-nav')),
        matching: find.byType(Scrollable),
      ),
    );
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
}
