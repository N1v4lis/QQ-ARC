import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

abstract class CoreApi {
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  });
  Future<void> close();
}

class CoreClient implements CoreApi {
  CoreClient(this._process, this._port, this._token);
  final Process _process;
  final int _port;
  final String _token;
  final HttpClient _http = HttpClient();

  static Future<CoreClient> start() async {
    final random = Random.secure();
    final token = base64Url.encode(
      List<int>.generate(32, (_) => random.nextInt(256)),
    );
    final executable =
        Platform.environment['QQAF_CORE_EXECUTABLE'] ??
        '${File(Platform.resolvedExecutable).parent.path}${Platform.pathSeparator}qqaf-native${Platform.isWindows ? '.exe' : ''}';
    if (!File(executable).existsSync()) {
      throw StateError('未找到 Rust 核心，请使用完整迁移包或设置 QQAF_CORE_EXECUTABLE。');
    }
    final process = await Process.start(
      executable,
      const [],
      environment: {'QQAF_CORE_TOKEN': token},
    );
    // Never echo protocol handshake, credentials or child output to logs.
    process.stderr.drain<void>();
    final firstLine = Completer<String>();
    process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(
          (line) {
            if (!firstLine.isCompleted) firstLine.complete(line);
          },
          onDone: () {
            if (!firstLine.isCompleted) {
              firstLine.completeError(StateError('Rust 核心启动失败。'));
            }
          },
        );
    try {
      final handshake = jsonDecode(
        await firstLine.future.timeout(const Duration(seconds: 20)),
      ) as Map<String, dynamic>;
      final port = handshake['port'] as int;
      if (port < 1 || port > 65535) throw StateError('核心握手无效。');
      return CoreClient(process, port, token);
    } catch (_) {
      process.kill();
      rethrow;
    }
  }

  @override
  Future<dynamic> request(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    final uri = Uri(
      scheme: 'http',
      host: '127.0.0.1',
      port: _port,
      path: path,
      queryParameters: query,
    );
    final request = await _http.openUrl(body == null ? 'GET' : 'POST', uri);
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $_token');
    if (body != null) {
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
    }
    final response = await request.close().timeout(
      const Duration(seconds: 130),
    );
    final value = jsonDecode(await response.transform(utf8.decoder).join());
    if (response.statusCode >= 400) {
      throw StateError(value is Map ? '${value['error'] ?? '操作失败'}' : '操作失败');
    }
    return value;
  }

  @override
  Future<void> close() async {
    try {
      await request('/shutdown', body: {}).timeout(const Duration(seconds: 3));
    } catch (_) {
      /* Already stopped. */
    }
    try {
      await _process.exitCode.timeout(const Duration(seconds: 5));
    } catch (_) {
      _process.kill();
    }
    _http.close(force: true);
  }
}
