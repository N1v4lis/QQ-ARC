import 'package:flutter/services.dart';

class DesktopBridge {
  static const channel = MethodChannel('qqaf/desktop');
  static Future<void> setTray(bool enabled) =>
      channel.invokeMethod('setTray', enabled);
  static Future<void> setStartup(bool enabled) =>
      channel.invokeMethod('setStartup', enabled);
  static Future<String?> chooseDirectory() =>
      channel.invokeMethod<String>('chooseDirectory');
  static Future<void> openDirectory(String path) =>
      channel.invokeMethod('openDirectory', path);
  static Future<void> openUrl(String value) async {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !['http', 'https'].contains(uri.scheme) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      throw ArgumentError('网页地址无效');
    }
    await channel.invokeMethod('openUrl', value);
  }
}
