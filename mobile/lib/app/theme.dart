import 'package:flutter/material.dart';

/// Jetons de design — §11.1.
///
/// Toute valeur d'espacement, de rayon ou de couleur passe par ici. Une
/// constante magique dans un widget est un écart au design system, pas un
/// raccourci.
abstract final class AllGoTokens {
  /// Vert AllGo, repris de l'identité web.
  static const Color brand = Color(0xFF198754);
  static const Color brandDark = Color(0xFF126B43);
  static const Color danger = Color(0xFFDC3545);
  static const Color warning = Color(0xFFFFC107);
  static const Color success = Color(0xFF198754);

  /// Grille de 4 dp.
  static const double space1 = 4;
  static const double space2 = 8;
  static const double space3 = 12;
  static const double space4 = 16;
  static const double space6 = 24;
  static const double space8 = 32;

  static const double radiusCard = 12;
  static const double radiusField = 8;
  static const double radiusSheet = 24;

  /// Zone tactile minimale — §11.1. En dessous, la cible devient inatteignable
  /// pour un pouce sur un écran de 6 pouces.
  static const double minTouchTarget = 48;
}

abstract final class AllGoTheme {
  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: AllGoTokens.brand,
      brightness: brightness,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: 'Roboto',
      scaffoldBackgroundColor: scheme.surface,

      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
      ),

      // `CardThemeData` depuis Flutter 3.32 : `CardTheme` est devenu un widget
      // d'héritage, il n'est plus accepté ici.
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AllGoTokens.space4,
          vertical: AllGoTokens.space3,
        ),
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(AllGoTokens.minTouchTarget),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          ),
        ),
      ),

      bottomSheetTheme: const BottomSheetThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AllGoTokens.radiusSheet),
          ),
        ),
      ),

      // Taille de police minimale 14 sp : en dessous, un texte devient illisible
      // en plein soleil sur un écran d'entrée de gamme.
      textTheme: const TextTheme(
        bodySmall: TextStyle(fontSize: 14),
      ),
    );
  }
}
