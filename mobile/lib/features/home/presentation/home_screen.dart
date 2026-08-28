import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/geo/domain/nearby_product.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/features/home/presentation/home_providers.dart';
import 'package:allgo/features/home/presentation/widgets/home_section.dart';
import 'package:allgo/features/shops/domain/shop_summary.dart';
import 'package:allgo/features/shops/presentation/widgets/shop_card.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feed = ref.watch(catalogProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: <Widget>[
            AllGoLogo(size: 28, showWordmark: false),
            SizedBox(width: AllGoTokens.space2),
            Text('AllGo'),
          ],
        ),
        actions: <Widget>[
          IconButton(
            onPressed: () => context.push(Routes.map),
            icon: const Icon(Icons.map_outlined),
            tooltip: 'Commerces à proximité',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(catalogProvider)
            ..invalidate(categoryTreeProvider)
            ..invalidate(newProductsProvider)
            ..invalidate(popularProductsProvider)
            ..invalidate(promoProductsProvider)
            ..invalidate(flashPromoProductsProvider)
            ..invalidate(popularShopsProvider)
            ..invalidate(nearbyShopsHomeProvider)
            ..invalidate(nearbyProductsHomeProvider)
            ..invalidate(recommendedProductsProvider)
            ..invalidate(recentShopsLocalProvider)
            ..invalidate(recentProductsLocalProvider);
        },
        child: CustomScrollView(
          slivers: <Widget>[
            SliverToBoxAdapter(child: _buildCategoryRail(context, ref)),
            SliverToBoxAdapter(
              child: HomeSection<Product>(
                title: 'Promotions flash',
                items: ref.watch(flashPromoProductsProvider).valueOrNull ?? const <Product>[],
                itemBuilder: (context, product) => ProductCard(product: product),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<Product>(
                title: 'Promotions',
                items: ref.watch(promoProductsProvider).valueOrNull ?? const <Product>[],
                itemBuilder: (context, product) => ProductCard(product: product),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<Product>(
                title: 'Nouveaux produits',
                items: ref.watch(newProductsProvider).valueOrNull ?? const <Product>[],
                itemBuilder: (context, product) => ProductCard(product: product),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<Product>(
                title: 'Produits populaires',
                items: ref.watch(popularProductsProvider).valueOrNull ?? const <Product>[],
                itemBuilder: (context, product) => ProductCard(product: product),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<ShopSummary>(
                title: 'Boutiques populaires',
                items: ref.watch(popularShopsProvider).valueOrNull ?? const <ShopSummary>[],
                height: 176,
                itemBuilder: (context, shop) => ShopCard(
                  slug: shop.slug,
                  name: shop.name,
                  logo: shop.logo,
                  city: shop.city,
                  rating: shop.rating,
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<NearbyShop>(
                title: 'Boutiques proches',
                items: ref.watch(nearbyShopsHomeProvider).valueOrNull ?? const <NearbyShop>[],
                height: 176,
                itemBuilder: (context, shop) => ShopCard(
                  slug: shop.slug,
                  name: shop.name,
                  logo: shop.logo,
                  city: shop.city,
                  rating: shop.rating,
                  distanceM: shop.distanceM,
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<NearbyProduct>(
                title: 'Produits proches',
                items:
                    ref.watch(nearbyProductsHomeProvider).valueOrNull ?? const <NearbyProduct>[],
                itemBuilder: (context, product) =>
                    ProductCard(product: _productFromNearby(product)),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<Product>(
                title: 'Recommandé pour vous',
                items: ref.watch(recommendedProductsProvider).valueOrNull ?? const <Product>[],
                itemBuilder: (context, product) => ProductCard(product: product),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<RecentlyViewedShop>(
                title: 'Boutiques récemment consultées',
                items: ref.watch(recentShopsLocalProvider).valueOrNull ??
                    const <RecentlyViewedShop>[],
                height: 176,
                itemBuilder: (context, shop) =>
                    ShopCard(slug: shop.slug, name: shop.name, logo: shop.logo),
              ),
            ),
            SliverToBoxAdapter(
              child: HomeSection<RecentlyViewedProduct>(
                title: 'Produits récemment consultés',
                items: ref.watch(recentProductsLocalProvider).valueOrNull ??
                    const <RecentlyViewedProduct>[],
                itemBuilder: (context, product) =>
                    ProductCard(product: _productFromRecentlyViewed(product)),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              sliver: SliverToBoxAdapter(
                child: Text('Fil d’actualité', style: theme.textTheme.titleMedium),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AllGoTokens.space2)),
            feed.when(
              loading: () => const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(AllGoTokens.space8),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ),
              error: (error, _) => SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(AllGoTokens.space8),
                  child: Center(
                    child: Column(
                      children: <Widget>[
                        const Text('Impossible de charger le fil d’actualité.'),
                        const SizedBox(height: AllGoTokens.space3),
                        FilledButton(
                          onPressed: () => ref.invalidate(catalogProvider),
                          child: const Text('Réessayer'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              data: (list) => list.isEmpty
                  ? const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.all(AllGoTokens.space8),
                        child: Center(child: Text('Aucun produit pour le moment.')),
                      ),
                    )
                  : SliverPadding(
                      padding: const EdgeInsets.all(AllGoTokens.space4),
                      sliver: SliverGrid.builder(
                        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 220,
                          mainAxisSpacing: AllGoTokens.space3,
                          crossAxisSpacing: AllGoTokens.space3,
                          childAspectRatio: 0.72,
                        ),
                        itemCount: list.length,
                        itemBuilder: (context, i) => ProductCard(product: list[i]),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

Widget _buildCategoryRail(BuildContext context, WidgetRef ref) {
  final categories = ref.watch(categoryTreeProvider).valueOrNull ?? const <Category>[];

  return CategoryRail(
    categories:
        categories.map((c) => (id: c.id, name: c.name, icon: c.icon)).toList(growable: false),
    onTap: (categoryId) {
      ref.read(catalogFilterProvider.notifier).state = ProductFilter(categoryId: categoryId);
      unawaited(context.push(Routes.explore));
    },
  );
}

/// Adapte un résultat de proximité au type attendu par `ProductCard` —
/// évite de dupliquer la carte pour chaque rail (§ accueil).
Product _productFromNearby(NearbyProduct product) => Product(
      id: product.id,
      shopId: product.shopId ?? '',
      shopName: product.shopName ?? '',
      shopSlug: '',
      name: product.name,
      price: product.price,
      promoPrice: product.promoPrice,
      thumbUrl: product.thumbUrl,
      stock: 1,
    );

Product _productFromRecentlyViewed(RecentlyViewedProduct product) => Product(
      id: product.id,
      shopId: product.shopId,
      shopName: product.shopName,
      shopSlug: '',
      name: product.name,
      price: product.price,
      promoPrice: product.promoPrice,
      thumbUrl: product.thumbUrl,
      stock: 1,
    );

class ProductCard extends StatelessWidget {
  const ProductCard({required this.product, super.key});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final price = Ariary.formatWithPromo(product.price, product.promoPrice);
    final discount = Ariary.discountPercent(product.price, product.promoPrice);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(Routes.productPath(product.id)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  // Miniature 200 px générée par le serveur : un téléphone ne
                  // télécharge jamais une image de 4 Mo (§5.1).
                  if (product.thumbUrl != null)
                    CachedNetworkImage(
                      imageUrl: product.thumbUrl!,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => ColoredBox(
                        color: theme.colorScheme.surfaceContainerHighest,
                      ),
                      errorWidget: (_, __, ___) => const Icon(Icons.image_not_supported),
                    )
                  else
                    ColoredBox(color: theme.colorScheme.surfaceContainerHighest),

                  if (discount != null)
                    Positioned(
                      top: AllGoTokens.space2,
                      left: AllGoTokens.space2,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.error,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '-$discount %',
                          style: TextStyle(
                            color: theme.colorScheme.onError,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),

                  if (!product.isAvailable)
                    // L'indisponibilité n'est jamais portée par la couleur
                    // seule : un texte l'énonce (§11.4).
                    const Positioned.fill(
                      child: ColoredBox(
                        color: Colors.black54,
                        child: Center(
                          child: Text(
                            'Épuisé',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AllGoTokens.space2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium,
                  ),
                  const SizedBox(height: AllGoTokens.space1),
                  Text(
                    price.current,
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: AllGoTokens.brand,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (price.original != null)
                    Text(
                      price.original!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        decoration: TextDecoration.lineThrough,
                        color: theme.colorScheme.outline,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
