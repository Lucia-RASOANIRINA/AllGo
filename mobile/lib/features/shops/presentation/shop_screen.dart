import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/features/shops/presentation/reviews_providers.dart';
import 'package:allgo/features/shops/presentation/shop_follow_controller.dart';
import 'package:allgo/features/shops/presentation/shop_posts_providers.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/star_rating.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
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
    this.addressLine,
    this.categoryName,
    this.phone,
    this.whatsapp,
    this.latitude,
    this.longitude,
    this.rating = 0,
    this.reviewCount = 0,
    this.productCount = 0,
    this.followerCount = 0,
    this.delivery = true,
    this.pickup = false,
    this.openingHours = const <({int day, String open, String close})>[],
  });

  final String id;
  final String slug;
  final String name;
  final String? description;
  final String? logo;
  final String? banner;
  final String? city;
  final String? addressLine;
  final String? categoryName;
  final String? phone;
  final String? whatsapp;
  final double? latitude;
  final double? longitude;
  final double rating;
  final int reviewCount;
  final int productCount;
  final int followerCount;
  final bool delivery;
  final bool pickup;
  final List<({int day, String open, String close})> openingHours;

  /// Horaires du jour, si la boutique en déclare pour aujourd'hui.
  ({int day, String open, String close})? get todayHours {
    final today = DateTime.now().weekday; // 1 = lundi … 7 = dimanche, comme l'API
    for (final slot in openingHours) {
      if (slot.day == today) return slot;
    }
    return null;
  }

  /// Ouvert maintenant ? Même règle que le serveur (`openNowFilter`, UTC+3,
  /// jour ISO) — recalculée côté client pour ne pas dépendre d'un champ que
  /// l'API n'expose pas.
  bool get isOpenNow {
    if (openingHours.isEmpty) return false;
    final utcPlus3 = DateTime.now().toUtc().add(const Duration(hours: 3));
    final hhmm =
        '${utcPlus3.hour.toString().padLeft(2, '0')}:${utcPlus3.minute.toString().padLeft(2, '0')}';
    return openingHours.any(
      (slot) =>
          slot.day == utcPlus3.weekday &&
          slot.open.compareTo(hhmm) <= 0 &&
          slot.close.compareTo(hhmm) >= 0,
    );
  }
}

final AutoDisposeFutureProviderFamily<ShopDetail, String> shopBySlugProvider =
    FutureProvider.autoDispose.family<ShopDetail, String>((ref, slug) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/shops/$slug');

  final json = response.data!['data'] as Map<String, dynamic>;
  final contact = (json['contact'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final address = (json['address'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final stats = (json['stats'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final fulfillment = (json['fulfillment'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  // ATTENTION : `coordinates` est en GeoJSON, donc [longitude, latitude].
  final coordinates = (json['location'] as Map<String, dynamic>?)?['coordinates'] as List<dynamic>?;

  final detail = ShopDetail(
    id: idFromJson(json),
    slug: json['slug'] as String,
    name: json['name'] as String,
    description: json['description'] as String?,
    logo: json['logo'] as String?,
    banner: json['banner'] as String?,
    city: address['city'] as String?,
    addressLine: address['line'] as String?,
    categoryName: json['categoryName'] as String?,
    phone: contact['phone'] as String?,
    whatsapp: contact['whatsapp'] as String?,
    latitude: coordinates == null ? null : doubleFromJson(coordinates[1]),
    longitude: coordinates == null ? null : doubleFromJson(coordinates[0]),
    rating: doubleFromJson(stats['rating']),
    reviewCount: stats['reviewCount'] as int? ?? 0,
    productCount: stats['productCount'] as int? ?? 0,
    followerCount: stats['followerCount'] as int? ?? 0,
    delivery: fulfillment['delivery'] as bool? ?? true,
    pickup: fulfillment['pickup'] as bool? ?? false,
    openingHours: ((json['openingHours'] as List<dynamic>?) ?? const <dynamic>[]).map((raw) {
      final slot = raw as Map<String, dynamic>;
      return (
        day: slot['day'] as int? ?? 1,
        open: slot['open'] as String? ?? '',
        close: slot['close'] as String? ?? '',
      );
    }).toList(),
  );

  // Alimente le rail « boutiques récemment consultées » de l'accueil.
  await ref.watch(appDatabaseProvider).recordShopView(
        RecentlyViewedShopsCompanion.insert(
          id: detail.id,
          slug: detail.slug,
          name: detail.name,
          logo: Value(detail.logo),
          viewedAt: DateTime.now(),
        ),
      );

  return detail;
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
    final position = ref.watch(currentPositionProvider).valueOrNull;
    final distanceM = (position != null && shop.latitude != null && shop.longitude != null)
        ? Geolocator.distanceBetween(
            position.latitude,
            position.longitude,
            shop.latitude!,
            shop.longitude!,
          ).round()
        : null;
    final promotions = products.valueOrNull?.where((p) => p.promoPrice != null).toList() ??
        const <Product>[];

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
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      backgroundImage: shop.logo != null ? NetworkImage(shop.logo!) : null,
                      child: shop.logo == null
                          ? const Icon(Icons.storefront_outlined)
                          : null,
                    ),
                    const SizedBox(width: AllGoTokens.space3),
                    Expanded(
                      child: Wrap(
                        spacing: AllGoTokens.space3,
                        runSpacing: AllGoTokens.space1,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          _StatusBadge(open: shop.isOpenNow),
                          if (shop.categoryName != null)
                            _Fact(icon: Icons.category_outlined, label: shop.categoryName!),
                          if (shop.addressLine != null || shop.city != null)
                            _Fact(
                              icon: Icons.place_outlined,
                              label: shop.addressLine ?? shop.city!,
                            ),
                          if (distanceM != null)
                            _Fact(
                              icon: Icons.directions_walk,
                              label: DistanceFormat.format(distanceM),
                            ),
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
                    ),
                  ],
                ),
                const SizedBox(height: AllGoTokens.space3),
                Wrap(
                  spacing: AllGoTokens.space2,
                  children: <Widget>[
                    if (shop.delivery) const Chip(label: Text('Livraison')),
                    if (shop.pickup) const Chip(label: Text('Retrait')),
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
                    Expanded(child: _FollowButton(shopId: shop.id)),
                    const SizedBox(width: AllGoTokens.space3),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _sendMessage(context, ref),
                        icon: const Icon(Icons.chat_bubble_outline),
                        label: const Text('Message'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AllGoTokens.space3),
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
                const SizedBox(height: AllGoTokens.space3),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: <Widget>[
                    IconButton.filledTonal(
                      onPressed: () => Share.share(
                        '${shop.name} sur AllGo\nhttps://allgo.mg/boutique/${shop.slug}',
                      ),
                      icon: const Icon(Icons.share_outlined),
                      tooltip: 'Partager',
                    ),
                    if (shop.latitude != null && shop.longitude != null) ...<Widget>[
                      IconButton.filledTonal(
                        onPressed: () => context.push<void>(
                          Routes.map,
                          extra: (latitude: shop.latitude!, longitude: shop.longitude!),
                        ),
                        icon: const Icon(Icons.map_outlined),
                        tooltip: 'Voir sur carte',
                      ),
                      IconButton.filledTonal(
                        onPressed: () => _launch(
                          'geo:${shop.latitude},${shop.longitude}'
                          '?q=${Uri.encodeComponent(shop.name)}',
                        ),
                        icon: const Icon(Icons.directions_outlined),
                        tooltip: 'Itinéraire',
                      ),
                    ],
                  ],
                ),
                if (promotions.isNotEmpty) ...<Widget>[
                  const Divider(height: AllGoTokens.space8),
                  Text('Promotions', style: theme.textTheme.titleMedium),
                  const SizedBox(height: AllGoTokens.space3),
                  SizedBox(
                    height: 220,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: promotions.length,
                      separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
                      itemBuilder: (context, i) =>
                          SizedBox(width: 160, child: ProductCard(product: promotions[i])),
                    ),
                  ),
                ],
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
        SliverToBoxAdapter(child: _PostsSection(shopId: shop.id)),
        SliverToBoxAdapter(child: _ReviewsSection(shopId: shop.id)),
      ],
    );
  }

  void _launch(String url) {
    unawaited(launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication));
  }

  Future<void> _sendMessage(BuildContext context, WidgetRef ref) async {
    if (!ref.read(sessionControllerProvider).isAuthenticated) {
      await context.push(
        '${Routes.login}?redirect=${Uri.encodeComponent(Routes.shopPath(shop.slug))}',
      );
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    try {
      final conversationId = await startConversationWithShop(ref, shop.id);
      if (!context.mounted) return;
      await context.push<void>(Routes.messagePath(conversationId), extra: shop.name);
    } on DioException {
      messenger.showSnackBar(const SnackBar(content: Text('Message impossible pour le moment.')));
    }
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.open});

  final bool open;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = open ? Colors.green : theme.colorScheme.error;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(Icons.circle, size: 8, color: color),
        const SizedBox(width: 4),
        Text(
          open ? 'Ouvert' : 'Fermé',
          style: theme.textTheme.bodySmall?.copyWith(color: color, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

/// Bouton Suivre/Ne plus suivre — fusionne « Suivre » et « Ajouter aux
/// favoris (boutique) » de la liste initiale (§ décisions de portée).
class _FollowButton extends ConsumerWidget {
  const _FollowButton({required this.shopId});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final follows = ref.watch(shopFollowControllerProvider);
    final isFollowing = follows.valueOrNull?.contains(shopId) ?? false;

    return FilledButton.icon(
      onPressed: () async {
        if (!session.isAuthenticated) {
          await context.push(
            '${Routes.login}?redirect=${Uri.encodeComponent(Routes.shopPath(shopId))}',
          );
          return;
        }

        final messenger = ScaffoldMessenger.of(context);
        try {
          await ref.read(shopFollowControllerProvider.notifier).toggle(shopId);
        } on DioException {
          messenger.showSnackBar(const SnackBar(content: Text('Action impossible.')));
        }
      },
      style: isFollowing
          ? FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
              foregroundColor: Theme.of(context).colorScheme.onSurface,
            )
          : null,
      icon: Icon(isFollowing ? Icons.check : Icons.add),
      label: Text(isFollowing ? 'Suivi' : 'Suivre'),
    );
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

class _ReviewsSection extends ConsumerWidget {
  const _ReviewsSection({required this.shopId});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final reviews = ref.watch(reviewsControllerProvider(shopId));
    final myUserId = ref.watch(sessionControllerProvider).userId;

    return Padding(
      padding: const EdgeInsets.all(AllGoTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text('Avis', style: theme.textTheme.titleMedium),
              TextButton(
                onPressed: () => _openReviewSheet(context, ref),
                child: const Text('Laisser un avis'),
              ),
            ],
          ),
          reviews.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => const Padding(
              padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
              child: Text('Avis indisponibles.'),
            ),
            data: (state) => state.items.isEmpty
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
                    child: Text('Aucun avis pour l’instant.'),
                  )
                : Column(
                    children: <Widget>[
                      for (final review in state.items)
                        _ReviewTile(
                          review: review,
                          onDelete: review.userId == myUserId
                              ? () => ref
                                  .read(reviewsControllerProvider(shopId).notifier)
                                  .removeMine()
                              : null,
                        ),
                      if (state.hasMore)
                        TextButton(
                          onPressed: () =>
                              ref.read(reviewsControllerProvider(shopId).notifier).loadMore(),
                          child: const Text('Voir plus d’avis'),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  void _openReviewSheet(BuildContext context, WidgetRef ref) {
    if (!ref.read(sessionControllerProvider).isAuthenticated) {
      unawaited(
        context.push(
          '${Routes.login}?redirect=${Uri.encodeComponent(Routes.shopPath(shopId))}',
        ),
      );
      return;
    }

    unawaited(
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (context) => _ReviewSheet(shopId: shopId),
      ),
    );
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.review, this.onDelete});

  final Review review;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          CircleAvatar(
            radius: 16,
            backgroundColor: theme.colorScheme.surfaceContainerHighest,
            backgroundImage:
                review.authorAvatar != null ? NetworkImage(review.authorAvatar!) : null,
            child: review.authorAvatar == null ? const Icon(Icons.person_outline, size: 16) : null,
          ),
          const SizedBox(width: AllGoTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(review.authorName, style: theme.textTheme.labelLarge),
                    ),
                    StarRow(rating: review.rating),
                  ],
                ),
                if (review.comment != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(review.comment!, style: theme.textTheme.bodyMedium),
                ],
              ],
            ),
          ),
          if (onDelete != null)
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 18),
              tooltip: 'Retirer mon avis',
              onPressed: onDelete,
            ),
        ],
      ),
    );
  }
}

class _ReviewSheet extends ConsumerStatefulWidget {
  const _ReviewSheet({required this.shopId});

  final String shopId;

  @override
  ConsumerState<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends ConsumerState<_ReviewSheet> {
  final _commentController = TextEditingController();
  int _rating = 5;
  bool _sending = false;

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AllGoTokens.space4,
        right: AllGoTokens.space4,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AllGoTokens.space6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Laisser un avis', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AllGoTokens.space3),
          Center(
            child:
                StarRow(rating: _rating, onChanged: (value) => setState(() => _rating = value)),
          ),
          const SizedBox(height: AllGoTokens.space3),
          TextField(
            controller: _commentController,
            maxLines: 3,
            maxLength: 1000,
            decoration: const InputDecoration(hintText: 'Votre commentaire (facultatif)'),
          ),
          const SizedBox(height: AllGoTokens.space2),
          FilledButton(
            onPressed: _sending ? null : _submit,
            child: const Text('Envoyer'),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _sending = true);
    try {
      final comment = _commentController.text.trim();
      await ref
          .read(reviewsControllerProvider(widget.shopId).notifier)
          .post(_rating, comment.isEmpty ? null : comment);
      if (mounted) Navigator.of(context).pop();
    } on DioException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Avis non envoyé. Réessayez.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }
}

class _PostsSection extends ConsumerWidget {
  const _PostsSection({required this.shopId});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final posts = ref.watch(shopPostsControllerProvider(shopId));

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Publications', style: theme.textTheme.titleMedium),
          posts.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => const Padding(
              padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
              child: Text('Publications indisponibles.'),
            ),
            data: (state) => state.items.isEmpty
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
                    child: Text('Cette boutique n’a encore rien publié.'),
                  )
                : Column(
                    children: <Widget>[
                      for (final post in state.items)
                        _PostCard(
                          post: post,
                          onReact: () => ref
                              .read(shopPostsControllerProvider(shopId).notifier)
                              .toggleReaction(post.id),
                          onComment: () => _openComments(context, post.id),
                        ),
                      if (state.hasMore)
                        TextButton(
                          onPressed: () =>
                              ref.read(shopPostsControllerProvider(shopId).notifier).loadMore(),
                          child: const Text('Voir plus de publications'),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  void _openComments(BuildContext context, String postId) {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (context) => _CommentsSheet(postId: postId),
      ),
    );
  }
}

class _PostCard extends StatelessWidget {
  const _PostCard({required this.post, required this.onReact, required this.onComment});

  final ShopPost post;
  final VoidCallback onReact;
  final VoidCallback onComment;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (post.thumbUrl != null)
            AspectRatio(
              aspectRatio: 16 / 9,
              child: CachedNetworkImage(imageUrl: post.thumbUrl!, fit: BoxFit.cover),
            ),
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (post.content != null) Text(post.content!, style: theme.textTheme.bodyMedium),
                const SizedBox(height: AllGoTokens.space2),
                Row(
                  children: <Widget>[
                    IconButton(
                      onPressed: onReact,
                      icon: Icon(
                        post.reactedLocally ? Icons.favorite : Icons.favorite_border,
                        color: post.reactedLocally ? theme.colorScheme.error : null,
                        size: 20,
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                    Text('${post.reactionCount}'),
                    const SizedBox(width: AllGoTokens.space4),
                    IconButton(
                      onPressed: onComment,
                      icon: const Icon(Icons.mode_comment_outlined, size: 20),
                      visualDensity: VisualDensity.compact,
                    ),
                    Text('${post.commentCount}'),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CommentsSheet extends ConsumerStatefulWidget {
  const _CommentsSheet({required this.postId});

  final String postId;

  @override
  ConsumerState<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends ConsumerState<_CommentsSheet> {
  final _inputController = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _inputController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final comments = ref.watch(postCommentsControllerProvider(widget.postId));
    final theme = Theme.of(context);

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) => Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            child: Text('Commentaires', style: theme.textTheme.titleMedium),
          ),
          Expanded(
            child: comments.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, __) => const Center(child: Text('Commentaires indisponibles.')),
              data: (list) => list.isEmpty
                  ? const Center(child: Text('Aucun commentaire pour l’instant.'))
                  : ListView.builder(
                      controller: scrollController,
                      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                      itemCount: list.length,
                      itemBuilder: (context, i) {
                        final comment = list[i];
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(comment.authorName, style: theme.textTheme.labelLarge),
                              Text(comment.content, style: theme.textTheme.bodyMedium),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(AllGoTokens.space3),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _inputController,
                      decoration: const InputDecoration(hintText: 'Ajouter un commentaire…'),
                    ),
                  ),
                  IconButton.filled(
                    onPressed: _sending ? null : _submit,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    final content = _inputController.text.trim();
    if (content.isEmpty || _sending) return;

    if (!ref.read(sessionControllerProvider).isAuthenticated) {
      Navigator.of(context).pop();
      unawaited(context.push(Routes.login));
      return;
    }

    setState(() => _sending = true);
    try {
      await ref.read(postCommentsControllerProvider(widget.postId).notifier).add(content);
      _inputController.clear();
    } on DioException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Commentaire non envoyé. Réessayez.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }
}
