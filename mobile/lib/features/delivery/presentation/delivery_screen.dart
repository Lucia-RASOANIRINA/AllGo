import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/features/orders/presentation/orders_screen.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

class DeliveryScreen extends ConsumerStatefulWidget {
  const DeliveryScreen({super.key});

  @override
  ConsumerState<DeliveryScreen> createState() => _DeliveryScreenState();
}

class _DeliveryScreenState extends ConsumerState<DeliveryScreen> {
  final MapController _mapController = MapController();
  final List<LatLng> _courierRoute = const <LatLng>[
    LatLng(-15.7167, 46.3167),
    LatLng(-15.7181, 46.3195),
    LatLng(-15.7209, 46.3221),
    LatLng(-15.7236, 46.3256),
    LatLng(-15.7272, 46.3278),
  ];
  Timer? _timer;
  int _routeIndex = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted) return;
      setState(() {
        _routeIndex = (_routeIndex + 1) % _courierRoute.length;
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ordersAsync = ref.watch(myOrdersProvider);
    final position = ref.watch(currentPositionProvider);
    final courierPoint = _courierRoute[_routeIndex];
    final center = position.valueOrNull ?? const (latitude: -15.7167, longitude: 46.3167);

    final deliveries = ordersAsync.valueOrNull
            ?.where((order) =>
                order.status != OrderStatus.cancelled &&
                order.status != OrderStatus.delivered)
            .toList() ??
        const <OrderSummary>[];

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _mapController.move(LatLng(center.latitude, center.longitude), 14);
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Suivi du livreur')),
      body: AsyncView<List<OrderSummary>>(
        value: ordersAsync,
        isEmpty: (list) => list.isEmpty,
        emptyTitle: 'Aucune livraison en cours',
        emptyMessage:
            'Les livraisons actives apparaîtront ici avec leur position et leur trajectoire.',
        emptyAction: FilledButton(
          onPressed: () => context.go(Routes.home),
          child: const Text('Retour à l’accueil'),
        ),
        onRetry: () => ref.invalidate(myOrdersProvider),
        data: (list) => Stack(
          children: <Widget>[
            FlutterMap(
              mapController: _mapController,
              options: MapOptions(
                initialCenter: LatLng(center.latitude, center.longitude),
                initialZoom: 14,
                minZoom: 10,
                maxZoom: 18,
              ),
              children: <Widget>[
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'mg.allgo.allgo',
                  maxNativeZoom: 18,
                ),
                PolylineLayer(
                  polylines: <Polyline>[
                    Polyline(
                      points: _courierRoute,
                      strokeWidth: 5,
                      color: AllGoTokens.brand.withOpacity(0.8),
                    ),
                  ],
                ),
                MarkerLayer(
                  markers: <Marker>[
                    Marker(
                      point: LatLng(center.latitude, center.longitude),
                      width: 32,
                      height: 32,
                      child: const _UserMarker(),
                    ),
                    Marker(
                      point: courierPoint,
                      width: 40,
                      height: 40,
                      child: const _CourierMarker(),
                    ),
                    ..._deliveryPoints(list).map(
                      (point) => Marker(
                        point: point,
                        width: 28,
                        height: 28,
                        child: const _DeliveryMarker(),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            Positioned(
              left: AllGoTokens.space4,
              right: AllGoTokens.space4,
              bottom: AllGoTokens.space4,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(AllGoTokens.space4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          const Icon(Icons.local_shipping_outlined,
                              color: AllGoTokens.brand),
                          const SizedBox(width: AllGoTokens.space2),
                          Text('Livreur en route',
                              style: Theme.of(context).textTheme.titleMedium),
                        ],
                      ),
                      const SizedBox(height: AllGoTokens.space2),
                      Text(
                        'Tovo • ${_etaText(_routeIndex)} • ${deliveries.length} livraison${deliveries.length > 1 ? 's' : ''}',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: AllGoTokens.space3),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: FilledButton.tonal(
                              onPressed: () => context.push(Routes.map),
                              child: const Text('Voir la carte'),
                            ),
                          ),
                          const SizedBox(width: AllGoTokens.space2),
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => context.push(Routes.orders),
                              child: const Text('Commandes'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<LatLng> _deliveryPoints(List<OrderSummary> list) {
    final points = <LatLng>[
      const LatLng(-15.7187, 46.3208),
      const LatLng(-15.7218, 46.3246),
      const LatLng(-15.7260, 46.3282),
    ];

    if (list.isEmpty) {
      return points.take(1).toList();
    }

    return points.take(list.length.clamp(1, 3)).toList();
  }

  String _etaText(int index) {
    final eta = <String>['2 min', '6 min', '11 min', '16 min', '20 min'];
    return eta[index % eta.length];
  }
}

class _UserMarker extends StatelessWidget {
  const _UserMarker();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: AllGoTokens.brand, width: 3),
      ),
      child: const Icon(Icons.navigation, color: AllGoTokens.brand, size: 16),
    );
  }
}

class _CourierMarker extends StatelessWidget {
  const _CourierMarker();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AllGoTokens.brand,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 3),
      ),
      child: const Icon(Icons.delivery_dining, color: Colors.white, size: 18),
    );
  }
}

class _DeliveryMarker extends StatelessWidget {
  const _DeliveryMarker();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.orange.shade700,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
      ),
      child: const Icon(Icons.location_on, color: Colors.white, size: 14),
    );
  }
}
