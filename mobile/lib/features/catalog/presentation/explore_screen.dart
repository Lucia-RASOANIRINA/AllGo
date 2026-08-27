import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  /// Anti-rebond de 300 ms.
  ///
  /// Sans lui, taper « riz » déclencherait trois requêtes réseau. Sur un
  /// forfait payé au mégaoctet, la frappe d'un utilisateur ne doit pas coûter
  /// d'argent (§13.1 — moins de 1,5 Mo pour une session de 5 minutes).
  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final filter = ref.read(catalogFilterProvider);
      final trimmed = value.trim();
      ref.read(catalogFilterProvider.notifier).state =
          trimmed.isEmpty ? filter.clearQuery() : filter.copyWith(query: trimmed);
    });
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
    final results = ref.watch(catalogProvider);
    final filter = ref.watch(catalogFilterProvider);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: AllGoTokens.space4,
        title: TextField(
          controller: _controller,
          onChanged: _onQueryChanged,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Rechercher un produit…',
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
          IconButton(
            onPressed: _scanBarcode,
            icon: const Icon(Icons.qr_code_scanner),
            tooltip: 'Scanner un code-barres',
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          _FilterBar(
            filter: filter,
            onChanged: (next) => ref.read(catalogFilterProvider.notifier).state = next,
          ),
          Expanded(
            child: AsyncView<List<Product>>(
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
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.filter, required this.onChanged});

  final ProductFilter filter;
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
            label: const Text('En stock'),
            selected: filter.inStockOnly,
            onSelected: (selected) => onChanged(filter.copyWith(inStockOnly: selected)),
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
            avatar: selectedCategory == null ? const Icon(Icons.category_outlined, size: 18) : null,
            label: Text(selectedCategory?.name ?? 'Catégorie'),
            selected: selectedCategory != null,
            onSelected: (_) => _openCategorySheet(context, categories.valueOrNull),
            onDeleted: selectedCategory != null ? () => onChanged(filter.clearCategory()) : null,
          ),
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

  Future<void> _openCategorySheet(BuildContext context, List<Category>? tree) async {
    if (tree == null || tree.isEmpty) return;

    final chosen = await showModalBottomSheet<Category>(
      context: context,
      showDragHandle: true,
      builder: (context) => ListView(
        shrinkWrap: true,
        children: <Widget>[
          for (final root in tree) ...<Widget>[
            ListTile(
              title: Text(root.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              onTap: () => Navigator.pop(context, root),
            ),
            // Les sous-catégories sont proposées à plat, avec un retrait :
            // une arborescence dépliable sur une feuille de 6 pouces coûte
            // plus de gestes qu'elle n'en fait gagner.
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
    );

    if (chosen != null) onChanged(filter.copyWith(categoryId: chosen.id));
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
