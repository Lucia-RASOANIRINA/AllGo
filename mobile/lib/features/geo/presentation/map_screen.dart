import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/shared/widgets/shop_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

/// Carte WiFiMarkets — §8.1, module 1.
///
/// Fonds de carte OpenStreetMap via `flutter_map`, cohérent avec Leaflet déjà
/// utilisé sur le web. Aucun coût de licence, contrairement à Google Maps qui
/// facturerait chaque chargement de carte (§5.2).
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  final _mapController = MapController();
  double _radiusKm = 5;

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final position = ref.watch(currentPositionProvider);
    final shops = ref.watch(nearbyShopsProvider);

    // La requête n'est lancée qu'une fois la position connue — et le rayon
    // n'est PAS recalculé à chaque image : seul un relâchement du curseur
    // déclenche un appel réseau (voir `onChangeEnd` plus bas).
    ref.listen(currentPositionProvider, (_, next) {
      next.whenData((p) {
        ref.read(nearbyQueryProvider.notifier).state = NearbyQuery(
          latitude: p.latitude,
          longitude: p.longitude,
          radiusKm: _radiusKm,
        );
      });
    });

    final centre = position.valueOrNull ?? mahajangaCentre;
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
                  ),
                ],
              ),
            ],
          ),

          // Curseur de rayon, en surimpression.
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: _RadiusControl(
              radiusKm: _radiusKm,
              onChanged: (value) => setState(() => _radiusKm = value),
              // L'appel réseau part au relâchement, pas à chaque pixel : un
              // glissement continu déclencherait des dizaines de requêtes.
              onChangeEnd: (value) {
                final query = ref.read(nearbyQueryProvider);
                if (query != null) {
                  ref.read(nearbyQueryProvider.notifier).state = query.copyWith(radiusKm: value);
                }
              },
            ),
          ),

          // Liste glissante des résultats (§8.1).
          DraggableScrollableSheet(
            initialChildSize: 0.28,
            minChildSize: 0.12,
            maxChildSize: 0.85,
            builder: (context, scrollController) => _ResultsSheet(
              shops: shops,
              scrollController: scrollController,
              onSelect: (shop) {
                _mapController.move(LatLng(shop.latitude, shop.longitude), 16);
                _showShopSheet(shop);
              },
            ),
          ),
        ],
      ),
    );
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
    return SafeArea(
      child: Card(
        margin: const EdgeInsets.all(AllGoTokens.space3),
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
                    leading: ShopAvatar(
                      name: shop.name,
                      logoUrl: shop.logo,
                      categoryName: shop.categoryName,
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
