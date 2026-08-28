/// Boutique résumée pour un carrousel (accueil, historique local).
///
/// Volontairement plus léger que `ShopDetail` (`shop_screen.dart`) : les
/// rails n'affichent qu'une carte, jamais la fiche complète.
class ShopSummary {
  const ShopSummary({
    required this.id,
    required this.slug,
    required this.name,
    this.logo,
    this.city,
    this.rating = 0,
    this.followerCount = 0,
    this.distanceM,
    this.categoryId,
    this.categoryName,
    this.deliveryAvailable = true,
    this.pickupAvailable = false,
  });

  final String id;
  final String slug;
  final String name;
  final String? logo;
  final String? city;
  final double rating;
  final int followerCount;
  final int? distanceM;
  final String? categoryId;
  final String? categoryName;
  final bool deliveryAvailable;
  final bool pickupAvailable;
}
