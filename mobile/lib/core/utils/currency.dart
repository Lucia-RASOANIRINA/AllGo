import 'package:intl/intl.dart';

/// Formatage de l'Ariary — §11.1.
///
/// Forme attendue : `1 250 000 Ar`. Séparateur de milliers = espace
/// **insécable** (U+00A0), symbole suffixé, aucune décimale — l'Ariary n'a pas
/// de subdivision en usage courant.
///
/// L'espace insécable est essentiel : un espace ordinaire laisserait
/// `1 250\n000 Ar` se couper en fin de ligne sur un écran étroit.
abstract final class Ariary {
  static const String symbol = 'Ar';
  static const String _nbsp = ' ';

  static final NumberFormat _format = NumberFormat.decimalPattern('fr');

  /// Formate un montant entier en Ariary.
  static String format(num amount) {
    final digits = _format.format(amount.round()).replaceAll(
          RegExp(r'[\s  ]'),
          _nbsp,
        );
    return '$digits$_nbsp$symbol';
  }

  /// Formate un prix promotionnel avec son prix barré d'origine.
  static ({String current, String? original}) formatWithPromo(
    num price,
    num? promoPrice,
  ) {
    if (promoPrice == null || promoPrice >= price) {
      return (current: format(price), original: null);
    }
    return (current: format(promoPrice), original: format(price));
  }

  /// Pourcentage de remise, arrondi à l'entier.
  static int? discountPercent(num price, num? promoPrice) {
    if (promoPrice == null || price <= 0 || promoPrice >= price) return null;
    return (((price - promoPrice) / price) * 100).round();
  }
}

/// Formatage des distances renvoyées par `$geoNear` (en mètres).
abstract final class DistanceFormat {
  /// Sous 1 km, les mètres sont plus parlants ; au-delà, le kilomètre.
  static String format(num metres) {
    if (metres < 1000) return '${metres.round()} m';
    final km = metres / 1000;
    return km < 10 ? '${km.toStringAsFixed(1).replaceAll('.', ',')} km' : '${km.round()} km';
  }
}
