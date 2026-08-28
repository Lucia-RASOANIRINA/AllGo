import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Rangée horizontale titrée pour un rail d'accueil (populaire, nouveautés,
/// promotions…). Se masque entièrement si la liste est vide — un titre sans
/// contenu en dessous est plus déroutant qu'une section absente.
class HomeSection<T> extends StatelessWidget {
  const HomeSection({
    required this.title,
    required this.items,
    required this.itemBuilder,
    this.itemWidth = 160,
    this.height = 240,
    super.key,
  });

  final String title;
  final List<T> items;
  final Widget Function(BuildContext context, T item) itemBuilder;
  final double itemWidth;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AllGoTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
            child: Text(title, style: theme.textTheme.titleMedium),
          ),
          const SizedBox(height: AllGoTokens.space2),
          SizedBox(
            height: height,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
              itemBuilder: (context, i) => SizedBox(
                width: itemWidth,
                child: itemBuilder(context, items[i]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Rail de catégories : icônes rondes défilant horizontalement.
class CategoryRail extends StatelessWidget {
  const CategoryRail({required this.categories, required this.onTap, super.key});

  final List<({String id, String name, String? icon})> categories;
  final void Function(String categoryId) onTap;

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AllGoTokens.space4),
      child: SizedBox(
        height: 96,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
          itemCount: categories.length,
          separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
          itemBuilder: (context, i) {
            final category = categories[i];
            return InkWell(
              onTap: () => onTap(category.id),
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: 72,
                child: Column(
                  children: <Widget>[
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      child: Icon(Icons.category_outlined, color: theme.colorScheme.primary),
                    ),
                    const SizedBox(height: AllGoTokens.space1),
                    Text(
                      category.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
