import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qqaf/core_client.dart';
import 'package:qqaf/snow_download_panel.dart';
import 'package:qqaf/qqaf_app.dart';

class SnowFixture implements CoreApi {
  final List<String> mutations = [];
  Map<String, dynamic>? install;
  bool installed = false;
  @override
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    if (body != null) {
      mutations.add(path);
      if (path == '/snow/install') {
        install = Map<String, dynamic>.from(body as Map);
        installed = true;
        return {'job': job()};
      }
      return {'ok': true};
    }
    switch (path) {
      case '/snow/install/plan':
        return {
          'defaultDirectory': 'E:/QQAF/Snowluma',
          'configuredDirectory': '',
          'component': {
            'available': true,
            'installedVersion': installed ? '1.14.22' : '1.14.19',
            'targetVersion': 'v1.14.22',
            'updateAvailable': !installed,
          },
          'compatibility': {'recommended': 'v1.14.22'},
        };
      case '/snow/download/status':
        return {
          'job': installed ? job() : null,
          'check': null,
          'compatibility': {'recommended': 'v1.14.22'},
        };
      case '/status':
        return {'connected_accounts': <String>[]};
      case '/preferences':
        return {'theme': 'light', 'skin': 'default'};
      case '/accounts':
        return <String>['123'];
      case '/config':
        return {
          'api': {'model': ''},
        };
      case '/stats':
        return {
          'calls': 0,
          'input_tokens': 0,
          'output_tokens': 0,
          'estimated_cost': 0,
        };
      case '/chats':
        return <String>[];
      default:
        return <dynamic>[];
    }
  }

  Map<String, dynamic> job() => {
    'id': 'fixture',
    'phase': 'installed',
    'tag': 'v1.14.22',
    'received': 10,
    'total': 10,
    'installDirectory': install?['directory'] ?? 'E:/QQAF/Snowluma',
  };
  @override
  Future<void> close() async {}
}

void main() {
  testWidgets(
    'fixed-version install requires a click and preserves the selected location',
    (tester) async {
      final core = SnowFixture();
      String? directory;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SnowDownloadPanel(
                core: core,
                account: '123',
                installed: (value) => directory = value,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(core.mutations, isEmpty);
      expect(find.text('固定适配版本：SnowLuma 1.14.22'), findsOneWidget);
      expect(find.text('每天自动检查'), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'E:/QQAF/Snowluma',
      );
      await tester.enterText(find.byType(TextField), 'E:/custom/Snowluma');
      await tester.ensureVisible(find.text('更新 SnowLuma 至 1.14.22'));
      await tester.tap(find.text('更新 SnowLuma 至 1.14.22'));
      await tester.pumpAndSettle();
      expect(core.install!['channel'], 'compatible');
      expect(core.install!['directory'], 'E:/custom/Snowluma');
      expect(directory, 'E:/custom/Snowluma');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'startup detects SL locally and prompts without installing or querying GitHub',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final core = SnowFixture();
      await tester.pumpWidget(QqafApp(core: core, animateStartup: false));
      await tester.pumpAndSettle();
      expect(find.byType(MaterialBanner), findsOneWidget);
      expect(find.text('前往更新'), findsOneWidget);
      expect(core.mutations, isEmpty);
      await tester.tap(find.text('稍后'));
      await tester.pumpAndSettle();
      expect(find.byType(MaterialBanner), findsNothing);
      expect(core.mutations, isEmpty);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
