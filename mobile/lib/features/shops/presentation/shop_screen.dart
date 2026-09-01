import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Boutique telle que renvoyée par `GET /shops/:slug`.
class ShopDetail {
  const ShopDetail({
    required this.id,
    required this.slug,
    required this.name,
    this.description,
    this.logo,
    this.banner,
    this.city,
    this.categoryName,
    this.phone,
    this.whatsapp,
    this.rating = 0,
    this.reviewCount = 0,
    this.productCount = 0,
    this.followerCount = 0,
    this.openingHours = const <({int day, String open, String close})>[],
  });

  final String id;
  final String slug;
  final String name;
  final String? description;
  final String? logo;
  final String? banner;
  final String? city;
  final String? categoryName;
  final String? phone;
  final String? whatsapp;
  final double rating;
  final int reviewCount;
  final int productCount;
  final int followerCount;
  final List<({int day, String open, String close})> openingHours;

  /// Horaires du jour, si la boutique en déclare pour aujourd'hui.
  ({int day, String open, String close})? get todayHours {
    final today = DateTime.now().weekday; // 1 = lundi … 7 = dimanche, comme l'API
    for (final slot in openingHours) {
      if (slot.day == today) return slot;
    }
    return null;
  }
}

final AutoDisposeFutureProviderFamily<ShopDetail, String> shopBySlugProvider =
    FutureProvider.autoDispose.family<ShopDetail, String>((ref, slug) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/shops/$slug');

  final json = response.data!['data'] as Map<String, dynamic>;
  final contact = (json['contact'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final address = (json['address'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final stats = (json['stats'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

  return ShopDetail(
    id: idFromJson(json),
    slug: json['slug'] as String,
    name: json['name'] as String,
    description: json['description'] as String?,
    logo: json['logo'] as String?,
    banner: json['banner'] as String?,
    city: address['city'] as String?,
    categoryName: json['categoryName'] as String?,
    phone: contact['phone'] as String?,
    whatsapp: contact['whatsapp'] as String?,
    rating: doubleFromJson(stats['rating']),
    reviewCount: stats['reviewCount'] as int? ?? 0,
    productCount: stats['productCount'] as int? ?? 0,
    followerCount: stats['followerCount'] as int? ?? 0,
    openingHours: ((json['openingHours'] as List<dynamic>?) ?? const <dynamic>[]).map((raw) {
      final slot = raw as Map<String, dynamic>;
      return (
        day: slot['day'] as int? ?? 1,
        open: slot['open'] as String? ?? '',
        close: slot['close'] as String? ?? '',
      );
    }).toList(),
  );
});

/// Catalogue d'une boutique donnée, réutilisant le dépôt hors ligne d'abord.
final AutoDisposeStreamProviderFamily<List<Product>, String> shopProductsProvider =
    StreamProvider.autoDispose.family<List<Product>, String>((ref, shopId) {
  return ref
      .watch(productRepositoryProvider)
      .watchProducts(ProductFilter(shopId: shopId))
      .map((page) => page.products);
});

class ShopScreen extends ConsumerWidget {
  const ShopScreen({required this.slug, super.key});

  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final shop = ref.watch(shopBySlugProvider(slug));

    return Scaffold(
      body: AsyncView<ShopDetail>(
        value: shop,
        isEmpty: (_) => false,
        emptyTitle: '',
        onRetry: () => ref.invalidate(shopBySlugProvider(slug)),
        data: (detail) => _ShopContent(shop: detail),
      ),
    );
  }
}

class _ShopContent extends ConsumerWidget {
  const _ShopContent({required this.shop});

  final ShopDetail shop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final products = ref.watch(shopProductsProvider(shop.id));
    final today = shop.todayHours;

    return CustomScrollView(
      slivers: <Widget>[
        SliverAppBar(
          expandedHeight: 200,
          pinned: true,
          flexibleSpace: FlexibleSpaceBar(
            title: Text(
              shop.name,
              style: const TextStyle(shadows: <Shadow>[Shadow(blurRadius: 8)]),
            ),
            background: shop.banner == null
                ? ColoredBox(color: theme.colorScheme.surfaceContainerHighest)
                : CachedNetworkImage(imageUrl: shop.banner!, fit: BoxFit.cover),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Wrap(
                  spacing: AllGoTokens.space3,
                  runSpacing: AllGoTokens.space1,
                  children: <Widget>[
                    if (shop.categoryName != null)
                      _Fact(icon: Icons.category_outlined, label: shop.categoryName!),
                    if (shop.city != null) _Fact(icon: Icons.place_outlined, label: shop.city!),
                    if (shop.reviewCount > 0)
                      _Fact(
                        icon: Icons.star_outline,
                        label: '${shop.rating.toStringAsFixed(1).replaceAll('.', ',')} '
                            '(${shop.reviewCount} avis)',
                      ),
                    _Fact(
                      icon: Icons.inventory_2_outlined,
                      label: '${shop.productCount} produit'
                          '${shop.productCount > 1 ? 's' : ''}',
                    ),
                  ],
                ),
                if (today != null) ...<Widget>[
                  const SizedBox(height: AllGoTokens.space3),
                  // Savoir si la boutique est ouverte MAINTENANT est
                  // l'information la plus utile ; la semaine complète encombre.
                  _Fact(
                    icon: Icons.schedule,
                    label: 'Aujourd’hui : ${today.open} – ${today.close}',
                  ),
                ],
                if (shop.description != null) ...<Widget>[
                  const SizedBox(height: AllGoTokens.space4),
                  Text(shop.description!, style: theme.textTheme.bodyMedium),
                ],
                const SizedBox(height: AllGoTokens.space4),
                Row(
                  children: <Widget>[
                    if (shop.phone != null)
                      Expanded(
                        // Appel en un geste depuis la boutique (§2.2) : le
                        // téléphone reste le canal de confiance à Mahajanga.
                        child: OutlinedButton.icon(
                          onPressed: () => _launch('tel:${shop.phone}'),
                          icon: const Icon(Icons.call_outlined),
                          label: const Text('Appeler'),
                        ),
                      ),
                    if (shop.phone != null && shop.whatsapp != null)
                      const SizedBox(width: AllGoTokens.space3),
                    if (shop.whatsapp != null)
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () => _launch(
                            'https://wa.me/${shop.whatsapp!.replaceAll(RegExp('[^0-9]'), '')}',
                          ),
                          icon: const Icon(Icons.chat_outlined),
                          label: const Text('WhatsApp'),
                        ),
                      ),
                  ],
                ),
                const Divider(height: AllGoTokens.space8),
                Text('Catalogue', style: theme.textTheme.titleMedium),
              ],
            ),
          ),
        ),
        products.when(
          loading: () => const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.all(AllGoTokens.space8),
              child: Center(child: CircularProgressIndicator()),
            ),
          ),
          error: (_, __) => SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(AllGoTokens.space8),
              child: Center(
                child: Text(
                  'Catalogue indisponible hors ligne.',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ),
          ),
          data: (list) => list.isEmpty
              ? const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(AllGoTokens.space8),
                    child: Center(child: Text('Cette boutique n’a encore rien publié.')),
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
    );
  }

  void _launch(String url) {
    unawaited(launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication));
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 16, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}
