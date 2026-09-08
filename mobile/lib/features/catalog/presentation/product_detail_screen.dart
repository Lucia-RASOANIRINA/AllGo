import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/storage/recently_viewed_store.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/favorites/presentation/favorites_controller.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/features/moderation/presentation/moderation_actions.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/product_image.dart';
import 'package:allgo/shared/widgets/shop_avatar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

class ProductDetailScreen extends ConsumerWidget {
  const ProductDetailScreen({required this.productId, super.key});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final product = ref.watch(productDetailProvider(productId));

    // Historique local « récemment consulté » (accueil) — enregistré une
    // seule fois par arrivée de données, jamais à chaque reconstruction.
    ref.listen(productDetailProvider(productId), (_, next) {
      next.whenData((p) {
        ref.read(recentlyViewedStoreProvider).addProduct(
              RecentlyViewedProduct(
                id: p.id,
                name: p.name,
                categoryId: p.categoryId,
                thumbUrl: p.thumbUrl,
                price: p.price,
              ),
            );
      });
    });

    return Scaffold(
      body: AsyncView<Product>(
        value: product,
        isEmpty: (_) => false,
        emptyTitle: '',
        onRetry: () => ref.invalidate(productDetailProvider(productId)),
        data: (p) => _Content(product: p),
      ),
      bottomNavigationBar: product.maybeWhen(
        data: (p) => _AddToCartBar(product: p),
        orElse: () => null,
      ),
    );
  }
}

class _Content extends ConsumerWidget {
  const _Content({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final price = Ariary.formatWithPromo(product.price, product.promoPrice);

    return CustomScrollView(
      slivers: <Widget>[
        SliverAppBar(
          expandedHeight: 320,
          pinned: true,
          actions: <Widget>[
            IconButton(
              // Partage natif vers WhatsApp, Facebook, SMS (§2.2) — le canal
              // de bouche-à-oreille dominant à Mahajanga.
              onPressed: () => Share.share(
                '${product.name} — ${price.current} sur AllGo\n'
                'https://allgo.mg/produit/${product.id}',
              ),
              icon: const Icon(Icons.share_outlined),
              tooltip: 'Partager',
            ),
            IconButton(
              onPressed: () => reportViaDialog(
                context,
                ref,
                path: '/moderation/products/${product.id}/report',
                dialogTitle: 'Signaler ce produit',
                successMessage: 'Produit signalé à la modération.',
              ),
              icon: const Icon(Icons.flag_outlined),
              tooltip: 'Signaler',
            ),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: product.gallery.isEmpty
                ? ColoredBox(color: theme.colorScheme.surfaceContainerHighest)
                : PageView.builder(
                    itemCount: product.gallery.length,
                    itemBuilder: (_, i) => ProductImage(
                      imageUrl: product.gallery[i],
                      productName: product.name,
                    ),
                  ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                // Une fiche affichée depuis le cache le dit : mieux vaut une
                // information datée annoncée qu'une information datée cachée.
                if (product.isFromCache) const OfflineBanner(),

                Text(product.name, style: theme.textTheme.headlineSmall),
                const SizedBox(height: AllGoTokens.space2),

                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: <Widget>[
                    Text(
                      price.current,
                      style: theme.textTheme.headlineMedium?.copyWith(
                        color: AllGoTokens.brand,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (price.original != null) ...<Widget>[
                      const SizedBox(width: AllGoTokens.space2),
                      Text(
                        price.original!,
                        style: theme.textTheme.titleMedium?.copyWith(
                          decoration: TextDecoration.lineThrough,
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ],
                ),

                const SizedBox(height: AllGoTokens.space3),
                Row(
                  children: <Widget>[
                    Icon(
                      product.isAvailable
                          ? Icons.check_circle_outline
                          : Icons.remove_circle_outline,
                      size: 18,
                      color: product.isAvailable ? AllGoTokens.success : theme.colorScheme.error,
                    ),
                    const SizedBox(width: AllGoTokens.space1),
                    Text(
                      product.isAvailable ? '${product.stock} en stock' : 'Épuisé',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),

                const SizedBox(height: AllGoTokens.space6),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: ShopAvatar(name: product.shopName),
                  title: Text(product.shopName),
                  subtitle: const Text('Voir la boutique'),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      _MessageShopButton(
                        productId: product.id,
                        shopId: product.shopId,
                        shopName: product.shopName,
                      ),
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                  // Un produit mis en cache par une version antérieure peut ne
                  // pas connaître le slug : la ligne devient alors inerte
                  // plutôt que d'ouvrir une page introuvable.
                  onTap: product.shopSlug.isEmpty
                      ? null
                      : () => context.push(Routes.shopPath(product.shopSlug)),
                ),

                if (product.description != null) ...<Widget>[
                  const Divider(height: AllGoTokens.space8),
                  Text('Description', style: theme.textTheme.titleMedium),
                  const SizedBox(height: AllGoTokens.space2),
                  Text(product.description!, style: theme.textTheme.bodyMedium),
                ],

                const SizedBox(height: AllGoTokens.space8),
              ],
            ),
          ),
        ),
        _SimilarProductsSliver(productId: product.id),
        const SliverToBoxAdapter(child: SizedBox(height: AllGoTokens.space6)),
      ],
    );
  }
}

class _SimilarProductsSliver extends ConsumerWidget {
  const _SimilarProductsSliver({required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final similar = ref.watch(similarProductsProvider(productId));

    return similar.maybeWhen(
      data: (list) => list.isEmpty
          ? const SliverToBoxAdapter(child: SizedBox.shrink())
          : SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AllGoTokens.space4,
                      AllGoTokens.space6,
                      AllGoTokens.space4,
                      AllGoTokens.space2,
                    ),
                    child: Text('Produits similaires', style: theme.textTheme.titleMedium),
                  ),
                  SizedBox(
                    height: 220,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
                      itemBuilder: (context, i) => SizedBox(
                        width: 160,
                        child: Card(
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            onTap: () => context.push(Routes.productPath(list[i].id)),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Expanded(
                                  child: list[i].thumbUrl == null
                                      ? ColoredBox(color: theme.colorScheme.surfaceContainerHighest)
                                      : ProductImage(imageUrl: list[i].thumbUrl, productName: list[i].name),
                                ),
                                Padding(
                                  padding: const EdgeInsets.all(AllGoTokens.space2),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: <Widget>[
                                      Text(
                                        list[i].name,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: theme.textTheme.bodyMedium,
                                      ),
                                      Text(
                                        Ariary.formatWithPromo(list[i].price, list[i].promoPrice).current,
                                        style: theme.textTheme.titleSmall
                                            ?.copyWith(color: AllGoTokens.brand, fontWeight: FontWeight.w700),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
      orElse: () => const SliverToBoxAdapter(child: SizedBox.shrink()),
    );
  }
}

/// Cœur des favoris. Invite à se connecter plutôt que d'échouer en silence :
/// un bouton qui ne fait rien laisse croire à une panne.
class _FavoriteButton extends ConsumerWidget {
  const _FavoriteButton({required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final favorites = ref.watch(favoritesControllerProvider);
    final isFavorite = favorites.valueOrNull?.contains(productId) ?? false;

    return IconButton.outlined(
      onPressed: () async {
        if (!session.isAuthenticated) {
          await context.push(
            '${Routes.login}?redirect=${Uri.encodeComponent(Routes.productPath(productId))}',
          );
          return;
        }

        final messenger = ScaffoldMessenger.of(context);
        try {
          await ref.read(favoritesControllerProvider.notifier).toggle(productId);
        } on DioException catch (error) {
          final failure = error.error;
          // Le jeton de rafraîchissement a lui-même expiré entre l'ouverture
          // de la fiche et ce tap : un message ne suffit plus, il faut
          // reconduire vers la connexion, comme pour le cas déjà authentifié
          // plus haut.
          if (failure is UnauthenticatedFailure) {
            if (context.mounted) {
              await context.push(
                '${Routes.login}?redirect=${Uri.encodeComponent(Routes.productPath(productId))}',
              );
            }
            return;
          }
          messenger.showSnackBar(
            SnackBar(
              content: Text(
                failure is Failure ? failure.displayMessage : 'Action impossible.',
              ),
            ),
          );
        }
      },
      icon: Icon(isFavorite ? Icons.favorite : Icons.favorite_border),
      color: isFavorite ? Theme.of(context).colorScheme.error : null,
      tooltip: isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
    );
  }
}

/// Écrire à la boutique directement depuis la fiche produit — jusqu'ici il
/// fallait ouvrir la page boutique pour trouver ce bouton, alors que c'est en
/// consultant un produit qu'une question se pose le plus souvent.
class _MessageShopButton extends ConsumerWidget {
  const _MessageShopButton({
    required this.productId,
    required this.shopId,
    required this.shopName,
  });

  final String productId;
  final String shopId;
  final String shopName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);

    return IconButton(
      onPressed: () async {
        if (!session.isAuthenticated) {
          await context.push(
            '${Routes.login}?redirect=${Uri.encodeComponent(Routes.productPath(productId))}',
          );
          return;
        }

        final messenger = ScaffoldMessenger.of(context);
        try {
          final conversationId = await startConversationWithShop(ref, shopId);
          if (context.mounted) {
            context.push(Routes.messagePath(conversationId), extra: shopName);
          }
        } on DioException {
          messenger.showSnackBar(
            const SnackBar(content: Text('Impossible d’ouvrir la conversation.')),
          );
        }
      },
      icon: const Icon(Icons.chat_bubble_outline),
      tooltip: 'Envoyer un message à la boutique',
    );
  }
}

class _AddToCartBar extends ConsumerWidget {
  const _AddToCartBar({required this.product});

  final Product product;

  Future<void> _addToCart(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);

    try {
      // Mise à jour optimiste : le panier reflète l'ajout immédiatement, avant
      // confirmation du serveur (§8.2). Hors ligne, l'action part en file
      // d'attente sans effet visible différent — c'est tout l'intérêt.
      await ref.read(cartControllerProvider.notifier).add(product);

      messenger.showSnackBar(
        SnackBar(
          // Flottante, arrondie, avec une icône de confirmation — le
          // bandeau gris par défaut ne distinguait pas un ajout réussi
          // d'un message d'erreur (référence design : confirmation
          // positive des applications marchandes).
          behavior: SnackBarBehavior.floating,
          backgroundColor: AllGoTokens.brand,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
          ),
          margin: const EdgeInsets.all(AllGoTokens.space4),
          content: Row(
            children: <Widget>[
              const Icon(Icons.check_circle, color: Colors.white, size: 20),
              const SizedBox(width: AllGoTokens.space3),
              Expanded(
                child: Text(
                  '${product.name} ajouté au panier',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          action: SnackBarAction(
            label: 'Voir',
            textColor: Colors.white,
            onPressed: () => context.go(Routes.cart),
          ),
        ),
      );
    } on DioException catch (error) {
      // Refus argumenté du serveur : le message est déjà localisé (§7.2).
      final failure = error.error;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            failure is Failure ? failure.displayMessage : 'Ajout impossible.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        child: Row(
          children: <Widget>[
            _FavoriteButton(productId: product.id),
            const SizedBox(width: AllGoTokens.space3),
            Expanded(
              child: FilledButton.icon(
                onPressed: product.isAvailable ? () => _addToCart(context, ref) : null,
                icon: const Icon(Icons.add_shopping_cart),
                label: Text(product.isAvailable ? 'Ajouter au panier' : 'Indisponible'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
