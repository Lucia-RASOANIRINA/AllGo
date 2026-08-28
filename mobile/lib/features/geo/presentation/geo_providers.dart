import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/geo/data/geo_repository_impl.dart';
import 'package:allgo/features/geo/domain/nearby_product.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Centre de Mahajanga — repli lorsque la position est indisponible ou refusée.
const ({double latitude, double longitude}) mahajangaCentre =
    (latitude: -15.7167, longitude: 46.3167);

final geoRepositoryProvider = Provider<GeoRepository>(
  (ref) => GeoRepositoryImpl(ref.watch(apiClientProvider)),
);

/// Position de départ de la carte.
///
/// Ne bloque jamais : si l'autorisation est refusée ou le GPS indisponible, on
/// centre sur Mahajanga plutôt que d'afficher une erreur. Un utilisateur qui
/// refuse la géolocalisation doit quand même pouvoir explorer la carte.
final currentPositionProvider = FutureProvider<({double latitude, double longitude})>((ref) async {
  final position = await ref.watch(geoRepositoryProvider).currentPosition();
  return position ?? mahajangaCentre;
});

final StateProvider<NearbyQuery?> nearbyQueryProvider = StateProvider<NearbyQuery?>((_) => null);

/// Boutiques à proximité — `$geoNear` indexé côté serveur, cible < 150 ms.
final AutoDisposeFutureProvider<List<NearbyShop>> nearbyShopsProvider =
    FutureProvider.autoDispose<List<NearbyShop>>((ref) async {
  final query = ref.watch(nearbyQueryProvider);
  if (query == null) return <NearbyShop>[];

  return ref.watch(geoRepositoryProvider).nearbyShops(query);
});

/// Produits à proximité — carte, même requête que `nearbyShopsProvider`.
final AutoDisposeFutureProvider<List<NearbyProduct>> nearbyProductsMapProvider =
    FutureProvider.autoDispose<List<NearbyProduct>>((ref) async {
  final query = ref.watch(nearbyQueryProvider);
  if (query == null) return <NearbyProduct>[];

  return ref.watch(geoRepositoryProvider).nearbyProducts(query);
});

/// Boutiques proches — rail d'accueil, basé sur la position courante (repli
/// Mahajanga inclus). Se vide silencieusement sans réseau/position.
final AutoDisposeFutureProvider<List<NearbyShop>> nearbyShopsHomeProvider =
    FutureProvider.autoDispose<List<NearbyShop>>((ref) async {
  final position = await ref.watch(currentPositionProvider.future);
  try {
    return await ref.watch(geoRepositoryProvider).nearbyShops(
          NearbyQuery(
            latitude: position.latitude,
            longitude: position.longitude,
          ),
        );
  } on Exception {
    return const <NearbyShop>[];
  }
});

/// Produits proches — rail d'accueil, même position que ci-dessus.
final AutoDisposeFutureProvider<List<NearbyProduct>> nearbyProductsHomeProvider =
    FutureProvider.autoDispose<List<NearbyProduct>>((ref) async {
  final position = await ref.watch(currentPositionProvider.future);
  try {
    return await ref.watch(geoRepositoryProvider).nearbyProducts(
          NearbyQuery(
            latitude: position.latitude,
            longitude: position.longitude,
          ),
        );
  } on Exception {
    return const <NearbyProduct>[];
  }
});
