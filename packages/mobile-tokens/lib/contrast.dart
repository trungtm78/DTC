import 'dart:math' as math;

import 'package:flutter/painting.dart';

import 'machvon_theme.generated.dart';

final RegExp _hexColor = RegExp(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
final RegExp _assetId = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);
// Anything that could leave a colour value and become another declaration, rule, resource or markup.
final RegExp _forbiddenValue = RegExp(
  r'url\s*\(|expression\s*\(|@import|javascript:|[<>;{}\\]|/\*|\*/',
  caseSensitive: false,
);

/// The only overlay key that is not a colour: the id of a stored asset, never a URL or a file name.
const String kLogoAssetKey = 'logoAssetId';

/// Finding codes of an overlay check; the same names as the TypeScript validator.
const String kFindingContrast = 'CONTRAST';
const String kFindingForbiddenValue = 'FORBIDDEN_VALUE';
const String kFindingUnknownToken = 'UNKNOWN_TOKEN';
const String kFindingBadColor = 'BAD_COLOR';
const String kFindingLogo = 'LOGO';

double _linear(int channel) {
  final double scaled = channel / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : math.pow((scaled + 0.055) / 1.055, 2.4).toDouble();
}

int _channel(double normalised) => (normalised * 255).round().clamp(0, 255);

/// WCAG 2.x relative luminance of a colour, 0 (black) to 1 (white).
double relativeLuminance(Color color) {
  return 0.2126 * _linear(_channel(color.r)) +
      0.7152 * _linear(_channel(color.g)) +
      0.0722 * _linear(_channel(color.b));
}

/// WCAG 2.x contrast ratio between two colours, 1 to 21, independent of their order.
double contrastRatio(Color a, Color b) {
  final double first = relativeLuminance(a);
  final double second = relativeLuminance(b);
  final double lighter = first > second ? first : second;
  final double darker = first > second ? second : first;
  return (lighter + 0.05) / (darker + 0.05);
}

/// Parses `#RGB` or `#RRGGBB` (any letter case); null for anything else.
Color? parseHexColor(String value) {
  if (!_hexColor.hasMatch(value)) {
    return null;
  }
  final String digits = value.substring(1);
  final String full = digits.length == 3 ? digits.split('').map((String d) => '$d$d').join() : digits;
  return Color(0xFF000000 | int.parse(full, radix: 16));
}

/// The distinct finding codes of a tenant theme overlay, sorted; empty when the overlay is accepted.
///
/// Mirrors `validateTenantOverlay` of the web: only the twelve theme colours and a logo asset id, colours as hex
/// only, and each of the six text pairs at least [kMinTextContrast] once the overlay is applied.
List<String> overlayFindingCodes(Map<String, String> overlay) {
  final Set<String> codes = <String>{};
  final Map<String, Color> theme = Map<String, Color>.of(kBaseTenantTheme);
  final Set<String> unusable = <String>{};

  for (final MapEntry<String, String> entry in overlay.entries) {
    final String token = entry.key;
    final String value = entry.value;
    if (token == kLogoAssetKey) {
      if (!_assetId.hasMatch(value)) {
        codes.add(kFindingLogo);
      }
    } else if (kThemeColorKeys.contains(token)) {
      if (_forbiddenValue.hasMatch(value)) {
        codes.add(kFindingForbiddenValue);
        unusable.add(token);
        continue;
      }
      final Color? parsed = parseHexColor(value);
      if (parsed == null) {
        codes.add(kFindingBadColor);
        unusable.add(token);
      } else {
        theme[token] = parsed;
      }
    } else {
      codes.add(kFindingUnknownToken);
    }
  }

  for (final ContrastPairSpec pair in kContrastPairs) {
    if (unusable.contains(pair.foreground) || unusable.contains(pair.background)) {
      continue;
    }
    if (contrastRatio(theme[pair.foreground]!, theme[pair.background]!) < kMinTextContrast) {
      codes.add(kFindingContrast);
    }
  }
  return codes.toList()..sort();
}

/// Whether a tenant theme overlay is accepted whole.
bool overlayAccepted(Map<String, String> overlay) => overlayFindingCodes(overlay).isEmpty;
