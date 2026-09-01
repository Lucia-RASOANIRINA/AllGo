import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class CourierDashboardScreen extends ConsumerStatefulWidget {
  const CourierDashboardScreen({super.key});
  @override
  ConsumerState<CourierDashboardScreen> createState() => _CourierDashboardScreenState();
}

class _CourierDashboardScreenState extends ConsumerState<CourierDashboardScreen> {
  bool available = false;
  Future<List<Map<String, dynamic>>> _missions() async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/courier/missions');
    final data = response.data?['data'];
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : [];
  }
  Future<void> _availability(bool value) async {
    await ref.read(apiClientProvider).patch<void>('/me', data: {'courierAvailable': value});
    if (mounted) setState(() => available = value);
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
                } else {
                  await ref.read(apiClientProvider).patch<void>('/courier/missions/$id/workflow', data: {'status': action});
                }
                if (mounted) setState(() {});
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'accept', child: Text('Accepter')),
                PopupMenuItem(value: 'refuse', child: Text('Refuser')),
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
