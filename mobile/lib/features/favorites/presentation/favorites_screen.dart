import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/features/favorites/presentation/favorite_products_providers.dart';
import 'package:allgo/features/favorites/presentation/favorites_controller.dart';
import 'package:allgo/features/favorites/presentation/followed_shops_providers.dart';
import 'package:allgo/features/home/presentation/home_screen.dart' show ProductCard;
import 'package:allgo/features/shops/presentation/shop_follow_controller.dart';
import 'package:allgo/features/shops/presentation/widgets/shop_card.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Mes favoris'),
          bottom: const TabBar(
            tabs: <Widget>[
              Tab(text: 'Produits'),
              Tab(text: 'Boutiques'),
            ],
          ),
        ),
        body: const TabBarView(
          children: <Widget>[_FavoriteProductsTab(), _FollowedShopsTab()],
        ),
      ),
    );
  }
}

class _FavoriteProductsTab extends ConsumerWidget {
  const _FavoriteProductsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(favoriteProductsControllerProvider);

    return AsyncView<FavoriteProductsState>(
      value: state,
      isEmpty: (s) => s.items.isEmpty,
      emptyTitle: 'Aucun produit favori',
      emptyMessage: 'Touchez le cœur d’une fiche produit pour la retrouver ici.',
      onRetry: () => ref.invalidate(favoriteProductsControllerProvider),
      data: (s) => NotificationListener<ScrollNotification>(
        onNotification: (notification) {
          if (notification.metrics.extentAfter < 300) {
            unawaited(ref.read(favoriteProductsControllerProvider.notifier).loadMore());
          }
          return false;
        },
        child: GridView.builder(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 220,
            mainAxisSpacing: AllGoTokens.space3,
            crossAxisSpacing: AllGoTokens.space3,
            childAspectRatio: 0.72,
          ),
          itemCount: s.items.length,
          itemBuilder: (context, i) {
            final product = s.items[i];
            return Stack(
              children: <Widget>[
                ProductCard(product: product),
                Positioned(
                  top: 4,
                  right: 4,
                  child: _RemoveButton(
                    onPressed: () async {
                      final messenger = ScaffoldMessenger.of(context);
                      ref.read(favoriteProductsControllerProvider.notifier).removeLocally(product.id);
                      try {
                        // Attendre que l'état des identifiants soit chargé avant de
                        // basculer : sinon `toggle` le trouve vide (le fournisseur
                        // n'a jamais été observé ailleurs sur ce trajet) et RÉ-ajoute
                        // le favori au lieu de le retirer.
                        await ref.read(favoritesControllerProvider.future);
                        await ref.read(favoritesControllerProvider.notifier).toggle(product.id);
                      } on DioException {
                        messenger.showSnackBar(
                          const SnackBar(content: Text('Retrait impossible. Réessayez.')),
                        );
                        ref.invalidate(favoriteProductsControllerProvider);
                      }
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _FollowedShopsTab extends ConsumerWidget {
  const _FollowedShopsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(followedShopsControllerProvider);

    return AsyncView<FollowedShopsState>(
      value: state,
      isEmpty: (s) => s.items.isEmpty,
      emptyTitle: 'Aucune boutique suivie',
      emptyMessage: 'Suivez une boutique depuis sa fiche pour la retrouver ici.',
      onRetry: () => ref.invalidate(followedShopsControllerProvider),
      data: (s) => NotificationListener<ScrollNotification>(
        onNotification: (notification) {
          if (notification.metrics.extentAfter < 300) {
            unawaited(ref.read(followedShopsControllerProvider.notifier).loadMore());
          }
          return false;
        },
        child: GridView.builder(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 220,
            mainAxisSpacing: AllGoTokens.space3,
            crossAxisSpacing: AllGoTokens.space3,
            childAspectRatio: 0.85,
          ),
          itemCount: s.items.length,
          itemBuilder: (context, i) {
            final shop = s.items[i];
            return Stack(
              children: <Widget>[
                ShopCard(slug: shop.slug, name: shop.name, logo: shop.logo, city: shop.city, rating: shop.rating),
                Positioned(
                  top: 4,
                  right: 4,
                  child: _RemoveButton(
                    onPressed: () async {
                      final messenger = ScaffoldMessenger.of(context);
                      ref.read(followedShopsControllerProvider.notifier).removeLocally(shop.id);
                      try {
                        // Voir le commentaire équivalent dans l'onglet Produits.
                        await ref.read(shopFollowControllerProvider.future);
                        await ref.read(shopFollowControllerProvider.notifier).toggle(shop.id);
                      } on DioException {
                        messenger.showSnackBar(
                          const SnackBar(content: Text('Retrait impossible. Réessayez.')),
                        );
                        ref.invalidate(followedShopsControllerProvider);
                      }
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _RemoveButton extends StatelessWidget {
  const _RemoveButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black45,
      shape: const CircleBorder(),
      child: IconButton(
        onPressed: onPressed,
        icon: const Icon(Icons.close, color: Colors.white, size: 18),
        tooltip: 'Retirer',
        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
        padding: EdgeInsets.zero,
      ),
    );
  }
}
