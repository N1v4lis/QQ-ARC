import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'dart:math' as math;

class SkinStyle extends ThemeExtension<SkinStyle> {
  const SkinStyle(this.minecraft, [this.toggleSound]);
  final bool minecraft;
  final ValueChanged<bool>? toggleSound;
  @override
  SkinStyle copyWith({bool? minecraft}) =>
      SkinStyle(minecraft ?? this.minecraft, toggleSound);
  @override
  SkinStyle lerp(covariant SkinStyle? other, double t) =>
      t < 0.5 ? this : other ?? this;
}

class SettingSwitch extends StatelessWidget {
  const SettingSwitch({
    super.key,
    required this.value,
    required this.onChanged,
  });
  final bool value;
  final ValueChanged<bool>? onChanged;
  @override
  Widget build(BuildContext context) {
    if (Theme.of(context).extension<SkinStyle>()?.minecraft != true) {
      return SizedBox(
        width: 40,
        height: 24,
        child: FittedBox(
          child: Switch(
            value: value,
            onChanged: onChanged,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
        ),
      );
    }
    return Semantics(
      button: true,
      toggled: value,
      enabled: onChanged != null,
      child: Tooltip(
        message: value ? '开启' : '关闭',
        child: Opacity(
          opacity: onChanged == null ? 0.4 : 1,
          child: InkWell(
            onTap: onChanged == null
                ? null
                : () {
                    onChanged!(!value);
                    Theme.of(context)
                        .extension<SkinStyle>()
                        ?.toggleSound
                        ?.call(!value);
                  },
            child: SizedBox(
              width: 80,
              height: 64,
              child: CustomPaint(painter: _LeverPainter(value)),
            ),
          ),
        ),
      ),
    );
  }
}

class _LeverPainter extends CustomPainter {
  _LeverPainter(this.on);
  final bool on;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..isAntiAlias = false;
    void rect(double x, double y, double w, double h, int color) {
      paint.color = Color(color);
      canvas.drawRect(Rect.fromLTWH(x, y, w, h), paint);
    }

    rect(8, 43, 64, 15, 0xff555961);
    rect(11, 46, 58, 6, 0xffb7bac2);
    rect(13, 47, 54, 2, 0xffe0e2e7);
    rect(8, 58, 64, 4, on ? 0xffdf3b2f : 0xff767980);
    canvas.save();
    canvas.translate(40, 46);
    canvas.rotate((on ? 1 : -1) * math.pi / 6);
    rect(-5, -39, 10, 39, 0xff936131);
    rect(-3, -35, 4, 32, 0xffd5a461);
    rect(-7, -41, 14, 7, 0xff79502c);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _LeverPainter old) => old.on != on;
}

class SettingSwitchTile extends StatelessWidget {
  const SettingSwitchTile({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
    this.contentPadding,
  });
  final Widget title;
  final Widget? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final EdgeInsetsGeometry? contentPadding;
  @override
  Widget build(BuildContext context) {
    if (Theme.of(context).extension<SkinStyle>()?.minecraft != true) {
      return SwitchListTile(
        title: title,
        subtitle: subtitle,
        value: value,
        onChanged: onChanged,
        contentPadding: contentPadding,
      );
    }
    return Padding(
      padding: contentPadding ?? const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [title, ?subtitle],
            ),
          ),
          SettingSwitch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

String? modelBrand(String model) {
  final id = model.toLowerCase().split('/').last;
  for (final entry in <String, List<String>>{
    'deepseek': ['deepseek'],
    'glm': ['glm', 'chatglm', 'cogview', 'cogvideo', 'codegeex'],
    'gemini': ['gemini', 'gemma', 'imagen', 'veo', 'lyria'],
    'mimo': ['mimo'],
    'qwen': ['qwen', 'qwq', 'wan'],
    'kimi': ['kimi', 'moonshot'],
    'minimax': ['minimax', 'abab', 'hailuo', 'speech'],
    'anthropic': ['claude'],
    'openai': [
      'gpt',
      'chatgpt',
      'codex',
      'o1',
      'o3',
      'o4',
      'text-embedding',
      'whisper',
      'tts',
      'dall-e',
      'sora',
      'omni-moderation',
    ],
    'xai': ['grok'],
  }.entries) {
    if (entry.value.any(id.startsWith)) return entry.key;
  }
  return null;
}

class ModelLogo extends StatelessWidget {
  const ModelLogo(this.model, {super.key, this.size = 20});
  final String model;
  final double size;
  @override
  Widget build(BuildContext context) {
    final brand = modelBrand(model);
    if (brand == null) return SizedBox(width: size, height: size);
    final path =
        'assets/model-logos/$brand.${['deepseek', 'xai'].contains(brand) ? 'svg' : 'png'}';
    return SizedBox(
      width: size,
      height: size,
      child: brand == 'deepseek' || brand == 'xai'
          ? SvgPicture.asset(path)
          : Image.asset(path, filterQuality: FilterQuality.high),
    );
  }
}

class PixelIcon extends StatelessWidget {
  const PixelIcon(this.name, {super.key, this.size = 24});
  final String name;
  final double size;
  @override
  Widget build(BuildContext context) =>
      SvgPicture.asset('assets/mc/icons/$name.svg', width: size, height: size);
}

const pixelNav = <int, String>{
  0: 'gauge',
  1: 'chat',
  2: 'key',
  3: 'users',
  4: 'brain',
  5: 'layout',
  6: 'archive',
  7: 'chart',
  8: 'persona',
  9: 'spark',
  10: 'plugin',
  11: 'users',
  12: 'paper',
  13: 'chat',
  14: 'desktop',
  15: 'layout',
  16: 'gear',
  17: 'spark',
  18: 'plugin',
};

ThemeData appTheme({
  required bool dark,
  required bool minecraft,
  required Map<String, dynamic> prefs,
  ValueChanged<bool>? toggleSound,
}) {
  final brightness = dark ? Brightness.dark : Brightness.light;
  final accent = minecraft
      ? (dark ? const Color(0xffa8d88a) : const Color(0xff2f7d32))
      : Color(
          int.tryParse(
                '${prefs['accent'] ?? '4176e6'}',
                radix: 16,
              )?.toUnsigned(32) ??
              0x4176e6,
        ).withValues(alpha: 1);
  final radius = minecraft ? BorderRadius.zero : BorderRadius.circular(8);
  final outline = OutlineInputBorder(
    borderRadius: radius,
    borderSide: BorderSide(
      color: dark ? const Color(0xff575961) : const Color(0xffd5d8de),
    ),
  );
  final background = minecraft && prefs['background'] == true;
  final theme = ThemeData(
    extensions: [SkinStyle(minecraft, toggleSound)],
    useMaterial3: true,
    brightness: brightness,
    colorScheme: ColorScheme.fromSeed(seedColor: accent, brightness: brightness)
        .copyWith(
          primary: accent,
          surface: dark ? const Color(0xff232324) : Colors.white,
          onSurface: dark ? const Color(0xfff9fafb) : const Color(0xff0f1115),
        ),
    scaffoldBackgroundColor: background
        ? Colors.transparent
        : dark
        ? const Color(0xff151517)
        : const Color(0xfff7f8fa),
    fontFamily: minecraft && prefs['mcFont'] != false
        ? 'Monocraft'
        : '${prefs['fontFamily'] ?? 'Segoe UI'}',
    fontFamilyFallback: minecraft && prefs['mcFont'] != false
        ? ['MinecraftAE']
        : ['Microsoft YaHei', 'sans-serif'],
    visualDensity: VisualDensity.compact,
    textTheme:
        const TextTheme(
          bodyMedium: TextStyle(fontSize: 13),
          bodyLarge: TextStyle(fontSize: 13),
          titleMedium: TextStyle(fontSize: 13),
          labelLarge: TextStyle(fontSize: 12),
        ).apply(
          fontSizeFactor:
              ((prefs['fontSize'] as num?)?.toDouble() ?? 13).clamp(11, 18) /
              13,
        ),
    dividerColor: dark ? const Color(0x1fffffff) : const Color(0x1a000000),
    appBarTheme: AppBarTheme(
      backgroundColor: background
          ? Colors.transparent
          : dark
          ? const Color(0xff151517)
          : const Color(0xfff7f8fa),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      shape: RoundedRectangleBorder(borderRadius: radius),
      elevation: 0,
      color: (dark ? const Color(0xff2c2c2e) : Colors.white).withValues(
        alpha: background ? .88 : 1,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: dark
          ? const Color(0xff2c2c2e)
          : Colors.white.withValues(alpha: background ? .88 : 1),
      border: outline,
      enabledBorder: outline,
      focusedBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: accent, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: dark
            ? const Color(0xfff9fafb)
            : const Color(0xff0f1115),
        backgroundColor: (dark ? const Color(0xff232324) : Colors.white)
            .withValues(alpha: background ? .88 : 1),
        minimumSize: const Size(0, 32),
        side: BorderSide(
          color: dark ? const Color(0x33ffffff) : const Color(0x1a000000),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 32),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
  );
  return theme;
}

class ThemeWorkspace extends StatelessWidget {
  const ThemeWorkspace({super.key, required this.prefs, required this.changed});
  final Map<String, dynamic> prefs;
  final ValueChanged<Map<String, dynamic>> changed;
  void set(String key, dynamic value) => changed({...prefs, key: value});
  @override
  Widget build(BuildContext context) {
    final minecraft = prefs['skin'] == 'minecraft';
    Widget volume(String title, String key) => Row(
      children: [
        SizedBox(width: 100, child: Text(title)),
        if (['clickVolume', 'toggleVolume', 'sliderVolume'].contains(key)) ...[
          SizedBox(
            width: 170,
            child: DropdownButtonFormField<String>(
              initialValue:
                  '${prefs[key.replaceFirst('Volume', 'Sound')] ?? (key == 'clickVolume'
                          ? 'hit'
                          : key == 'toggleVolume'
                          ? 'piston'
                          : 'none')}',
              isExpanded: true,
              decoration: const InputDecoration(isDense: true),
              items: [
                for (final entry
                    in (key == 'clickVolume'
                            ? {
                                'hit': '击打（三种随机）',
                                'menu': '菜单点击',
                                'pop': '轻响',
                                'none': '不播放',
                              }
                            : key == 'toggleVolume'
                            ? {
                                'piston': '活塞推出 / 收回',
                                'beacon': '信标开启 / 关闭',
                                'none': '不播放',
                              }
                            : {'none': '不播放', 'bow': '弓弦', 'pop': '轻响'})
                        .entries)
                  DropdownMenuItem(
                    value: entry.key,
                    child: Text(
                      entry.value,
                      style: const TextStyle(fontSize: 11),
                    ),
                  ),
              ],
              onChanged: (v) => set(key.replaceFirst('Volume', 'Sound'), v),
            ),
          ),
          const SizedBox(width: 12),
        ],
        Expanded(
          child: Slider(
            value: ((prefs[key] as num?)?.toDouble() ?? 1).clamp(0, 1),
            onChanged: (v) => set(key, v),
          ),
        ),
        SizedBox(
          width: 50,
          child: Text(
            '${(((prefs[key] as num?)?.toDouble() ?? 1) * 100).round()}%',
            textAlign: TextAlign.right,
          ),
        ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          '主题',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        SettingSwitchTile(
          title: const Text('暗色模式'),
          value: prefs['theme'] == 'dark',
          onChanged: (v) => set('theme', v ? 'dark' : 'light'),
        ),
        SettingSwitchTile(
          title: const Text('跟随系统'),
          value: prefs['theme'] == 'auto',
          onChanged: (v) => set('theme', v ? 'auto' : 'light'),
        ),
        SettingSwitchTile(
          title: const Text('Minecraft 主题'),
          value: minecraft,
          onChanged: (v) => set('skin', v ? 'minecraft' : 'default'),
        ),
        ExpansionTile(
          title: const Text('自定义配色'),
          subtitle: Text(minecraft ? '当前主题不支持自定义配色' : '默认主题支持自定义强调色'),
          children: [
            Opacity(
              opacity: minecraft ? 0.4 : 1,
              child: AbsorbPointer(
                absorbing: minecraft,
                child: Wrap(
                  spacing: 12,
                  children: [
                    for (final color in [
                      '4176e6',
                      '8053c8',
                      'd15a76',
                      '218c72',
                      'd47d27',
                    ])
                      InkWell(
                        onTap: () => set('accent', color),
                        child: Container(
                          width: 36,
                          height: 36,
                          margin: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Color(int.parse('ff$color', radix: 16)),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: prefs['accent'] == color
                                  ? Theme.of(context).colorScheme.onSurface
                                  : Colors.transparent,
                              width: 3,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
        if (minecraft) ...[
          SettingSwitchTile(
            title: const Text('像素字体'),
            value: prefs['mcFont'] != false,
            onChanged: (v) => set('mcFont', v),
          ),
          SettingSwitchTile(
            title: const Text('背景图'),
            value: prefs['background'] == true,
            onChanged: (v) => set('background', v),
          ),
          Wrap(
            spacing: 12,
            children: [
              for (var i = 1; i <= 3; i++)
                InkWell(
                  onTap: () => set('wallpaper', i),
                  child: SizedBox(
                    width: 160,
                    height: 90,
                    child: Image.asset(
                      'assets/mc/bg/wallpaper-$i.png',
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
            ],
          ),
          volume('背景可见度', 'opacity'),
          SettingSwitchTile(
            title: const Text('互动音效'),
            value: prefs['sound'] == true,
            onChanged: (v) => set('sound', v),
          ),
          volume('总音量', 'masterVolume'),
          volume('点击音', 'clickVolume'),
          volume('开关音', 'toggleVolume'),
          volume('滑条音', 'sliderVolume'),
          const SettingSwitchTile(
            title: Text('酒狐'),
            subtitle: Text('本次迁移不包含酒狐，保持关闭。'),
            value: false,
            onChanged: null,
          ),
        ] else
          const SettingSwitchTile(
            title: Text('酒狐'),
            subtitle: Text('本次迁移不包含酒狐，保持关闭。'),
            value: false,
            onChanged: null,
          ),
      ],
    );
  }
}
