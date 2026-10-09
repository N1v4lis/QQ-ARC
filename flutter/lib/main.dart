import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import 'core_client.dart';
import 'qqaf_app.dart';
import 'desktop_bridge.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();
  await windowManager.waitUntilReadyToShow(
    const WindowOptions(
      size: Size(1200, 800),
      minimumSize: Size(800, 600),
      center: true,
      title: 'QQ Agent ARCFØX',
      titleBarStyle: TitleBarStyle.hidden,
    ),
    () async {
      await windowManager.show();
      await windowManager.focus();
    },
  );
  try {
    final core = await CoreClient.start();
    runApp(CoreLifecycle(core: core));
  } catch (error) {
    runApp(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: SelectableText('QQAF 核心启动失败\n$error'),
            ),
          ),
        ),
      ),
    );
  }
}

String closeAction(Map prefs) {
  final action = prefs['closeAction'];
  if (['taskbar', 'tray', 'exit'].contains(action)) return action as String;
  return prefs['closeToTray'] == true ? 'tray' : 'taskbar';
}

class CoreLifecycle extends StatefulWidget {
  const CoreLifecycle({super.key, required this.core});
  final CoreClient core;
  @override
  State<CoreLifecycle> createState() => _CoreLifecycleState();
}

class _CoreLifecycleState extends State<CoreLifecycle> with WindowListener {
  bool closing = false;
  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    unawaited(windowManager.setPreventClose(true));
    DesktopBridge.channel.setMethodCallHandler((call) async {
      if (call.method == 'trayExit') {
        await terminate();
      }
    });
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    DesktopBridge.channel.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  void onWindowClose() async {
    Map prefs = {};
    try {
      prefs = await widget.core.request('/preferences') as Map;
    } catch (_) {}
    final action = closeAction(prefs);
    if (action == 'exit') {
      await terminate();
      return;
    }
    if (action == 'tray') {
      try {
        await DesktopBridge.setTray(true);
        await windowManager.hide();
        return;
      } catch (_) {
        /* Keep the app reachable on the taskbar if tray creation fails. */
      }
    }
    await windowManager.minimize();
  }

  Future<void> terminate() async {
    if (closing) return;
    closing = true;
    await widget.core.close();
    await windowManager.destroy();
    exit(0);
  }

  @override
  Widget build(BuildContext context) =>
      QqafApp(core: widget.core, onExit: () => unawaited(terminate()));
}
