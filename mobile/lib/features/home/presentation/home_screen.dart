import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/favorites/presentation/favorites_controller.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/home/presentation/home_providers.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:allgo/shared/widgets/product_image.dart';
import 'package:allgo/shared/widgets/shimmer.dart';
import 'package:allgo/shared/widgets/shop_avatar.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
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
    final l10n = AppL10n.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: <Widget>[
            const AllGoLogo(size: 28, showWordmark: false),
            const SizedBox(width: AllGoTokens.space2),
            Text(l10n.appName),
          ],
        ),
        actions: <Widget>[
          IconButton(
            onPressed: () => context.push(Routes.map),
            icon: const Icon(Icons.map_outlined),
            tooltip: l10n.homeMapTooltip,
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
        child: _HomeContent(l10n: l10n),
      ),
    );
  }
}

/// Rails à charge commerciale (produits/boutiques) — hors puces de catégorie
/// et « récemment consultés », qui restent utiles même sans catalogue.
final List<AutoDisposeFutureProvider<List<Product>>> _commerceProductProviders =
    <AutoDisposeFutureProvider<List<Product>>>[
  recommendedProductsProvider,
  promoProductsProvider,
  popularProductsProvider,
  nearbyProductsProvider,
  newProductsProvider,
];

/// Bascule entre le fil habituel et une présentation de bienvenue tant que
/// le catalogue ne contient encore aucune boutique ni aucun produit —
/// l'accueil ne doit jamais rester une page blanche pour autant (§1.B), une
/// vitrine vide inspire moins confiance qu'une vitrine qui annonce son
/// ouverture prochaine.
class _HomeContent extends ConsumerWidget {
  const _HomeContent({required this.l10n});

  final AppL10n l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final productLists = _commerceProductProviders.map(ref.watch).toList();
    final popularShops = ref.watch(popularShopsProvider);
    final flashPromos = ref.watch(flashPromoProductsProvider);

    final allSettled = productLists.every((p) => !p.isLoading || p.hasValue) &&
        !popularShops.isLoading &&
        !flashPromos.isLoading;
    final hasAnyContent = productLists.any((p) => (p.valueOrNull ?? const []).isNotEmpty) ||
        (popularShops.valueOrNull ?? const []).isNotEmpty ||
        (flashPromos.valueOrNull ?? const []).isNotEmpty;

    if (allSettled && !hasAnyContent) {
      return const _EmptyHomePlaceholder();
    }

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space4),
      children: <Widget>[
        const _CategoryChips(),
        _ProductRail(title: l10n.homeRecommended, provider: recommendedProductsProvider),
        const _FlashPromoRail(),
        _ProductRail(title: l10n.homePromotions, provider: promoProductsProvider),
        _ProductRail(title: l10n.homePopularProducts, provider: popularProductsProvider),
        _ShopRailSection(title: l10n.homePopularShops, provider: popularShopsProvider),
        const _NearbyShopRailSection(),
        _ProductRail(title: l10n.homeNearbyProducts, provider: nearbyProductsProvider),
        _ProductRail(title: l10n.homeNewProducts, provider: newProductsProvider),
        const _RecentlyViewedSection(),
      ],
    );
  }
}

/// Présentation affichée tant qu'aucune boutique ni aucun produit n'est
/// encore en ligne — remplacée automatiquement par le fil habituel dès que
/// la base contient du contenu réel, sans aucun changement de code.
class _EmptyHomePlaceholder extends StatelessWidget {
  const _EmptyHomePlaceholder();

  @override
  Widget build(BuildContext context) {
    final l10n = AppL10n.of(context);
    final theme = Theme.of(context);

    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(AllGoTokens.space6),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: AllGoTokens.brand.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: const Padding(
                      padding: EdgeInsets.all(AllGoTokens.space4),
                      child: AllGoLogo(size: 64, showWordmark: false),
                    ),
                  ),
                  const SizedBox(height: AllGoTokens.space4),
                  Text(
                    l10n.homeEmptyTitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: AllGoTokens.space2),
                  Text(
                    l10n.homeEmptyMessage,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                  ),
                  const SizedBox(height: AllGoTokens.space4),
                  OutlinedButton.icon(
                    onPressed: () => context.push(Routes.explore),
                    icon: const Icon(Icons.storefront_outlined),
                    label: Text(l10n.homeEmptyCta),
                  ),
                ],
              ),
            ),
          ),
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

/// Icônes Material par nom de slug — le serveur envoie `"restaurant"`,
/// `"checkroom"`, etc. (§ modèle `Category`), jamais un `IconData` : sans
/// cette table, l'avatar de la puce affichait le nom brut en texte, qui
/// débordait de la petite pastille prévue pour une icône.
const Map<String, IconData> _categoryIconBySlug = <String, IconData>{
  'restaurant': Icons.restaurant_outlined,
  'shopping_basket': Icons.shopping_basket_outlined,
  'local_drink': Icons.local_drink_outlined,
  'checkroom': Icons.checkroom_outlined,
  'spa': Icons.spa_outlined,
  'devices': Icons.devices_outlined,
  'chair': Icons.chair_outlined,
  'medical_services': Icons.medical_services_outlined,
  'build': Icons.build_outlined,
  'sports_soccer': Icons.sports_soccer_outlined,
  'child_care': Icons.child_care_outlined,
  'menu_book': Icons.menu_book_outlined,
  'local_florist': Icons.local_florist_outlined,
  'directions_car': Icons.directions_car_filled_outlined,
  'two_wheeler': Icons.two_wheeler_outlined,
  'handyman': Icons.handyman_outlined,
};

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
                  avatar: Icon(
                    _categoryIconBySlug[list[i].icon] ?? Icons.category_outlined,
                    size: 18,
                  ),
                  label: Text(list[i].name),
                  onPressed: () {
                    ref.read(catalogFilterProvider.notifier).state =
                        ref.read(catalogFilterProvider).copyWith(categoryId: list[i].id);
                    context.push(Routes.explore);
                  },
                ),
              ),
            ),
      loading: () => const ChipRailSkeleton(),
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
      loading: () => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _SectionHeader(title: title),
          const CardRailSkeleton(),
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
                      Text(AppL10n.of(context).homeFlashPromotions, style: theme.textTheme.titleMedium),
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
      loading: () => Column(
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
                Text(AppL10n.of(context).homeFlashPromotions, style: theme.textTheme.titleMedium),
              ],
            ),
          ),
          const CardRailSkeleton(),
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
    this.categoryName,
    this.subtitle,
  });

  final String name;
  final String? logo;
  final String? categoryName;
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
            ShopAvatar(name: name, logoUrl: logo, categoryName: categoryName, size: 64),
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
                        categoryName: shop.categoryName as String?,
                        subtitle: shop.city as String?,
                        onTap: () => context.push(Routes.shopPath(shop.slug as String)),
                      );
                    },
                  ),
                ),
              ],
            ),
      loading: () => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _SectionHeader(title: title),
          const CircleRailSkeleton(),
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
                _SectionHeader(title: AppL10n.of(context).homeNearbyShops),
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
                        categoryName: shop.categoryName,
                        subtitle: DistanceFormat.format(shop.distanceM),
                        onTap: () => context.push(Routes.shopPath(shop.slug)),
                      );
                    },
                  ),
                ),
              ],
            ),
      loading: () => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _SectionHeader(title: AppL10n.of(context).homeNearbyShops),
          const CircleRailSkeleton(),
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
          _SectionHeader(title: AppL10n.of(context).homeRecentProducts),
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
          _SectionHeader(title: AppL10n.of(context).homeRecentShops),
          SizedBox(
            height: 56,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              itemCount: shops.length,
              separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space2),
              itemBuilder: (context, i) => ActionChip(
                avatar: ShopAvatar(name: shops[i].name, logoUrl: shops[i].logo, size: 24),
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

class ProductCard extends ConsumerWidget {
  const ProductCard({required this.product, super.key});

  final Product product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.error,
                          borderRadius: BorderRadius.circular(AllGoTokens.radiusPill),
                        ),
                        child: Text(
                          '-$discount%',
                          style: TextStyle(
                            color: theme.colorScheme.onError,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),

                  Positioned(
                    top: AllGoTokens.space2,
                    right: AllGoTokens.space2,
                    child: _WishlistButton(productId: product.id),
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
                  if (product.rating != null) ...<Widget>[
                    const SizedBox(height: AllGoTokens.space1),
                    Row(
                      children: <Widget>[
                        const Icon(Icons.star_rounded, size: 15, color: AllGoTokens.warning),
                        const SizedBox(width: 2),
                        Text(
                          product.reviewCount > 0
                              ? '${product.rating!.toStringAsFixed(1)} · ${product.reviewCount} avis'
                              : product.rating!.toStringAsFixed(1),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.outline,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cœur de mise en favori directement sur la vignette — jusqu'ici réservé à
/// la fiche produit, alors que c'est sur la grille de résultats qu'on
/// compare et trie le plus vite (référence design : icône superposée à
/// l'image, jamais un bouton séparé sous la carte).
class _WishlistButton extends ConsumerWidget {
  const _WishlistButton({required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final favorites = ref.watch(favoritesControllerProvider);
    final isFavorite = favorites.valueOrNull?.contains(productId) ?? false;

    return Material(
      color: Colors.white.withValues(alpha: 0.9),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: () async {
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
            // Le jeton de rafraîchissement a lui-même expiré : contrairement
            // à un simple refus métier, c'est un signal qu'aucune autre
            // vignette ne pourra plus honorer tant qu'on ne s'est pas
            // reconnecté.
            if (failure is UnauthenticatedFailure) {
              if (context.mounted) {
                await context.push(
                  '${Routes.login}?redirect=${Uri.encodeComponent(Routes.productPath(productId))}',
                );
              }
              return;
            }
            // Un cœur qui revient à son état initial sans un mot laisse
            // croire à une panne (référence : `_FavoriteButton` de la fiche
            // produit, qui applique déjà cette règle).
            messenger.showSnackBar(
              SnackBar(
                content: Text(failure is Failure ? failure.displayMessage : 'Action impossible.'),
              ),
            );
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(
            isFavorite ? Icons.favorite : Icons.favorite_border,
            size: 18,
            color: isFavorite ? AllGoTokens.danger : Colors.black87,
          ),
        ),
      ),
    );
  }
}
