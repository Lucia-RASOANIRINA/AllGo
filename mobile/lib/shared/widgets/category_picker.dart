import 'package:allgo/app/theme.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:flutter/material.dart';

/// Sélecteur de catégorie avec recherche par nom — partagé entre l'onglet
/// Produits d'Explorer, l'onglet Boutiques et la carte (tous référencent la
/// même arborescence).
Future<Category?> pickCategory(BuildContext context, List<Category> tree) {
  if (tree.isEmpty) return Future<Category?>.value();

  return showModalBottomSheet<Category>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => _CategoryPickerSheet(tree: tree),
  );
}

class _CategoryPickerSheet extends StatefulWidget {
  const _CategoryPickerSheet({required this.tree});

  final List<Category> tree;

  @override
  State<_CategoryPickerSheet> createState() => _CategoryPickerSheetState();
}

class _CategoryPickerSheetState extends State<_CategoryPickerSheet> {
  final _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final flat = widget.tree.expand((c) => <Category>[c, ...c.children]).toList();
    final filtered = query.isEmpty ? null : flat.where((c) => c.name.toLowerCase().contains(query));

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
            child: TextField(
              controller: _searchController,
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                hintText: 'Rechercher une catégorie…',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          const SizedBox(height: AllGoTokens.space2),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: <Widget>[
                if (filtered != null)
                  for (final category in filtered)
                    ListTile(
                      title: Text(category.name),
                      onTap: () => Navigator.pop(context, category),
                    )
                else
                  for (final root in widget.tree) ...<Widget>[
                    ListTile(
                      title: Text(root.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                      onTap: () => Navigator.pop(context, root),
                    ),
                    // Les sous-catégories sont proposées à plat, avec un retrait :
                    // une arborescence dépliable sur une feuille de 6 pouces
                    // coûte plus de gestes qu'elle n'en fait gagner.
                    for (final child in root.children)
                      ListTile(
                        contentPadding: const EdgeInsets.only(left: AllGoTokens.space8, right: 16),
                        title: Text(child.name),
                        onTap: () => Navigator.pop(context, child),
                      ),
                  ],
                const SizedBox(height: AllGoTokens.space6),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
