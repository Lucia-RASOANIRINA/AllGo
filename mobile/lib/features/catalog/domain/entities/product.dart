import 'package:freezed_annotation/freezed_annotation.dart';

part 'product.freezed.dart';

/// Produit — entité de domaine.
///
/// La couche `domain` ne dépend d'AUCUNE bibliothèque externe hors `freezed`
/// (§4.3) : ni Flutter, ni Dio, ni Drift. Elle reste donc testable sans
/// émulateur ni réseau, ce qui est la condition de la couverture ≥ 80 % exigée
/// au §16.1.
// `abstract` est requis par freezed 3.x : la classe annotée n'est plus qu'une
// façade, l'implémentation vit dans le fichier généré.
@freezed
abstract class Product with _$Product {
  const factory Product({
    required String id,
    required String shopId,
    required String shopName,

    /// Identifiant lisible de la boutique — sert à ouvrir `/boutique/:slug`.
    required String shopSlug,
    required String name,
    required int price,
    required int stock,
    String? description,
    String? categoryId,
    int? promoPrice,
    String? thumbUrl,
    String? previewUrl,
    String? barcode,
    @Default(<String>[]) List<String> gallery,
    double? latitude,
    double? longitude,
    double? rating,
    @Default(0) int reviewCount,

    /// Vrai lorsque la fiche provient du cache local et peut être périmée.
    /// L'interface l'indique discrètement plutôt que de mentir sur la fraîcheur.
    @Default(false) bool isFromCache,
  }) = _Product;

  const Product._();

  bool get isAvailable => stock > 0;

  /// Prix effectivement facturé.
  int get effectivePrice => promoPrice != null && promoPrice! < price ? promoPrice! : price;
}
