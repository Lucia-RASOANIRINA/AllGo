import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(catalogProvider);

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
        onRefresh: () async => ref.invalidate(catalogProvider),
        child: AsyncView<List<Product>>(
          value: products,
          emptyTitle: 'Aucun produit pour le moment',
          emptyMessage: 'Les commerçants de Mahajanga publient chaque jour. Revenez bientôt.',
          isEmpty: (list) => list.isEmpty,
          onRetry: () => ref.invalidate(catalogProvider),
          data: (list) => GridView.builder(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              // Extension maximale plutôt qu'un nombre fixe de colonnes :
              // l'application couvre 320 dp à 600 dp de large (§13.2).
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
