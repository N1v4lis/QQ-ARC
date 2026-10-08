import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:qqaf/core_client.dart';

void main() {
  test(
    'compiled Rust core starts, persists isolated data and exits',
    () async {
      final core = await CoreClient.start();
      try {
        final status = await core.request('/status') as Map;
        expect(status['connected_accounts'], isEmpty);
        await core.request('/accounts', body: {'account': 'fixture'});
        await core.request(
          '/memory',
          body: {'account': 'fixture', 'chat': 'scratch', 'text': '你好🦊'},
        );
        final notes = await core.request(
          '/memory',
          query: {'account': 'fixture', 'chat': 'scratch'},
        ) as List;
        expect(notes.last[1], '你好🦊');
        final stats =
            await core.request('/stats', query: {'account': 'fixture'}) as Map;
        expect(stats['calls'], 0);
      } finally {
        await core.close();
      }
      final reopened = await CoreClient.start();
      try {
        final notes = await reopened.request(
          '/memory',
          query: {'account': 'fixture', 'chat': 'scratch'},
        ) as List;
        expect(notes.last[1], '你好🦊');
      } finally {
        await reopened.close();
      }
    },
    skip:
        Platform.environment['QQAF_CORE_EXECUTABLE'] == null ||
        Platform.environment['QQAF_NATIVE_DATA_DIR'] == null,
  );
}
