import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/catalog/presentation/product_reviews_providers.dart';
import 'package:allgo/features/favorites/presentation/favorites_controller.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/star_rating.dart';
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

class _Content extends ConsumerWidget {
  const _Content({required this.product});

  final Product product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final price = Ariary.formatWithPromo(product.price, product.promoPrice);
    final categories = ref.watch(categoryTreeProvider).valueOrNull ?? const <Category>[];
    final categoryName = _findCategoryName(categories, product.categoryId);

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

                Wrap(
                  spacing: AllGoTokens.space3,
                  runSpacing: AllGoTokens.space1,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    if (categoryName != null)
                      _Fact(icon: Icons.category_outlined, label: categoryName),
                    if (product.reviewCount > 0)
                      _Fact(
                        icon: Icons.star_outline,
                        label: '${(product.rating ?? 0).toStringAsFixed(1).replaceAll('.', ',')} '
                            '(${product.reviewCount} avis)',
                      ),
                  ],
                ),
                if (categoryName != null || product.reviewCount > 0)
                  const SizedBox(height: AllGoTokens.space3),

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
                const SizedBox(height: AllGoTokens.space2),
                OutlinedButton.icon(
                  onPressed: () => _contactSeller(context, ref),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text('Contacter le vendeur'),
                ),

                if (product.description != null) ...<Widget>[
                  const Divider(height: AllGoTokens.space8),
                  Text('Description', style: theme.textTheme.titleMedium),
                  const SizedBox(height: AllGoTokens.space2),
                  Text(product.description!, style: theme.textTheme.bodyMedium),
                ],

                const Divider(height: AllGoTokens.space8),
                Text('Avis', style: theme.textTheme.titleMedium),
              ],
            ),
          ),
        ),
        SliverToBoxAdapter(child: _ProductReviewsSection(productId: product.id)),
        SliverToBoxAdapter(child: _RelatedRail(title: 'Produits similaires', productId: product.id, recommended: false)),
        SliverToBoxAdapter(child: _RelatedRail(title: 'Produits recommandés', productId: product.id, recommended: true)),
        const SliverToBoxAdapter(child: SizedBox(height: AllGoTokens.space8)),
      ],
    );
  }

  String? _findCategoryName(List<Category> tree, String? categoryId) {
    if (categoryId == null) return null;
    for (final root in tree) {
      if (root.id == categoryId) return root.name;
      for (final child in root.children) {
        if (child.id == categoryId) return child.name;
      }
    }
    return null;
  }

  Future<void> _contactSeller(BuildContext context, WidgetRef ref) async {
    if (!ref.read(sessionControllerProvider).isAuthenticated) {
      await context.push(
        '${Routes.login}?redirect=${Uri.encodeComponent(Routes.productPath(product.id))}',
      );
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    try {
      final conversationId = await startConversationWithShop(ref, product.shopId);
      if (!context.mounted) return;
      await context.push<void>(Routes.messagePath(conversationId), extra: product.shopName);
    } on DioException {
      messenger.showSnackBar(const SnackBar(content: Text('Message impossible pour le moment.')));
    }
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
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _RelatedRail extends ConsumerWidget {
  const _RelatedRail({required this.title, required this.productId, required this.recommended});

  final String title;
  final String productId;
  final bool recommended;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(
      recommended ? relatedRecommendedProductsProvider(productId) : similarProductsProvider(productId),
    );
    final list = products.valueOrNull ?? const <Product>[];
    if (list.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Divider(height: AllGoTokens.space8),
          Text(title, style: theme.textTheme.titleMedium),
          const SizedBox(height: AllGoTokens.space3),
          SizedBox(
            height: 220,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: list.length,
              separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
              itemBuilder: (context, i) => SizedBox(width: 160, child: ProductCard(product: list[i])),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProductReviewsSection extends ConsumerWidget {
  const _ProductReviewsSection({required this.productId});

  final String productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviews = ref.watch(productReviewsControllerProvider(productId));
    final myUserId = ref.watch(sessionControllerProvider).userId;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => _openReviewSheet(context, ref),
              child: const Text('Donner un avis'),
            ),
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
                        _ProductReviewTile(
                          review: review,
                          onDelete: review.userId == myUserId
                              ? () => ref
                                  .read(productReviewsControllerProvider(productId).notifier)
                                  .removeMine()
                              : null,
                        ),
                      if (state.hasMore)
                        TextButton(
                          onPressed: () => ref
                              .read(productReviewsControllerProvider(productId).notifier)
                              .loadMore(),
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
          '${Routes.login}?redirect=${Uri.encodeComponent(Routes.productPath(productId))}',
        ),
      );
      return;
    }

    unawaited(
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (context) => _ProductReviewSheet(productId: productId),
      ),
    );
  }
}

class _ProductReviewTile extends StatelessWidget {
  const _ProductReviewTile({required this.review, this.onDelete});

  final ProductReview review;
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
                    Expanded(child: Text(review.authorName, style: theme.textTheme.labelLarge)),
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

class _ProductReviewSheet extends ConsumerStatefulWidget {
  const _ProductReviewSheet({required this.productId});

  final String productId;

  @override
  ConsumerState<_ProductReviewSheet> createState() => _ProductReviewSheetState();
}

class _ProductReviewSheetState extends ConsumerState<_ProductReviewSheet> {
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
          Text('Donner un avis', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AllGoTokens.space3),
          Center(
            child: StarRow(rating: _rating, onChanged: (value) => setState(() => _rating = value)),
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
          .read(productReviewsControllerProvider(widget.productId).notifier)
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

  Future<void> _addToCart(BuildContext context, WidgetRef ref, {required bool buyNow}) async {
    final messenger = ScaffoldMessenger.of(context);

    try {
      // Mise à jour optimiste : le panier reflète l'ajout immédiatement, avant
      // confirmation du serveur (§8.2). Hors ligne, l'action part en file
      // d'attente sans effet visible différent — c'est tout l'intérêt.
      await ref.read(cartControllerProvider.notifier).add(product);

      if (buyNow) {
        // « Acheter » est un raccourci vers le panier déjà rempli, pas un
        // flux d'achat isolé : s'il contenait déjà d'autres articles, ils
        // font partie de la même commande (§ décisions de portée).
        if (context.mounted) unawaited(context.push(Routes.checkout));
        return;
      }

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
              child: OutlinedButton.icon(
                onPressed:
                    product.isAvailable ? () => _addToCart(context, ref, buyNow: false) : null,
                icon: const Icon(Icons.add_shopping_cart),
                label: const Text('Ajouter'),
              ),
            ),
            const SizedBox(width: AllGoTokens.space3),
            Expanded(
              child: FilledButton.icon(
                onPressed:
                    product.isAvailable ? () => _addToCart(context, ref, buyNow: true) : null,
                icon: const Icon(Icons.bolt),
                label: Text(product.isAvailable ? 'Acheter' : 'Indisponible'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
