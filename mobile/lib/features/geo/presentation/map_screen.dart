import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/geo/domain/nearby_product.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/shared/widgets/category_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geocoding/geocoding.dart' show Geocoding;
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

/// Carte WiFiMarkets — §8.1, module 1.
///
/// Fonds de carte OpenStreetMap via `flutter_map`, cohérent avec Leaflet déjà
/// utilisé sur le web. Aucun coût de licence, contrairement à Google Maps qui
/// facturerait chaque chargement de carte (§5.2).
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({this.focus, super.key});

  /// Centre imposé au chargement — ex. « Voir sur carte » depuis une fiche
  /// boutique. Prime sur la position réelle, comme une recherche de zone.
  final ({double latitude, double longitude})? focus;

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

/// Trois états seulement : un curseur horaire précis n'a pas de valeur pour
/// un client qui veut simplement savoir « puis-je y aller maintenant ? ».
enum _OpenFilter { all, open, closed }

enum _MapMode { shops, products }

class _MapScreenState extends ConsumerState<MapScreen> {
  final _mapController = MapController();
  final _searchController = TextEditingController();
  double _radiusKm = 5;
  _MapMode _mode = _MapMode.shops;
  _OpenFilter _openFilter = _OpenFilter.all;
  String? _categoryId;
  String? _categoryName;

  /// Centre choisi manuellement via la recherche de quartier/zone — prime sur
  /// la position réelle tant qu'il n'est pas effacé.
  ({double latitude, double longitude})? _searchCentre;
  bool _searching = false;

  @override
  void initState() {
    super.initState();
    _searchCentre = widget.focus;
    if (widget.focus != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _applyQuery(widget.focus!));
    }
  }

  @override
  void dispose() {
    _mapController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final position = ref.watch(currentPositionProvider);
    final shops = ref.watch(nearbyShopsProvider);
    final products = ref.watch(nearbyProductsMapProvider);

    // La requête n'est lancée qu'une fois la position connue — et le rayon
    // n'est PAS recalculé à chaque image : seul un relâchement du curseur
    // déclenche un appel réseau (voir `onChangeEnd` plus bas).
    ref.listen(currentPositionProvider, (_, next) {
      if (_searchCentre != null) return;
      next.whenData((p) {
        ref.read(nearbyQueryProvider.notifier).state = NearbyQuery(
          latitude: p.latitude,
          longitude: p.longitude,
          radiusKm: _radiusKm,
          categoryId: _categoryId,
          openNow: _openFilter == _OpenFilter.open,
          closedNow: _openFilter == _OpenFilter.closed,
        );
      });
    });

    final centre = _searchCentre ?? position.valueOrNull ?? mahajangaCentre;
    final centreLatLng = LatLng(centre.latitude, centre.longitude);

    return Scaffold(
      appBar: AppBar(title: const Text('Commerces à proximité')),
      body: Stack(
        children: <Widget>[
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: centreLatLng,
              initialZoom: 14,
              minZoom: 10,
              maxZoom: 18,
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'mg.allgo.allgo',
                // Le cache disque des tuiles est essentiel : sans lui, chaque
                // ouverture de la carte recharge plusieurs centaines de
                // kilo-octets sur un forfait de données payé au mégaoctet.
                maxNativeZoom: 18,
              ),

              // Cercle du rayon de recherche — rend le filtre lisible plutôt
              // qu'abstrait : « 5 km » ne dit rien, un cercle sur la carte si.
              CircleLayer(
                circles: <CircleMarker>[
                  CircleMarker(
                    point: centreLatLng,
                    radius: _radiusKm * 1000,
                    useRadiusInMeter: true,
                    color: AllGoTokens.brand.withValues(alpha: 0.08),
                    borderColor: AllGoTokens.brand.withValues(alpha: 0.4),
                    borderStrokeWidth: 1.5,
                  ),
                ],
              ),

              MarkerLayer(
                markers: <Marker>[
                  Marker(
                    point: centreLatLng,
                    width: 24,
                    height: 24,
                    child: const _SelfMarker(),
                  ),
                  if (_mode == _MapMode.shops)
                    ...(shops.valueOrNull ?? const <NearbyShop>[]).map(
                      (shop) => Marker(
                        point: LatLng(shop.latitude, shop.longitude),
                        width: AllGoTokens.minTouchTarget,
                        height: AllGoTokens.minTouchTarget,
                        child: _ShopMarker(
                          shop: shop,
                          onTap: () => _showShopSheet(shop),
                        ),
                      ),
                    )
                  else
                    ...(products.valueOrNull ?? const <NearbyProduct>[]).map(
                      (product) => Marker(
                        point: LatLng(product.latitude, product.longitude),
                        width: AllGoTokens.minTouchTarget,
                        height: AllGoTokens.minTouchTarget,
                        child: _ProductMarker(
                          product: product,
                          onTap: () => _showProductSheet(product),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),

          // Contrôles, en surimpression.
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: SafeArea(
              child: Column(
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
                    child: _ZoneSearchBar(
                      controller: _searchController,
                      searching: _searching,
                      hasOverride: _searchCentre != null,
                      onSearch: _searchZone,
                      onClear: () {
                        setState(() {
                          _searchCentre = null;
                          _searchController.clear();
                        });
                        final position = ref.read(currentPositionProvider).valueOrNull;
                        if (position != null) _applyQuery(position);
                      },
                    ),
                  ),
                  const SizedBox(height: AllGoTokens.space2),
                  _RadiusControl(
                    radiusKm: _radiusKm,
                    onChanged: (value) => setState(() => _radiusKm = value),
                    // L'appel réseau part au relâchement, pas à chaque pixel :
                    // un glissement continu déclencherait des dizaines de
                    // requêtes.
                    onChangeEnd: (value) {
                      final query = ref.read(nearbyQueryProvider);
                      if (query != null) {
                        ref.read(nearbyQueryProvider.notifier).state =
                            query.copyWith(radiusKm: value);
                      }
                    },
                  ),
                  const SizedBox(height: AllGoTokens.space2),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
                    child: Row(
                      children: <Widget>[
                        SegmentedButton<_MapMode>(
                          segments: const <ButtonSegment<_MapMode>>[
                            ButtonSegment<_MapMode>(
                              value: _MapMode.shops,
                              label: Text('Boutiques'),
                              icon: Icon(Icons.storefront_outlined),
                            ),
                            ButtonSegment<_MapMode>(
                              value: _MapMode.products,
                              label: Text('Produits'),
                              icon: Icon(Icons.shopping_bag_outlined),
                            ),
                          ],
                          selected: <_MapMode>{_mode},
                          onSelectionChanged: (selection) =>
                              setState(() => _mode = selection.first),
                        ),
                        const SizedBox(width: AllGoTokens.space2),
                        ActionChip(
                          avatar: const Icon(Icons.category_outlined, size: 18),
                          label: Text(_categoryName ?? 'Catégorie'),
                          onPressed: _pickCategoryFilter,
                        ),
                        if (_categoryId != null)
                          IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              setState(() {
                                _categoryId = null;
                                _categoryName = null;
                              });
                              _refreshQuery();
                            },
                          ),
                        const SizedBox(width: AllGoTokens.space1),
                        ChoiceChip(
                          label: Text(_openFilterLabel(_openFilter)),
                          selected: _openFilter != _OpenFilter.all,
                          onSelected: (_) {
                            setState(() {
                              _openFilter = _OpenFilter.values[
                                  (_openFilter.index + 1) % _OpenFilter.values.length];
                            });
                            _refreshQuery();
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Liste glissante des résultats (§8.1).
          DraggableScrollableSheet(
            initialChildSize: 0.28,
            minChildSize: 0.12,
            maxChildSize: 0.85,
            builder: (context, scrollController) => _mode == _MapMode.shops
                ? _ResultsSheet(
                    shops: shops,
                    scrollController: scrollController,
                    onSelect: (shop) {
                      _mapController.move(LatLng(shop.latitude, shop.longitude), 16);
                      _showShopSheet(shop);
                    },
                  )
                : _ProductResultsSheet(
                    products: products,
                    scrollController: scrollController,
                    onSelect: (product) {
                      _mapController.move(LatLng(product.latitude, product.longitude), 16);
                      _showProductSheet(product);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  String _openFilterLabel(_OpenFilter filter) {
    switch (filter) {
      case _OpenFilter.all:
        return 'Toutes';
      case _OpenFilter.open:
        return 'Ouvertes';
      case _OpenFilter.closed:
        return 'Fermées';
    }
  }

  void _refreshQuery() {
    final query = ref.read(nearbyQueryProvider);
    if (query == null) return;
    ref.read(nearbyQueryProvider.notifier).state = query.copyWith(
      categoryId: _categoryId,
      clearCategory: _categoryId == null,
      openNow: _openFilter == _OpenFilter.open,
      closedNow: _openFilter == _OpenFilter.closed,
    );
  }

  void _applyQuery(({double latitude, double longitude}) centre) {
    ref.read(nearbyQueryProvider.notifier).state = NearbyQuery(
      latitude: centre.latitude,
      longitude: centre.longitude,
      radiusKm: _radiusKm,
      categoryId: _categoryId,
      openNow: _openFilter == _OpenFilter.open,
      closedNow: _openFilter == _OpenFilter.closed,
    );
  }

  Future<void> _pickCategoryFilter() async {
    final tree = ref.read(categoryTreeProvider).valueOrNull ?? const <Category>[];
    final chosen = await pickCategory(context, tree);
    if (chosen == null) return;
    setState(() {
      _categoryId = chosen.id;
      _categoryName = chosen.name;
    });
    _refreshQuery();
  }

  Future<void> _searchZone(String query) async {
    final address = query.trim();
    if (address.isEmpty) return;

    setState(() => _searching = true);
    try {
      // `geocoding` interroge le service natif (Google/Apple selon la
      // plateforme) — pas d'appel à notre backend, donc aucun découpage
      // administratif à maintenir côté serveur.
      final results = await Geocoding().locationFromAddress(
        '$address, Mahajanga, Madagascar',
      );
      if (!mounted) return;

      if (results.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Lieu introuvable. Essayez un autre nom.')),
        );
        return;
      }

      final found = (latitude: results.first.latitude, longitude: results.first.longitude);
      setState(() => _searchCentre = found);
      _mapController.move(LatLng(found.latitude, found.longitude), 15);
      _applyQuery(found);
    } on Exception {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Recherche impossible pour le moment.')),
      );
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _showShopSheet(NearbyShop shop) {
    // La feuille est ouverte pour être vue, pas attendue : rien ne dépend de sa
    // fermeture.
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (context) => Padding(
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
              Text(shop.name, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: AllGoTokens.space1),
              Text(
                <String?>[
                  shop.categoryName,
                  DistanceFormat.format(shop.distanceM),
                  if (shop.deliversHere) 'Livre chez vous' else 'Hors zone de livraison',
                ].whereType<String>().join(' · '),
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: AllGoTokens.space6),
              Row(
                children: <Widget>[
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.of(context).pop();
                        unawaited(context.push<void>(Routes.shopPath(shop.slug)));
                      },
                      icon: const Icon(Icons.storefront_outlined),
                      label: const Text('Voir la boutique'),
                    ),
                  ),
                  const SizedBox(width: AllGoTokens.space3),
                  // Itinéraire délégué à l'application de navigation du système :
                  // réimplémenter du guidage turn-by-turn n'apporterait rien et
                  // pèserait lourd dans l'APK.
                  IconButton.filledTonal(
                    onPressed: () => unawaited(
                      launchUrl(
                        Uri.parse(
                          'geo:${shop.latitude},${shop.longitude}'
                          '?q=${Uri.encodeComponent(shop.name)}',
                        ),
                        mode: LaunchMode.externalApplication,
                      ),
                    ),
                    icon: const Icon(Icons.directions_outlined),
                    tooltip: 'Itinéraire',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showProductSheet(NearbyProduct product) {
    unawaited(
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (context) => Padding(
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
              Text(product.name, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: AllGoTokens.space1),
              Text(
                <String?>[
                  Ariary.format(product.promoPrice ?? product.price),
                  DistanceFormat.format(product.distanceM),
                  product.shopName,
                ].whereType<String>().join(' · '),
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: AllGoTokens.space6),
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  unawaited(context.push<void>(Routes.productPath(product.id)));
                },
                icon: const Icon(Icons.shopping_bag_outlined),
                label: const Text('Voir le produit'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ZoneSearchBar extends StatelessWidget {
  const _ZoneSearchBar({
    required this.controller,
    required this.searching,
    required this.hasOverride,
    required this.onSearch,
    required this.onClear,
  });

  final TextEditingController controller;
  final bool searching;
  final bool hasOverride;
  final ValueChanged<String> onSearch;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space2),
        child: TextField(
          controller: controller,
          textInputAction: TextInputAction.search,
          onSubmitted: onSearch,
          decoration: InputDecoration(
            border: InputBorder.none,
            hintText: 'Rechercher un quartier ou une zone…',
            prefixIcon: searching
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : const Icon(Icons.search),
            suffixIcon: hasOverride
                ? IconButton(
                    icon: const Icon(Icons.my_location),
                    tooltip: 'Revenir à ma position',
                    onPressed: onClear,
                  )
                : null,
          ),
        ),
      ),
    );
  }
}

class _SelfMarker extends StatelessWidget {
  const _SelfMarker();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary,
        shape: BoxShape.circle,
        border: const Border.fromBorderSide(BorderSide(color: Colors.white, width: 3)),
      ),
    );
  }
}

class _ShopMarker extends StatelessWidget {
  const _ShopMarker({required this.shop, required this.onTap});

  final NearbyShop shop;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${shop.name}, à ${DistanceFormat.format(shop.distanceM)}',
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Icon(
          Icons.location_on,
          size: 36,
          color: shop.deliversHere ? AllGoTokens.brand : Theme.of(context).colorScheme.outline,
        ),
      ),
    );
  }
}

class _ProductMarker extends StatelessWidget {
  const _ProductMarker({required this.product, required this.onTap});

  final NearbyProduct product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${product.name}, à ${DistanceFormat.format(product.distanceM)}',
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Icon(
          Icons.shopping_bag,
          size: 32,
          color: Theme.of(context).colorScheme.secondary,
        ),
      ),
    );
  }
}

class _RadiusControl extends StatelessWidget {
  const _RadiusControl({
    required this.radiusKm,
    required this.onChanged,
    required this.onChangeEnd,
  });

  final double radiusKm;
  final ValueChanged<double> onChanged;
  final ValueChanged<double> onChangeEnd;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
        child: Row(
          children: <Widget>[
            const Icon(Icons.adjust, size: 20),
            Expanded(
              child: Slider(
                value: radiusKm,
                min: 1,
                max: 25,
                divisions: 24,
                label: '${radiusKm.round()} km',
                onChanged: onChanged,
                onChangeEnd: onChangeEnd,
              ),
            ),
            SizedBox(
              width: 48,
              child: Text('${radiusKm.round()} km', textAlign: TextAlign.end),
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultsSheet extends StatelessWidget {
  const _ResultsSheet({
    required this.shops,
    required this.scrollController,
    required this.onSelect,
  });

  final AsyncValue<List<NearbyShop>> shops;
  final ScrollController scrollController;
  final ValueChanged<NearbyShop> onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      elevation: 8,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(AllGoTokens.radiusSheet)),
      child: shops.when(
        loading: () => const Center(
          child: Padding(
            padding: EdgeInsets.all(AllGoTokens.space6),
            child: CircularProgressIndicator(),
          ),
        ),
        error: (_, __) => const Center(
          child: Padding(
            padding: EdgeInsets.all(AllGoTokens.space6),
            child: Text('Recherche impossible. Vérifiez votre connexion.'),
          ),
        ),
        data: (list) => list.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(AllGoTokens.space6),
                  child: Text(
                    'Aucun commerce dans ce rayon.\nÉlargissez la recherche.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              )
            : ListView.separated(
                controller: scrollController,
                padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
                itemCount: list.length + 1,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  if (i == 0) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AllGoTokens.space4,
                        vertical: AllGoTokens.space2,
                      ),
                      child: Text(
                        '${list.length} commerce${list.length > 1 ? 's' : ''} '
                        'trié${list.length > 1 ? 's' : ''} par distance',
                        style: theme.textTheme.titleSmall,
                      ),
                    );
                  }

                  final shop = list[i - 1];
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      child: const Icon(Icons.storefront_outlined),
                    ),
                    title: Text(shop.name),
                    subtitle: Text(
                      <String?>[shop.categoryName, shop.city].whereType<String>().join(' · '),
                    ),
                    trailing: Text(
                      DistanceFormat.format(shop.distanceM),
                      style: theme.textTheme.labelLarge,
                    ),
                    onTap: () => onSelect(shop),
                  );
                },
              ),
      ),
    );
  }
}

class _ProductResultsSheet extends StatelessWidget {
  const _ProductResultsSheet({
    required this.products,
    required this.scrollController,
    required this.onSelect,
  });

  final AsyncValue<List<NearbyProduct>> products;
  final ScrollController scrollController;
  final ValueChanged<NearbyProduct> onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      elevation: 8,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(AllGoTokens.radiusSheet)),
      child: products.when(
        loading: () => const Center(
          child: Padding(
            padding: EdgeInsets.all(AllGoTokens.space6),
            child: CircularProgressIndicator(),
          ),
        ),
        error: (_, __) => const Center(
          child: Padding(
            padding: EdgeInsets.all(AllGoTokens.space6),
            child: Text('Recherche impossible. Vérifiez votre connexion.'),
          ),
        ),
        data: (list) => list.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(AllGoTokens.space6),
                  child: Text(
                    'Aucun produit dans ce rayon.\nÉlargissez la recherche.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              )
            : ListView.separated(
                controller: scrollController,
                padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
                itemCount: list.length + 1,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  if (i == 0) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AllGoTokens.space4,
                        vertical: AllGoTokens.space2,
                      ),
                      child: Text(
                        '${list.length} produit${list.length > 1 ? 's' : ''} '
                        'trié${list.length > 1 ? 's' : ''} par distance',
                        style: theme.textTheme.titleSmall,
                      ),
                    );
                  }

                  final product = list[i - 1];
                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      backgroundImage:
                          product.thumbUrl != null ? NetworkImage(product.thumbUrl!) : null,
                      child: product.thumbUrl == null
                          ? const Icon(Icons.shopping_bag_outlined)
                          : null,
                    ),
                    title: Text(product.name),
                    subtitle: Text(
                      <String?>[
                        Ariary.format(product.promoPrice ?? product.price),
                        product.shopName,
                      ].whereType<String>().join(' · '),
                    ),
                    trailing: Text(
                      DistanceFormat.format(product.distanceM),
                      style: theme.textTheme.labelLarge,
                    ),
                    onTap: () => onSelect(product),
                  );
                },
              ),
      ),
    );
  }
}
