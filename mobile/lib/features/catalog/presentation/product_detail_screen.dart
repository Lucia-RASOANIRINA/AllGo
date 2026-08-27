import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/favorites/presentation/favorites_controller.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
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

class _Content extends StatelessWidget {
  const _Content({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context) {
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
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: product.gallery.isEmpty
                ? ColoredBox(color: theme.colorScheme.surfaceContainerHighest)
                : PageView.builder(
                    itemCount: product.gallery.length,
                    itemBuilder: (_, i) => CachedNetworkImage(
                      imageUrl: product.gallery[i],
                      fit: BoxFit.cover,
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
                  leading: const CircleAvatar(child: Icon(Icons.storefront_outlined)),
                  title: Text(product.shopName),
                  subtitle: const Text('Voir la boutique'),
                  trailing: const Icon(Icons.chevron_right),
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
      ],
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
          content: Text('${product.name} ajouté au panier'),
          action: SnackBarAction(
            label: 'Voir',
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
