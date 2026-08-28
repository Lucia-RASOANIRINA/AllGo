import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Carte boutique pour un rail d'accueil (populaires, proches, récemment
/// consultées). Champs optionnels : chaque rail n'a pas les mêmes données
/// (une boutique récemment consultée n'a ni note ni distance).
class ShopCard extends StatelessWidget {
  const ShopCard({
    required this.slug,
    required this.name,
    this.logo,
    this.city,
    this.rating,
    this.distanceM,
    super.key,
  });

  final String slug;
  final String name;
  final String? logo;
  final String? city;
  final double? rating;
  final int? distanceM;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(Routes.shopPath(slug)),
        child: Padding(
          padding: const EdgeInsets.all(AllGoTokens.space3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              CircleAvatar(
                radius: 28,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                backgroundImage: logo != null ? CachedNetworkImageProvider(logo!) : null,
                child: logo == null ? const Icon(Icons.storefront_outlined) : null,
              ),
              const SizedBox(height: AllGoTokens.space2),
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              if (city != null)
                Text(
                  city!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              if (rating != null && rating! > 0)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const Icon(Icons.star, size: 14, color: Colors.amber),
                    const SizedBox(width: 2),
                    Text(
                      rating!.toStringAsFixed(1).replaceAll('.', ','),
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              if (distanceM != null)
                Text(
                  distanceM! < 1000 ? '$distanceM m' : '${(distanceM! / 1000).toStringAsFixed(1)} km',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.primary),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
