import 'dart:async';
import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';

class CourierDashboardScreen extends ConsumerStatefulWidget {
  const CourierDashboardScreen({super.key});
  @override
  ConsumerState<CourierDashboardScreen> createState() => _CourierDashboardScreenState();
}

class _CourierDashboardScreenState extends ConsumerState<CourierDashboardScreen> {
  bool available = false;
  StreamSubscription<Position>? _positionSubscription;
  String? _trackingOrderId;

  @override
  void dispose() {
    _positionSubscription?.cancel();
    super.dispose();
  }
  Future<List<Map<String, dynamic>>> _missions() async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/courier/missions');
    final data = response.data?['data'];
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : [];
  }
  Future<void> _availability(bool value) async {
    await ref.read(apiClientProvider).patch<void>('/me', data: {'courierAvailable': value});
    if (mounted) setState(() => available = value);
  }
  Future<void> _sharePosition(Map<String, dynamic> mission) async {
    final permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) return;
    final orderId = (mission['id'] ?? mission['_id']).toString();
    await _positionSubscription?.cancel();
    if (_trackingOrderId == orderId) {
      setState(() => _trackingOrderId = null);
      return;
    }
    _trackingOrderId = orderId;
    final realtime = ref.read(realtimeClientProvider);
    final settings = const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 20,
    );
    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: settings,
    ).listen((position) {
      realtime.publishDeliveryPosition(
        orderId: orderId,
        latitude: position.latitude,
        longitude: position.longitude,
      );
    });
    if (mounted) setState(() {});
  }
  Future<void> _openNavigation(Map<String, dynamic> mission) async {
    final coordinates = mission['delivery']?['location']?['coordinates'];
    if (coordinates is! List || coordinates.length < 2) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Adresse GPS indisponible pour cette mission')),
        );
      }
      return;
    }
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=${coordinates[1]},${coordinates[0]}',
    );
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Impossible d’ouvrir la navigation')),
      );
    }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Espace livreur')),
    body: Column(children: [
      SwitchListTile(title: const Text('Disponible pour les missions'), value: available, onChanged: _availability),
      Expanded(child: FutureBuilder<List<Map<String, dynamic>>>(
        future: _missions(),
        builder: (_, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          return ListView(children: snapshot.data!.map((mission) => Card(child: ListTile(
            title: Text('Mission ${mission['orderNumber'] ?? ''}'),
            subtitle: Text('${mission['shop']?['name'] ?? ''} → ${mission['delivery']?['address'] ?? 'Adresse client'}\nWorkflow : ${mission['delivery']?['workflowStatus'] ?? 'received'}'),
            isThreeLine: true,
            trailing: PopupMenuButton<String>(
              onSelected: (action) async {
                final id = (mission['id'] ?? mission['_id']).toString();
                if (action == 'accept') {
                  await ref.read(apiClientProvider).patch<void>('/courier/missions/$id/accept');
                } else if (action == 'refuse') {
                  await ref.read(apiClientProvider).patch<void>('/courier/missions/$id/refuse');
                } else if (action == 'position') {
                  await _sharePosition(mission);
                } else if (action == 'navigation') {
                  await _openNavigation(mission);
                } else if (action == 'earnings') {
                  if (mounted) context.push('/livreur/revenus');
                } else {
                  await ref.read(apiClientProvider).patch<void>('/courier/missions/$id/workflow', data: {'status': action});
                }
                if (mounted) setState(() {});
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'accept', child: Text('Accepter')),
                PopupMenuItem(value: 'refuse', child: Text('Refuser')),
                PopupMenuItem(value: 'position', child: Text('Partager ma position')),
                PopupMenuItem(value: 'navigation', child: Text('Navigation')),
                PopupMenuItem(value: 'earnings', child: Text('Mes revenus')),
                PopupMenuItem(value: 'to_shop', child: Text('Vers boutique')),
                PopupMenuItem(value: 'picked_up', child: Text('Commande récupérée')),
                PopupMenuItem(value: 'to_client', child: Text('Vers client')),
                PopupMenuItem(value: 'client_found', child: Text('Client trouvé')),
              ],
            ),
          ))).toList());
        },
      )),
    ]),
  );
}
