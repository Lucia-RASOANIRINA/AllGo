import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/recently_viewed_store.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/features/shops/presentation/shop_follow_controller.dart';
import 'package:allgo/features/shops/presentation/shop_posts_providers.dart';
import 'package:allgo/features/shops/presentation/reviews_providers.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
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
    this.isOpenNow,
    this.latitude,
    this.longitude,
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
  final bool? isOpenNow;
  final double? latitude;
  final double? longitude;
  final List<({int day, String open, String close})> openingHours;

  bool get hasLocation => latitude != null && longitude != null;

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
  final location = json['location'] as Map<String, dynamic>?;
  final coordinates = location?['coordinates'] as List<dynamic>?;

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
    isOpenNow: json['isOpenNow'] as bool?,
    // GeoJSON : [longitude, latitude] — l'ordre est inversé par rapport à
    // l'habitude « lat, lng » (§15.4).
    longitude: coordinates != null ? (coordinates[0] as num).toDouble() : null,
    latitude: coordinates != null ? (coordinates[1] as num).toDouble() : null,
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

    // Historique local « récemment consulté » (accueil) — enregistré une
    // seule fois par arrivée de données, jamais à chaque reconstruction.
    ref.listen(shopBySlugProvider(slug), (_, next) {
      next.whenData((s) {
        ref.read(recentlyViewedStoreProvider).addShop(
              RecentlyViewedShop(id: s.id, slug: s.slug, name: s.name, logo: s.logo),
            );
      });
    });

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
    final isFollowing = ref.watch(shopFollowControllerProvider).valueOrNull?.contains(shop.id) ?? false;

    return CustomScrollView(
      slivers: <Widget>[
        SliverAppBar(
          expandedHeight: 200,
          pinned: true,
          actions: <Widget>[
            IconButton(
              onPressed: () => Share.share('${shop.name} sur AllGo\nhttps://allgo.mg/boutique/${shop.slug}'),
              icon: const Icon(Icons.share_outlined),
              tooltip: 'Partager',
            ),
          ],
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
                    if (shop.isOpenNow != null)
                      _Fact(
                        icon: shop.isOpenNow! ? Icons.check_circle_outline : Icons.cancel_outlined,
                        label: shop.isOpenNow! ? 'Ouvert maintenant' : 'Fermé',
                        color: shop.isOpenNow! ? Colors.green : theme.colorScheme.error,
                      ),
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
                    _Fact(
                      icon: Icons.people_outline,
                      label: '${shop.followerCount} abonné'
                          '${shop.followerCount > 1 ? 's' : ''}',
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
                Wrap(
                  spacing: AllGoTokens.space3,
                  runSpacing: AllGoTokens.space3,
                  children: <Widget>[
                    OutlinedButton.icon(
                      onPressed: () => ref.read(shopFollowControllerProvider.notifier).toggle(shop.id),
                      icon: Icon(isFollowing ? Icons.check : Icons.add),
                      label: Text(isFollowing ? 'Suivi' : 'Suivre'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _openChat(context, ref),
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: const Text('Message'),
                    ),
                    if (shop.phone != null)
                      OutlinedButton.icon(
                        onPressed: () => _launch('tel:${shop.phone}'),
                        icon: const Icon(Icons.call_outlined),
                        label: const Text('Appeler'),
                      ),
                    if (shop.whatsapp != null)
                      FilledButton.icon(
                        onPressed: () => _launch(
                          'https://wa.me/${shop.whatsapp!.replaceAll(RegExp('[^0-9]'), '')}',
                        ),
                        icon: const Icon(Icons.chat_outlined),
                        label: const Text('WhatsApp'),
                      ),
                    if (shop.hasLocation) ...<Widget>[
                      OutlinedButton.icon(
                        onPressed: () => context.push(Routes.map),
                        icon: const Icon(Icons.map_outlined),
                        label: const Text('Voir sur la carte'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => _launch(
                          'geo:${shop.latitude},${shop.longitude}?q=${Uri.encodeComponent(shop.name)}',
                        ),
                        icon: const Icon(Icons.directions_outlined),
                        label: const Text('Itinéraire'),
                      ),
                    ],
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
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AllGoTokens.space4,
              AllGoTokens.space6,
              AllGoTokens.space4,
              0,
            ),
            child: Text('Publications', style: theme.textTheme.titleMedium),
          ),
        ),
        _ShopPostsSliver(shopId: shop.id),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AllGoTokens.space4,
              AllGoTokens.space6,
              AllGoTokens.space4,
              0,
            ),
            child: Text('Avis', style: theme.textTheme.titleMedium),
          ),
        ),
        _ShopReviewsSliver(shopId: shop.id),
        const SliverToBoxAdapter(child: SizedBox(height: AllGoTokens.space6)),
      ],
    );
  }

  Future<void> _openChat(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final conversationId = await startConversationWithShop(ref, shop.id);
      if (!context.mounted) return;
      unawaited(context.push(Routes.messagePath(conversationId), extra: shop.name));
    } on Exception {
      messenger.showSnackBar(const SnackBar(content: Text('Impossible d’ouvrir la conversation.')));
    }
  }

  void _launch(String url) {
    unawaited(launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication));
  }
}

class _ShopPostsSliver extends ConsumerWidget {
  const _ShopPostsSliver({required this.shopId});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final state = ref.watch(shopPostsControllerProvider(shopId));

    return state.when(
      loading: () => const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.all(AllGoTokens.space6),
          child: Center(child: CircularProgressIndicator()),
        ),
      ),
      error: (_, __) => SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          child: Text('Publications indisponibles.', style: theme.textTheme.bodySmall),
        ),
      ),
      data: (posts) => posts.items.isEmpty
          ? SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                child: Text('Aucune publication pour l’instant.', style: theme.textTheme.bodySmall),
              ),
            )
          : SliverList.builder(
              itemCount: posts.items.length,
              itemBuilder: (context, i) {
                final post = posts.items[i];
                return ListTile(
                  leading: post.thumbUrl == null
                      ? const CircleAvatar(child: Icon(Icons.storefront_outlined))
                      : CircleAvatar(backgroundImage: CachedNetworkImageProvider(post.thumbUrl!)),
                  title: post.content == null ? null : Text(post.content!, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text('${post.reactionCount} j’aime · ${post.commentCount} commentaires'),
                  trailing: IconButton(
                    icon: Icon(
                      post.reactedLocally ? Icons.favorite : Icons.favorite_border,
                      color: post.reactedLocally ? theme.colorScheme.error : null,
                    ),
                    onPressed: () =>
                        ref.read(shopPostsControllerProvider(shopId).notifier).toggleReaction(post.id),
                  ),
                );
              },
            ),
    );
  }
}

class _ShopReviewsSliver extends ConsumerWidget {
  const _ShopReviewsSliver({required this.shopId});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final state = ref.watch(reviewsControllerProvider(shopId));

    return state.when(
      loading: () => const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.all(AllGoTokens.space6),
          child: Center(child: CircularProgressIndicator()),
        ),
      ),
      error: (_, __) => SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          child: Text('Avis indisponibles.', style: theme.textTheme.bodySmall),
        ),
      ),
      data: (reviews) => reviews.items.isEmpty
          ? SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                child: Text('Aucun avis pour l’instant.', style: theme.textTheme.bodySmall),
              ),
            )
          : SliverList.builder(
              itemCount: reviews.items.length,
              itemBuilder: (context, i) {
                final review = reviews.items[i];
                return ListTile(
                  leading: review.authorAvatar == null
                      ? const CircleAvatar(child: Icon(Icons.person_outline))
                      : CircleAvatar(backgroundImage: CachedNetworkImageProvider(review.authorAvatar!)),
                  title: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(review.authorName),
                      const SizedBox(width: AllGoTokens.space2),
                      ...List.generate(
                        5,
                        (star) => Icon(
                          star < review.rating ? Icons.star : Icons.star_border,
                          size: 14,
                          color: Colors.amber,
                        ),
                      ),
                    ],
                  ),
                  subtitle: review.comment == null ? null : Text(review.comment!),
                );
              },
            ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.label, this.color});

  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final effectiveColor = color ?? theme.colorScheme.onSurfaceVariant;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 16, color: effectiveColor),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(color: effectiveColor),
        ),
      ],
    );
  }
}
