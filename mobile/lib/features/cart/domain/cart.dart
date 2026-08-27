import 'package:freezed_annotation/freezed_annotation.dart';

part 'cart.freezed.dart';

@freezed
abstract class CartLine with _$CartLine {
  const factory CartLine({
    required String id,
    required String productId,
    required String name,
    required int unitPrice,
    required int quantity,
    required String shopId,
    required String shopName,
    String? image,
    String? variantId,

    /// Ligne ajoutée hors ligne, pas encore confirmée par le serveur.
    /// L'interface la signale : afficher une ligne comme acquise alors qu'elle
    /// peut encore échouer serait mentir à l'utilisateur.
    @Default(false) bool isPending,
  }) = _CartLine;

  const CartLine._();

  int get subtotal => unitPrice * quantity;
}

@freezed
abstract class Cart with _$Cart {
  const factory Cart({
    @Default(<CartLine>[]) List<CartLine> lines,
  }) = _Cart;

  const Cart._();

  bool get isEmpty => lines.isEmpty;

  int get itemCount => lines.fold(0, (sum, line) => sum + line.quantity);

  int get subtotal => lines.fold(0, (sum, line) => sum + line.subtotal);

  /// Regroupement par boutique.
  ///
  /// Le tunnel de commande le rend explicite : un panier de trois boutiques
  /// produit **trois commandes** distinctes, chacune avec son suivi et sa
  /// livraison (§8.2). L'utilisateur doit le savoir avant de confirmer.
  Map<String, List<CartLine>> get byShop {
    final grouped = <String, List<CartLine>>{};
    for (final line in lines) {
      grouped.putIfAbsent(line.shopId, () => <CartLine>[]).add(line);
    }
    return grouped;
  }

  bool get hasPendingLines => lines.any((line) => line.isPending);
}
