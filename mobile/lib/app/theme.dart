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

  static const double radiusCard = 16;
  static const double radiusField = 14;
  static const double radiusPill = 999;
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
      //
      // Une ombre douce et teintée plutôt qu'un simple contour : c'est ce qui
      // donne aux cartes des vitrines produit leur aspect « détaché » de la
      // page (référence design), sans toucher à la palette verte de la marque.
      cardTheme: CardThemeData(
        elevation: 2,
        shadowColor: scheme.shadow.withValues(alpha: 0.12),
        surfaceTintColor: Colors.transparent,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
        ),
      ),

      // Bordure visible plutôt qu'un simple pavé grisé : au repos elle reste
      // discrète (`outlineVariant`), puis se colore et s'épaissit au focus —
      // c'est ce retour immédiat qui fait paraître un champ « actif » plutôt
      // qu'un rectangle inerte (référence design).
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide(color: scheme.error, width: 2),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          borderSide: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5)),
        ),
        labelStyle: TextStyle(color: scheme.onSurfaceVariant),
        floatingLabelStyle: TextStyle(color: scheme.primary, fontWeight: FontWeight.w600),
        prefixIconColor: scheme.onSurfaceVariant,
        suffixIconColor: scheme.onSurfaceVariant,
        errorMaxLines: 2,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AllGoTokens.space4,
          vertical: AllGoTokens.space3,
        ),
      ),

      // Bouton pilule pour l'action principale — le repère visuel le plus
      // immédiat d'un « Ajouter au panier »/« Commander » (référence design),
      // sans dépendre d'une couleur différente de celle de la marque.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(AllGoTokens.minTouchTarget),
          shape: const StadiumBorder(),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(AllGoTokens.minTouchTarget),
          shape: const StadiumBorder(),
          side: BorderSide(color: scheme.outline),
        ),
      ),

      bottomSheetTheme: const BottomSheetThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AllGoTokens.radiusSheet),
          ),
        ),
      ),

      // Pastille pleine plutôt que le contour fin par défaut de Material 3 :
      // un « chip » de produit ou de boutique récemment consulté doit se lire
      // comme une carte miniature, pas comme un simple contour sur le fond.
      chipTheme: ChipThemeData(
        backgroundColor: scheme.surfaceContainerHighest.withValues(alpha: 0.6),
        selectedColor: scheme.primaryContainer,
        side: BorderSide.none,
        shape: const StadiumBorder(),
        labelStyle: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w600, fontSize: 13),
        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space1),
      ),

      // Barre flottante avec ombre douce : la séparer visuellement du contenu
      // au lieu d'un simple filet posé à plat, plus net sur la référence
      // design (§ inspirations e-commerce) tout en gardant l'indicateur vert
      // de marque.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        elevation: 3,
        shadowColor: scheme.shadow.withValues(alpha: 0.16),
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primaryContainer,
        indicatorShape: const StadiumBorder(),
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 12,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? scheme.onSurface : scheme.onSurfaceVariant,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? scheme.primary : scheme.onSurfaceVariant,
            size: 24,
          );
        }),
      ),

      // Taille de police minimale 14 sp : en dessous, un texte devient illisible
      // en plein soleil sur un écran d'entrée de gamme.
      textTheme: const TextTheme(
        bodySmall: TextStyle(fontSize: 14),
      ),
    );
  }
}
