import 'dart:async';
import 'package:allgo/core/network/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:allgo/shared/widgets/shimmer.dart';
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
  Future<Map<String, dynamic>> _todayStats() async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/courier/earnings');
    final summary = response.data?['data'];
    final today = summary is Map ? summary['today'] : null;
    return today is Map ? Map<String, dynamic>.from(today) : const <String, dynamic>{};
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
  /// Vue détaillée d'une mission — jusqu'ici, seul le menu d'actions rapides
  /// existait, sans jamais donner au livreur les articles ou le contact
  /// client. C'est ici aussi que la livraison se confirme : `POST
  /// courier/missions/:id/complete` n'était appelé nulle part dans
  /// l'application, alors qu'il ferme le workflow serveur (`OrdersService.
  /// completeDelivery`) et déclenche le calcul de la commission (§Finance).
  Future<void> _showMissionDetail(BuildContext context, Map<String, dynamic> mission) async {
    final shop = mission['shop'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final delivery = mission['delivery'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final customer = mission['customer'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final items = ((mission['items'] as List<dynamic>?) ?? const <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .toList();
    final phone = customer['phone']?.toString();
    final workflowStatus = delivery['workflowStatus']?.toString() ?? 'received';

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Mission ${mission['orderNumber'] ?? ''}'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('Boutique : ${shop['name'] ?? '—'}'),
              Text('Client : ${customer['name'] ?? '—'} · ${phone ?? '—'}'),
              Text('Adresse : ${delivery['address'] ?? '—'}'),
              const SizedBox(height: 12),
              Text('Articles (${items.length})', style: Theme.of(context).textTheme.titleSmall),
              for (final item in items)
                Text('• ${item['quantity'] ?? 1} × ${item['name'] ?? ''}'),
            ],
          ),
        ),
        actions: <Widget>[
          if (phone != null && phone.isNotEmpty)
            TextButton.icon(
              onPressed: () => launchUrl(Uri.parse('tel:$phone')),
              icon: const Icon(Icons.call_outlined),
              label: const Text('Appeler'),
            ),
          if (workflowStatus == 'client_found')
            FilledButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                _completeDelivery(context, mission);
              },
              child: const Text('Confirmer la livraison'),
            ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Fermer'),
          ),
        ],
      ),
    );
  }

  Future<void> _completeDelivery(BuildContext context, Map<String, dynamic> mission) async {
    final otp = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Code de livraison'),
        content: TextField(
          controller: otp,
          keyboardType: TextInputType.number,
          maxLength: 4,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Code communiqué par le client',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Valider'),
          ),
        ],
      ),
    );
    final code = otp.text.trim();
    otp.dispose();
    if (confirmed != true || !context.mounted) return;

    final id = (mission['id'] ?? mission['_id']).toString();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).post<void>(
        '/courier/missions/$id/complete',
        data: <String, dynamic>{'otp': code},
      );
      if (mounted) setState(() {});
      messenger.showSnackBar(const SnackBar(content: Text('Livraison confirmée.')));
    } on DioException catch (error) {
      final body = error.response?.data;
      final message = body is Map<String, dynamic>
          ? ((body['error'] as Map<String, dynamic>?)?['message'] as String?)
          : null;
      messenger.showSnackBar(
        SnackBar(content: Text(message ?? 'Code invalide ou mission introuvable.')),
      );
    }
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
      FutureBuilder<Map<String, dynamic>>(
        future: _todayStats(),
        builder: (_, snapshot) {
          final today = snapshot.data ?? const <String, dynamic>{};
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: <Widget>[
                    _StatColumn(label: 'Livraisons', value: '${today['deliveries'] ?? 0}'),
                    _StatColumn(label: 'Gains du jour', value: '${today['total'] ?? 0} Ar'),
                    _StatColumn(label: 'Pourboires', value: '${today['tips'] ?? 0} Ar'),
                  ],
                ),
              ),
            ),
          );
        },
      ),
      Expanded(child: FutureBuilder<List<Map<String, dynamic>>>(
        future: _missions(),
        builder: (_, snapshot) {
          if (!snapshot.hasData) {
            return Shimmer(
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: 4,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (_, __) => const SkeletonBox(width: double.infinity, height: 88),
              ),
            );
          }
          if (snapshot.data!.isEmpty) return const Center(child: Text('Aucune mission pour le moment.'));
          return ListView(children: snapshot.data!.map((mission) => Card(child: ListTile(
            title: Text('Mission ${mission['orderNumber'] ?? ''}'),
            subtitle: Text('${mission['shop']?['name'] ?? ''} → ${mission['delivery']?['address'] ?? 'Adresse client'}\nWorkflow : ${mission['delivery']?['workflowStatus'] ?? 'received'}'),
            isThreeLine: true,
            onTap: () => _showMissionDetail(context, mission),
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
                } else if (action == 'complete') {
                  await _completeDelivery(context, mission);
                } else {
                  await ref.read(apiClientProvider).patch<void>('/courier/missions/$id/workflow', data: {'status': action});
                }
                if (mounted) setState(() {});
              },
              itemBuilder: (_) => <PopupMenuEntry<String>>[
                const PopupMenuItem(value: 'accept', child: Text('Accepter')),
                const PopupMenuItem(value: 'refuse', child: Text('Refuser')),
                const PopupMenuItem(value: 'position', child: Text('Partager ma position')),
                const PopupMenuItem(value: 'navigation', child: Text('Navigation')),
                const PopupMenuItem(value: 'earnings', child: Text('Mes revenus')),
                const PopupMenuItem(value: 'to_shop', child: Text('Vers boutique')),
                const PopupMenuItem(value: 'picked_up', child: Text('Commande récupérée')),
                const PopupMenuItem(value: 'to_client', child: Text('Vers client')),
                const PopupMenuItem(value: 'client_found', child: Text('Client trouvé')),
                if (mission['delivery']?['workflowStatus'] == 'client_found')
                  const PopupMenuItem(value: 'complete', child: Text('Confirmer la livraison')),
              ],
            ),
          ))).toList());
        },
      )),
    ]),
  );
}

class _StatColumn extends StatelessWidget {
  const _StatColumn({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
        children: <Widget>[
          Text(value, style: Theme.of(context).textTheme.titleMedium),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}
