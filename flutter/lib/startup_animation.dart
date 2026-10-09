import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// One deterministic particle geometry shared by light and dark appearances.
class ArcfoxStartup extends StatefulWidget {
  const ArcfoxStartup({
    super.key,
    required this.ready,
    required this.status,
    required this.complete,
    this.duration = const Duration(seconds: 2),
    this.pictureLoader,
  });
  final bool ready;
  final String status;
  final VoidCallback complete;
  final Duration duration;
  final Future<ui.Image> Function(String, int, int)? pictureLoader;
  @override
  State<ArcfoxStartup> createState() => _ArcfoxStartupState();
}

class _ArcfoxStartupState extends State<ArcfoxStartup>
    with SingleTickerProviderStateMixin {
  late final AnimationController controller;
  ui.Image? logo, word;
  List<ArcParticle> particles = [];
  bool notified = false, reduced = false, failed = false;
  @override
  void initState() {
    super.initState();
    controller = AnimationController(vsync: this, duration: widget.duration)
      ..addStatusListener((s) {
        if (s == AnimationStatus.completed) finish();
      });
    unawaited(load());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = MediaQuery.disableAnimationsOf(context);
    if (next != reduced) {
      reduced = next;
      controller.duration = reduced
          ? const Duration(milliseconds: 500)
          : widget.duration;
    }
  }

  @override
  void didUpdateWidget(ArcfoxStartup old) {
    super.didUpdateWidget(old);
    if (controller.isCompleted && widget.ready) finish();
  }

  void finish() {
    if (!widget.ready || notified || !mounted) return;
    notified = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.complete();
    });
  }

  Future<ui.Image> raster(String path, int width, int height) async {
    final picture = await vg.loadPicture(SvgAssetLoader(path), null);
    try {
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);
      canvas.scale(width / picture.size.width, height / picture.size.height);
      canvas.drawPicture(picture.picture);
      final scaled = recorder.endRecording();
      try {
        return await scaled.toImage(width, height);
      } finally {
        scaled.dispose();
      }
    } finally {
      picture.picture.dispose();
    }
  }

  Future<void> load() async {
    ui.Image? a, b;
    try {
      a = await (widget.pictureLoader ?? raster)(
        'assets/startup/arcfox-logo.svg',
        192,
        192,
      ).timeout(const Duration(milliseconds: 2500));
      b = await (widget.pictureLoader ?? raster)(
        'assets/startup/arcfox-wordmark.svg',
        336,
        54,
      ).timeout(const Duration(milliseconds: 2500));
      final random = math.Random(0xa7cf0a);
      final points = <ArcParticle>[];
      for (final pair in [(a, 200, false), (b, 120, true)]) {
        final data = await pair.$1.toByteData(
          format: ui.ImageByteFormat.rawRgba,
        );
        if (data == null) throw StateError('SVG raster unavailable');
        final candidates = <Offset>[];
        for (var y = 0; y < pair.$1.height; y += 2) {
          for (var x = 0; x < pair.$1.width; x += 2) {
            if (data.getUint8((y * pair.$1.width + x) * 4 + 3) > 128) {
              candidates.add(Offset(x / pair.$1.width, y / pair.$1.height));
            }
          }
        }
        if (candidates.isEmpty) throw StateError('Empty SVG mask');
        for (var i = 0; i < pair.$2; i++) {
          final target = candidates[random.nextInt(candidates.length)];
          final angle = random.nextDouble() * math.pi * 2,
              radius = .12 + random.nextDouble() * .28;
          points.add(
            ArcParticle(
              target,
              Offset(math.cos(angle) * radius, math.sin(angle) * radius),
              pair.$3,
              random.nextDouble(),
            ),
          );
        }
      }
      if (!mounted) {
        a.dispose();
        b.dispose();
        return;
      }
      setState(() {
        logo = a;
        word = b;
        particles = points;
      });
    } catch (_) {
      a?.dispose();
      b?.dispose();
      if (mounted) setState(() => failed = true);
    }
    if (mounted) controller.forward();
  }

  @override
  void dispose() {
    controller.dispose();
    logo?.dispose();
    word?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return ColoredBox(
      color: dark ? const Color(0xff0b0f1a) : const Color(0xfff7f9fc),
      child: Stack(
        children: [
          if (failed)
            const Center(
              child: Text(
                'ARCFØX',
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 5,
                ),
              ),
            ),
          Positioned.fill(
            child: RepaintBoundary(
              child: AnimatedBuilder(
                animation: controller,
                builder: (context, _) => CustomPaint(
                  painter: ArcfoxPainter(
                    logo,
                    word,
                    particles,
                    controller.value,
                    dark,
                    reduced || failed,
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: 24,
            right: 24,
            bottom: 26,
            child: Column(
              children: [
                Text(
                  widget.status,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    color: dark
                        ? const Color(0xff8b9bb5)
                        : const Color(0xff6e819e),
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Flutter + Rust · 实验版',
                  style: TextStyle(fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ArcParticle {
  const ArcParticle(this.target, this.spread, this.word, this.shade);
  final Offset target, spread;
  final bool word;
  final double shade;
}

class ArcfoxPainter extends CustomPainter {
  ArcfoxPainter(
    this.logo,
    this.word,
    this.particles,
    this.progress,
    this.dark,
    this.reduced,
  );
  final ui.Image? logo, word;
  final List<ArcParticle> particles;
  final double progress;
  final bool dark, reduced;
  double phase(double start, double end) =>
      ((progress - start) / (end - start)).clamp(0, 1);
  double curve(double t) {
    final a = math.pow(t, 3).toDouble(),
        b = math.pow(.72 * (1 - t), 3).toDouble();
    return a / math.max(.000001, a + b);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final viewport = Size(
      math.min(size.width, size.height * 16 / 9),
      math.min(size.height, size.width * 9 / 16),
    );
    final center = size.center(Offset.zero);
    final logoWidth = (viewport.width * .11).clamp(90.0, 220.0);
    final lift = curve(phase(.5385, .6923)) * viewport.height * .055;
    final scale = 1 - .06 * curve(phase(.5385, .6923));
    final logoBox = Rect.fromCenter(
      center: center - Offset(0, lift + 15),
      width: logoWidth * scale,
      height: logoWidth * scale,
    );
    final wordBox = Rect.fromCenter(
      center: center + Offset(0, logoWidth * .62),
      width: logoWidth * 1.75,
      height: logoWidth * 1.75 * 54 / 336,
    );
    if (reduced) {
      final paint = Paint()..color = Colors.white.withValues(alpha: progress);
      if (logo != null) {
        canvas.drawImageRect(
          logo!,
          Rect.fromLTWH(0, 0, 192, 192),
          logoBox,
          paint,
        );
      }
      if (word != null) {
        canvas.drawImageRect(
          word!,
          Rect.fromLTWH(0, 0, 336, 54),
          wordBox,
          paint,
        );
      }
      return;
    }
    if (particles.isEmpty) return;
    final spread = curve(phase(.0385, .3077));
    for (var i = 0; i < particles.length; i++) {
      final p = particles[i];
      if (progress < .0385 && i >= 6) continue;
      if (p.word && progress < .6346) continue;
      final converge = p.word
          ? curve(phase(.6346 + p.target.dx * .04, .787 + p.target.dx * .04))
          : curve(phase(.3077, .5385));
      final box = p.word ? wordBox : logoBox;
      final target = Offset(
        box.left + p.target.dx * box.width,
        box.top + p.target.dy * box.height,
      );
      final expanded =
          center +
          Offset(
            p.spread.dx * viewport.width * spread,
            p.spread.dy * viewport.height * spread,
          );
      final position = Offset.lerp(expanded, target, converge)!;
      final alpha = progress > (p.word ? .827 : .5385) ? 0.0 : 1.0;
      final base = dark
          ? p.shade > .97
                ? const Color(0xffc6e3ff)
                : p.shade > .77
                ? const Color(0xff679efe)
                : const Color(0xff294c7f)
          : const Color(0xff416fc5);
      canvas.drawCircle(
        position,
        (viewport.width / 400).clamp(1.2, 3.0),
        Paint()..color = base.withValues(alpha: alpha),
      );
    }
    // The final images use the same SVG masks as the particle targets.
    void tiles(ui.Image? image, Rect box, double amount, int cols, int rows) {
      if (image == null || amount <= 0) return;
      if (amount >= 1) {
        canvas.drawImageRect(
          image,
          Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
          box,
          Paint(),
        );
        return;
      }
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          final threshold = ((x * 13 + y * 7) % (cols * rows)) / (cols * rows);
          if (amount < threshold) continue;
          canvas.save();
          canvas.clipRect(
            Rect.fromLTWH(
              box.left + box.width * x / cols,
              box.top + box.height * y / rows,
              box.width / cols + .5,
              box.height / rows + .5,
            ),
          );
          canvas.drawImageRect(
            image,
            Rect.fromLTWH(
              0,
              0,
              image.width.toDouble(),
              image.height.toDouble(),
            ),
            box,
            Paint(),
          );
          canvas.restore();
        }
      }
    }

    tiles(logo, logoBox, phase(.36, .5385), 8, 8);
    tiles(word, wordBox, phase(.6346, .827), 24, 4);
  }

  @override
  bool shouldRepaint(ArcfoxPainter old) =>
      old.progress != progress ||
      old.dark != dark ||
      old.logo != logo ||
      old.reduced != reduced;
}
