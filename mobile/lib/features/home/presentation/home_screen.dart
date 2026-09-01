import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/home/presentation/home_providers.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:allgo/shared/widgets/product_image.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Accueil — fil de rails plutôt qu'une grille unique : chaque section
/// (populaires, nouveautés, promotions, proximité, historique) répond à un
/// besoin de découverte différent (§1.B). Une section vide se masque plutôt
/// que d'afficher un état vide — l'accueil ne doit jamais avoir l'air cassé
/// simplement parce qu'un rail secondaire n'a rien à montrer.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
            ..invalidate(popularProductsProvider)
            ..invalidate(newProductsProvider)
            ..invalidate(promoProductsProvider)
            ..invalidate(flashPromoProductsProvider)
            ..invalidate(recommendedProductsProvider)
            ..invalidate(popularShopsProvider)
            ..invalidate(nearbyShopsHomeProvider)
            ..invalidate(nearbyProductsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space4),
          children: <Widget>[
            const _CategoryChips(),
            _ProductRail(
              title: 'Recommandé pour vous',
              provider: recommendedProductsProvider,
            ),
            _FlashPromoRail(),
            _ProductRail(title: 'Promotions', provider: promoProductsProvider),
            _ProductRail(title: 'Produits populaires', provider: popularProductsProvider),
            _ShopRailSection(title: 'Boutiques populaires', provider: popularShopsProvider),
            const _NearbyShopRailSection(),
            _ProductRail(title: 'Produits à proximité', provider: nearbyProductsProvider),
            _ProductRail(title: 'Nouveaux produits', provider: newProductsProvider),
            const _RecentlyViewedSection(),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AllGoTokens.space4,
        AllGoTokens.space4,
        AllGoTokens.space4,
        AllGoTokens.space2,
      ),
      child: Text(title, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}

class _CategoryChips extends ConsumerWidget {
  const _CategoryChips();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(categoryTreeProvider);

    return categories.maybeWhen(
      data: (list) => list.isEmpty
          ? const SizedBox.shrink()
          : SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                itemCount: list.length,
                separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space2),
                itemBuilder: (context, i) => ActionChip(
                  avatar: list[i].icon == null ? null : Text(list[i].icon!),
                  label: Text(list[i].name),
                  onPressed: () {
                    ref.read(catalogFilterProvider.notifier).state =
                        ref.read(catalogFilterProvider).copyWith(categoryId: list[i].id);
                    context.push(Routes.explore);
                  },
                ),
              ),
            ),
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// Rail horizontal de produits, alimenté par n'importe quel provider de
/// `home_providers.dart` — même structure pour populaires, nouveautés,
/// promotions, proximité et recommandations.
class _ProductRail extends ConsumerWidget {
  const _ProductRail({required this.title, required this.provider});

  final String title;
  final AutoDisposeFutureProvider<List<Product>> provider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(provider);

    return products.maybeWhen(
      data: (list) => list.isEmpty
          ? const SizedBox.shrink()
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _SectionHeader(title: title),
                SizedBox(
                  height: 220,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
                    itemBuilder: (context, i) =>
                        SizedBox(width: 160, child: ProductCard(product: list[i])),
                  ),
                ),
              ],
            ),
      orElse: () => const SizedBox.shrink(),
    );
  }
}

class _FlashPromoRail extends ConsumerWidget {
  const _FlashPromoRail();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final promos = ref.watch(flashPromoProductsProvider);
    final theme = Theme.of(context);

    return promos.maybeWhen(
      data: (list) => list.isEmpty
          ? const SizedBox.shrink()
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AllGoTokens.space4,
                    AllGoTokens.space4,
                    AllGoTokens.space4,
                    AllGoTokens.space2,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(Icons.bolt, color: theme.colorScheme.error, size: 20),
                      const SizedBox(width: 4),
                      Text('Promotions flash', style: theme.textTheme.titleMedium),
                    ],
                  ),
                ),
                SizedBox(
                  height: 220,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
                    itemBuilder: (context, i) =>
                        SizedBox(width: 160, child: ProductCard(product: list[i].product)),
                  ),
                ),
              ],
            ),
      orElse: () => const SizedBox.shrink(),
    );
  }
}

class _ShopCard extends StatelessWidget {
  const _ShopCard({
    required this.name,
    required this.onTap,
    this.logo,
    this.subtitle,
  });

  final String name;
  final String? logo;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SizedBox(
      width: 120,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
        child: Column(
          children: <Widget>[
            CircleAvatar(
              radius: 32,
              backgroundColor: theme.colorScheme.surfaceContainerHighest,
              backgroundImage: logo == null ? null : CachedNetworkImageProvider(logo!),
              child: logo == null ? const Icon(Icons.storefront_outlined) : null,
            ),
            const SizedBox(height: AllGoTokens.space2),
            Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            if (subtitle != null)
              Text(
                subtitle!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
              ),
          ],
        ),
      ),
    );
  }
}

class _ShopRailSection extends ConsumerWidget {
  const _ShopRailSection({required this.title, required this.provider});

  final String title;
  final AutoDisposeFutureProvider<List<dynamic>> provider;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final shops = ref.watch(provider);

    return shops.maybeWhen(
      data: (list) => list.isEmpty
          ? const SizedBox.shrink()
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _SectionHeader(title: title),
                SizedBox(
                  height: 130,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
                    itemBuilder: (context, i) {
                      final shop = list[i];
                      return _ShopCard(
                        name: shop.name as String,
                        logo: shop.logo as String?,
                        subtitle: shop.city as String?,
                        onTap: () => context.push(Routes.shopPath(shop.slug as String)),
                      );
                    },
                  ),
                ),
              ],
            ),
      orElse: () => const SizedBox.shrink(),
    );
  }
}

class _NearbyShopRailSection extends ConsumerWidget {
  const _NearbyShopRailSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final shops = ref.watch(nearbyShopsHomeProvider);

    return shops.maybeWhen(
      data: (list) => list.isEmpty
          ? const SizedBox.shrink()
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const _SectionHeader(title: 'Boutiques proches'),
                SizedBox(
                  height: 130,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
                    itemBuilder: (context, i) {
                      final NearbyShop shop = list[i];
                      return _ShopCard(
                        name: shop.name,
                        logo: shop.logo,
                        subtitle: DistanceFormat.format(shop.distanceM),
                        onTap: () => context.push(Routes.shopPath(shop.slug)),
                      );
                    },
                  ),
                ),
              ],
            ),
      orElse: () => const SizedBox.shrink(),
    );
  }
}

class _RecentlyViewedSection extends ConsumerWidget {
  const _RecentlyViewedSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(recentProductsLocalProvider);
    final shops = ref.watch(recentShopsLocalProvider);

    if (products.isEmpty && shops.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (products.isNotEmpty) ...<Widget>[
          const _SectionHeader(title: 'Produits récemment consultés'),
          SizedBox(
            height: 56,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              itemCount: products.length,
              separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space2),
              itemBuilder: (context, i) => ActionChip(
                avatar: products[i].thumbUrl == null
                    ? null
                    : CircleAvatar(backgroundImage: CachedNetworkImageProvider(products[i].thumbUrl!)),
                label: Text(products[i].name, overflow: TextOverflow.ellipsis),
                onPressed: () => context.push(Routes.productPath(products[i].id)),
              ),
            ),
          ),
        ],
        if (shops.isNotEmpty) ...<Widget>[
          const _SectionHeader(title: 'Boutiques récemment consultées'),
          SizedBox(
            height: 56,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              itemCount: shops.length,
              separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space2),
              itemBuilder: (context, i) => ActionChip(
                avatar: shops[i].logo == null
                    ? null
                    : CircleAvatar(backgroundImage: CachedNetworkImageProvider(shops[i].logo!)),
                label: Text(shops[i].name, overflow: TextOverflow.ellipsis),
                onPressed: () => context.push(Routes.shopPath(shops[i].slug)),
              ),
            ),
          ),
        ],
        const SizedBox(height: AllGoTokens.space4),
      ],
    );
  }
}

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
                    ProductImage(
                      imageUrl: product.thumbUrl,
                      productName: product.name,
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
