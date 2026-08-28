import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/catalog/presentation/widgets/voice_search_button.dart';
import 'package:allgo/features/geo/domain/nearby_product.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/features/shops/domain/shop_filter.dart';
import 'package:allgo/features/shops/presentation/shop_search_controller.dart';
import 'package:allgo/features/shops/presentation/widgets/shop_card.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Historique de recherche par périmètre (`'product'` / `'shop'`) — les deux
/// onglets partagent la barre de recherche mais gardent des historiques
/// distincts.
final AutoDisposeFutureProviderFamily<List<SearchHistoryEntry>, String> _searchHistoryProvider =
    FutureProvider.autoDispose.family<List<SearchHistoryEntry>, String>((ref, scope) {
  return ref.watch(appDatabaseProvider).recentSearches(scope);
});

/// Bascule « Proches » de l'onglet Produits — état propre à cet écran, séparé
/// de `ProductFilter` pour ne pas complexifier le flux hors-ligne d'abord de
/// `watchProducts` (§9.1).
final StateProvider<bool> _productsNearbyProvider = StateProvider<bool>((_) => false);
final StateProvider<double> _productsSearchRadiusProvider = StateProvider<double>((_) => 5);

final AutoDisposeFutureProvider<List<NearbyProduct>> _nearbyProductResultsProvider =
    FutureProvider.autoDispose<List<NearbyProduct>>((ref) async {
  final radius = ref.watch(_productsSearchRadiusProvider);
  final query = ref.watch(catalogFilterProvider).query?.trim().toLowerCase();

  try {
    final position = await ref.watch(currentPositionProvider.future);
    final results = await ref.watch(geoRepositoryProvider).nearbyProducts(
          NearbyQuery(latitude: position.latitude, longitude: position.longitude, radiusKm: radius),
        );
    if (query == null || query.isEmpty) return results;
    return results.where((p) => p.name.toLowerCase().contains(query)).toList();
  } on Exception {
    return const <NearbyProduct>[];
  }
});

/// Adapte un résultat de proximité au type attendu par `ProductCard` — même
/// pattern que `home_screen.dart` (dupliqué : la fonction y est privée).
Product _productFromNearby(NearbyProduct product) => Product(
      id: product.id,
      shopId: product.shopId ?? '',
      shopName: product.shopName ?? '',
      shopSlug: '',
      name: product.name,
      price: product.price,
      promoPrice: product.promoPrice,
      thumbUrl: product.thumbUrl,
      stock: 1,
    );

class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 2, vsync: this)
    ..addListener(() {
      if (!_tabController.indexIsChanging) setState(() {});
    });
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  Timer? _debounce;
  bool _fieldHasFocus = false;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() => setState(() => _fieldHasFocus = _focusNode.hasFocus));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _focusNode.dispose();
    _tabController.dispose();
    super.dispose();
  }

  String get _scope => _tabController.index == 0 ? 'product' : 'shop';

  /// Anti-rebond de 300 ms.
  ///
  /// Sans lui, taper « riz » déclencherait trois requêtes réseau. Sur un
  /// forfait payé au mégaoctet, la frappe d'un utilisateur ne doit pas coûter
  /// d'argent (§13.1 — moins de 1,5 Mo pour une session de 5 minutes).
  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final trimmed = value.trim();
      _applyQuery(trimmed);
      if (trimmed.isNotEmpty) {
        unawaited(ref.read(appDatabaseProvider).recordSearch(trimmed, _scope));
        ref.invalidate(_searchHistoryProvider(_scope));
      }
    });
  }

  void _applyQuery(String trimmed) {
    if (_tabController.index == 0) {
      final filter = ref.read(catalogFilterProvider);
      ref.read(catalogFilterProvider.notifier).state =
          trimmed.isEmpty ? filter.clearQuery() : filter.copyWith(query: trimmed);
    } else {
      final filter = ref.read(shopSearchFilterProvider);
      ref.read(shopSearchFilterProvider.notifier).state =
          trimmed.isEmpty ? filter.clearQuery() : filter.copyWith(query: trimmed);
    }
  }

  void _selectSuggestion(String text) {
    _controller.text = text;
    _focusNode.unfocus();
    _debounce?.cancel();
    _applyQuery(text);
    unawaited(ref.read(appDatabaseProvider).recordSearch(text, _scope));
    ref.invalidate(_searchHistoryProvider(_scope));
  }

  Future<void> _scanBarcode() async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute<String>(builder: (_) => const _BarcodeScannerPage()),
    );
    if (code == null || !mounted) return;

    try {
      final product = await ref.read(productRepositoryProvider).getByBarcode(code);
      // La navigation n'est pas attendue : on ouvre la fiche et on rend la main.
      if (mounted) unawaited(context.push<void>('/produit/${product.id}'));
    } on Exception {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Aucun produit ne correspond à ce code-barres.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final onProducts = _tabController.index == 0;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: AllGoTokens.space4,
        title: TextField(
          controller: _controller,
          focusNode: _focusNode,
          onChanged: _onQueryChanged,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: onProducts ? 'Rechercher un produit…' : 'Rechercher une boutique…',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _controller.text.isEmpty
                ? null
                : IconButton(
                    onPressed: () {
                      _controller.clear();
                      _onQueryChanged('');
                    },
                    icon: const Icon(Icons.close),
                    tooltip: 'Effacer',
                  ),
          ),
        ),
        actions: <Widget>[
          VoiceSearchButton(onResult: _selectSuggestion),
          if (onProducts)
            IconButton(
              onPressed: _scanBarcode,
              icon: const Icon(Icons.qr_code_scanner),
              tooltip: 'Scanner un code-barres',
            ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const <Widget>[
            Tab(text: 'Produits'),
            Tab(text: 'Boutiques'),
          ],
        ),
      ),
      body: Column(
        children: <Widget>[
          if (_fieldHasFocus)
            _SuggestionsPanel(scope: _scope, queryText: _controller.text, onSelect: _selectSuggestion),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: const <Widget>[_ProductsTab(), _ShopsTab()],
            ),
          ),
        ],
      ),
    );
  }
}

class _SuggestionsPanel extends ConsumerWidget {
  const _SuggestionsPanel({required this.scope, required this.queryText, required this.onSelect});

  final String scope;
  final String queryText;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final query = queryText.trim().toLowerCase();
    final history = ref.watch(_searchHistoryProvider(scope)).valueOrNull ?? const <SearchHistoryEntry>[];
    final historyMatches =
        history.where((e) => query.isEmpty || e.query.toLowerCase().contains(query)).toList();

    final categories = ref.watch(categoryTreeProvider).valueOrNull ?? const <Category>[];
    final categoryMatches = query.isEmpty
        ? const <Category>[]
        : categories
            .expand((c) => <Category>[c, ...c.children])
            .where((c) => c.name.toLowerCase().contains(query))
            .take(5)
            .toList();

    if (historyMatches.isEmpty && categoryMatches.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);

    return Material(
      elevation: 2,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 280),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
          children: <Widget>[
            if (historyMatches.isNotEmpty) ...<Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Text('Recherches récentes', style: theme.textTheme.labelMedium),
                    TextButton(
                      onPressed: () async {
                        await ref.read(appDatabaseProvider).clearSearchHistory(scope);
                        ref.invalidate(_searchHistoryProvider(scope));
                      },
                      child: const Text('Effacer'),
                    ),
                  ],
                ),
              ),
              for (final entry in historyMatches)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.history),
                  title: Text(entry.query),
                  onTap: () => onSelect(entry.query),
                ),
            ],
            if (categoryMatches.isNotEmpty) ...<Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                child: Text('Catégories', style: theme.textTheme.labelMedium),
              ),
              for (final category in categoryMatches)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.category_outlined),
                  title: Text(category.name),
                  onTap: () => onSelect(category.name),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Sélecteur de catégorie avec recherche par nom — partagé entre l'onglet
/// Produits et l'onglet Boutiques (les deux référencent la même arborescence).
Future<Category?> _pickCategory(BuildContext context, List<Category> tree) {
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

class _ProductsTab extends ConsumerWidget {
  const _ProductsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(catalogFilterProvider);
    final nearby = ref.watch(_productsNearbyProvider);

    return Column(
      children: <Widget>[
        _ProductFilterBar(
          filter: filter,
          nearby: nearby,
          onChanged: (next) => ref.read(catalogFilterProvider.notifier).state = next,
        ),
        Expanded(
          child: nearby ? const _NearbyProductsView() : const _ProductResultsView(),
        ),
      ],
    );
  }
}

class _ProductResultsView extends ConsumerWidget {
  const _ProductResultsView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(catalogProvider);
    final filter = ref.watch(catalogFilterProvider);

    return AsyncView<List<Product>>(
      value: results,
      isEmpty: (list) => list.isEmpty,
      emptyTitle: filter.query == null
          ? 'Commencez votre recherche'
          : 'Aucun résultat pour « ${filter.query} »',
      emptyMessage: filter.query == null
          ? 'Tapez le nom d’un produit, ou scannez son code-barres.'
          : 'Essayez un autre terme, ou élargissez les filtres.',
      onRetry: () => ref.invalidate(catalogProvider),
      data: (list) => GridView.builder(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisSpacing: AllGoTokens.space3,
          crossAxisSpacing: AllGoTokens.space3,
          childAspectRatio: 0.72,
        ),
        itemCount: list.length,
        itemBuilder: (context, i) => ProductCard(product: list[i]),
      ),
    );
  }
}

class _NearbyProductsView extends ConsumerWidget {
  const _NearbyProductsView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(_nearbyProductResultsProvider);

    return AsyncView<List<NearbyProduct>>(
      value: results,
      isEmpty: (list) => list.isEmpty,
      emptyTitle: 'Aucun produit à proximité',
      emptyMessage: 'Essayez un rayon plus large, ou revenez plus tard.',
      onRetry: () => ref.invalidate(_nearbyProductResultsProvider),
      data: (list) => GridView.builder(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisSpacing: AllGoTokens.space3,
          crossAxisSpacing: AllGoTokens.space3,
          childAspectRatio: 0.72,
        ),
        itemCount: list.length,
        itemBuilder: (context, i) => ProductCard(product: _productFromNearby(list[i])),
      ),
    );
  }
}

class _ProductFilterBar extends ConsumerWidget {
  const _ProductFilterBar({required this.filter, required this.nearby, required this.onChanged});

  final ProductFilter filter;
  final bool nearby;
  final ValueChanged<ProductFilter> onChanged;

  bool get _hasPriceFilter => filter.minPrice != null || filter.maxPrice != null;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(categoryTreeProvider);
    final selectedCategory = categories.valueOrNull
        ?.expand((c) => <Category>[c, ...c.children])
        .where((c) => c.id == filter.categoryId)
        .firstOrNull;

    return SizedBox(
      height: 56,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
        children: <Widget>[
          FilterChip(
            avatar: const Icon(Icons.near_me_outlined, size: 18),
            label: const Text('Proches'),
            selected: nearby,
            onSelected: (selected) => ref.read(_productsNearbyProvider.notifier).state = selected,
          ),
          const SizedBox(width: AllGoTokens.space2),

          if (nearby) ...<Widget>[
            for (final km in const <double>[1, 5, 10, 20]) ...<Widget>[
              ChoiceChip(
                label: Text('${km.toInt()} km'),
                selected: ref.watch(_productsSearchRadiusProvider) == km,
                onSelected: (_) => ref.read(_productsSearchRadiusProvider.notifier).state = km,
              ),
              const SizedBox(width: AllGoTokens.space2),
            ],
          ] else ...<Widget>[
            FilterChip(
              label: const Text('En stock'),
              selected: filter.inStockOnly,
              onSelected: (selected) => onChanged(filter.copyWith(inStockOnly: selected)),
            ),
            const SizedBox(width: AllGoTokens.space2),

            FilterChip(
              label: const Text('Promotions'),
              selected: filter.onSale,
              onSelected: (selected) => onChanged(filter.copyWith(onSale: selected)),
            ),
            const SizedBox(width: AllGoTokens.space2),

            // Une puce active affiche sa valeur et porte une croix : un filtre
            // qu'on ne sait pas retirer est un filtre qui piège l'utilisateur.
            FilterChip(
              avatar: _hasPriceFilter ? null : const Icon(Icons.tune, size: 18),
              label: Text(_hasPriceFilter ? _priceLabel() : 'Prix'),
              selected: _hasPriceFilter,
              onSelected: (_) => _openPriceSheet(context),
              onDeleted: _hasPriceFilter ? () => onChanged(filter.clearPrice()) : null,
            ),
            const SizedBox(width: AllGoTokens.space2),

            FilterChip(
              avatar: filter.minRating == null ? const Icon(Icons.star_outline, size: 18) : null,
              label: Text(filter.minRating == null ? 'Note' : '≥ ${filter.minRating!.toInt()} ★'),
              selected: filter.minRating != null,
              onSelected: (_) => _openRatingSheet(context),
              onDeleted: filter.minRating != null ? () => onChanged(filter.clearRating()) : null,
            ),
            const SizedBox(width: AllGoTokens.space2),

            FilterChip(
              avatar: selectedCategory == null
                  ? const Icon(Icons.category_outlined, size: 18)
                  : null,
              label: Text(selectedCategory?.name ?? 'Catégorie'),
              selected: selectedCategory != null,
              onSelected: (_) async {
                final chosen = await _pickCategory(context, categories.valueOrNull ?? const <Category>[]);
                if (chosen != null) onChanged(filter.copyWith(categoryId: chosen.id));
              },
              onDeleted: selectedCategory != null ? () => onChanged(filter.clearCategory()) : null,
            ),
          ],
        ],
      ),
    );
  }

  String _priceLabel() {
    if (filter.minPrice != null && filter.maxPrice != null) {
      return '${Ariary.format(filter.minPrice!)} – ${Ariary.format(filter.maxPrice!)}';
    }
    if (filter.minPrice != null) return 'Dès ${Ariary.format(filter.minPrice!)}';
    return 'Jusqu’à ${Ariary.format(filter.maxPrice!)}';
  }

  Future<void> _openPriceSheet(BuildContext context) async {
    final result = await showModalBottomSheet<({int? min, int? max})>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _PriceFilterSheet(min: filter.minPrice, max: filter.maxPrice),
    );
    if (result != null) {
      onChanged(filter.copyWith(minPrice: result.min, maxPrice: result.max));
    }
  }

  Future<void> _openRatingSheet(BuildContext context) async {
    final result = await showModalBottomSheet<double?>(
      context: context,
      showDragHandle: true,
      builder: (context) => _RatingFilterSheet(value: filter.minRating),
    );
    if (result != null) onChanged(filter.copyWith(minRating: result));
    if (result == null) onChanged(filter.clearRating());
  }
}

/// Saisie d'une fourchette de prix en Ariary.
class _PriceFilterSheet extends StatefulWidget {
  const _PriceFilterSheet({this.min, this.max});

  final int? min;
  final int? max;

  @override
  State<_PriceFilterSheet> createState() => _PriceFilterSheetState();
}

class _PriceFilterSheetState extends State<_PriceFilterSheet> {
  late final TextEditingController _min = TextEditingController(
    text: widget.min?.toString() ?? '',
  );
  late final TextEditingController _max = TextEditingController(
    text: widget.max?.toString() ?? '',
  );

  @override
  void dispose() {
    _min.dispose();
    _max.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AllGoTokens.space4,
        0,
        AllGoTokens.space4,
        MediaQuery.viewInsetsOf(context).bottom + AllGoTokens.space6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Fourchette de prix', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AllGoTokens.space4),
          Row(
            children: <Widget>[
              Expanded(
                child: TextField(
                  controller: _min,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: 'Minimum', suffixText: 'Ar'),
                ),
              ),
              const SizedBox(width: AllGoTokens.space3),
              Expanded(
                child: TextField(
                  controller: _max,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: 'Maximum', suffixText: 'Ar'),
                ),
              ),
            ],
          ),
          const SizedBox(height: AllGoTokens.space6),
          FilledButton(
            onPressed: () {
              var min = int.tryParse(_min.text);
              var max = int.tryParse(_max.text);
              // Bornes inversées : on les remet dans l'ordre plutôt que de
              // renvoyer une liste vide sans explication.
              if (min != null && max != null && min > max) {
                final swap = min;
                min = max;
                max = swap;
              }
              Navigator.pop(context, (min: min, max: max));
            },
            child: const Text('Appliquer'),
          ),
        ],
      ),
    );
  }
}

/// Sélecteur de note minimale — étoiles 1 à 5.
class _RatingFilterSheet extends StatelessWidget {
  const _RatingFilterSheet({this.value});

  final double? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AllGoTokens.space4,
        0,
        AllGoTokens.space4,
        AllGoTokens.space6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Note minimale', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: AllGoTokens.space3),
          for (final stars in const <int>[5, 4, 3, 2, 1])
            ListTile(
              leading: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  for (var i = 0; i < stars; i++) const Icon(Icons.star, color: Colors.amber, size: 20),
                ],
              ),
              title: Text('$stars étoiles et plus'),
              trailing: value == stars.toDouble() ? const Icon(Icons.check) : null,
              onTap: () => Navigator.pop(context, stars.toDouble()),
            ),
          ListTile(
            title: const Text('Toutes les notes'),
            onTap: () => Navigator.pop(context),
          ),
        ],
      ),
    );
  }
}

class _ShopsTab extends ConsumerWidget {
  const _ShopsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(shopSearchFilterProvider);
    final results = ref.watch(shopSearchControllerProvider);

    return Column(
      children: <Widget>[
        _ShopFilterBar(
          filter: filter,
          onChanged: (next) => ref.read(shopSearchFilterProvider.notifier).state = next,
        ),
        Expanded(
          child: AsyncView<ShopSearchState>(
            value: results,
            isEmpty: (state) => state.items.isEmpty,
            emptyTitle: filter.query == null || filter.query!.isEmpty
                ? 'Aucune boutique pour le moment'
                : 'Aucun résultat pour « ${filter.query} »',
            emptyMessage: 'Essayez un autre terme, ou élargissez les filtres.',
            onRetry: () => ref.invalidate(shopSearchControllerProvider),
            data: (state) => CustomScrollView(
              slivers: <Widget>[
                SliverPadding(
                  padding: const EdgeInsets.all(AllGoTokens.space4),
                  sliver: SliverGrid(
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 160,
                      mainAxisSpacing: AllGoTokens.space3,
                      crossAxisSpacing: AllGoTokens.space3,
                      mainAxisExtent: 176,
                    ),
                    delegate: SliverChildBuilderDelegate(
                      (context, i) {
                        final shop = state.items[i];
                        return ShopCard(
                          slug: shop.slug,
                          name: shop.name,
                          logo: shop.logo,
                          city: shop.city,
                          rating: shop.rating,
                          distanceM: shop.distanceM,
                        );
                      },
                      childCount: state.items.length,
                    ),
                  ),
                ),
                if (state.hasMore)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: AllGoTokens.space6),
                      child: Center(
                        child: TextButton(
                          onPressed: () => ref.read(shopSearchControllerProvider.notifier).loadMore(),
                          child: const Text('Charger plus'),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ShopFilterBar extends ConsumerWidget {
  const _ShopFilterBar({required this.filter, required this.onChanged});

  final ShopFilter filter;
  final ValueChanged<ShopFilter> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(categoryTreeProvider);
    final selectedCategory = categories.valueOrNull
        ?.expand((c) => <Category>[c, ...c.children])
        .where((c) => c.id == filter.categoryId)
        .firstOrNull;

    return SizedBox(
      height: 56,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
        children: <Widget>[
          FilterChip(
            avatar: const Icon(Icons.near_me_outlined, size: 18),
            label: const Text('Proches'),
            selected: filter.onlyNearby,
            onSelected: (selected) => onChanged(filter.copyWith(onlyNearby: selected)),
          ),
          const SizedBox(width: AllGoTokens.space2),

          if (filter.onlyNearby) ...<Widget>[
            for (final km in const <double>[1, 5, 10, 20]) ...<Widget>[
              ChoiceChip(
                label: Text('${km.toInt()} km'),
                selected: filter.radiusKm == km,
                onSelected: (_) => onChanged(filter.copyWith(radiusKm: km)),
              ),
              const SizedBox(width: AllGoTokens.space2),
            ],
          ],

          FilterChip(
            avatar: selectedCategory == null ? const Icon(Icons.storefront_outlined, size: 18) : null,
            label: Text(selectedCategory?.name ?? 'Type de commerce'),
            selected: selectedCategory != null,
            onSelected: (_) async {
              final chosen = await _pickCategory(context, categories.valueOrNull ?? const <Category>[]);
              if (chosen != null) onChanged(filter.copyWith(categoryId: chosen.id));
            },
            onDeleted: selectedCategory != null ? () => onChanged(filter.clearCategory()) : null,
          ),
          const SizedBox(width: AllGoTokens.space2),

          FilterChip(
            avatar: filter.minRating == null ? const Icon(Icons.star_outline, size: 18) : null,
            label: Text(filter.minRating == null ? 'Note' : '≥ ${filter.minRating!.toInt()} ★'),
            selected: filter.minRating != null,
            onSelected: (_) async {
              final result = await showModalBottomSheet<double?>(
                context: context,
                showDragHandle: true,
                builder: (context) => _RatingFilterSheet(value: filter.minRating),
              );
              onChanged(filter.copyWith(minRating: result));
              if (result == null) onChanged(filter.clearRating());
            },
            onDeleted: filter.minRating != null ? () => onChanged(filter.clearRating()) : null,
          ),
          const SizedBox(width: AllGoTokens.space2),

          FilterChip(
            label: const Text('Ouvert maintenant'),
            selected: filter.openNow,
            onSelected: (selected) => onChanged(filter.copyWith(openNow: selected)),
          ),
          const SizedBox(width: AllGoTokens.space2),

          FilterChip(
            label: const Text('Livraison'),
            selected: filter.delivery,
            onSelected: (selected) => onChanged(filter.copyWith(delivery: selected)),
          ),
          const SizedBox(width: AllGoTokens.space2),

          FilterChip(
            label: const Text('Retrait'),
            selected: filter.pickup,
            onSelected: (selected) => onChanged(filter.copyWith(pickup: selected)),
          ),
        ],
      ),
    );
  }
}

/// Scan de code-barres — fonction exclusivement mobile (§2.2).
class _BarcodeScannerPage extends StatelessWidget {
  const _BarcodeScannerPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scanner un code-barres')),
      body: MobileScanner(
        onDetect: (capture) {
          final code = capture.barcodes.firstOrNull?.rawValue;
          // Un seul résultat est retourné : sans ce garde, la caméra
          // dépilerait l'écran plusieurs fois de suite.
          if (code != null && Navigator.of(context).canPop()) {
            Navigator.of(context).pop(code);
          }
        },
      ),
    );
  }
}
