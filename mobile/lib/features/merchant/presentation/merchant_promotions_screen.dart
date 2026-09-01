import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class MerchantPromotionsScreen extends ConsumerStatefulWidget {
  const MerchantPromotionsScreen({super.key});
  @override
  ConsumerState<MerchantPromotionsScreen> createState() => _MerchantPromotionsScreenState();
}

class _MerchantPromotionsScreenState extends ConsumerState<MerchantPromotionsScreen> {
  Future<List<Map<String, dynamic>>> load() async {
    final api = ref.read(apiClientProvider);
    final shops = await api.get<Map<String, dynamic>>('/me/shops');
    final list = shops.data?['data'];
    if (list is! List || list.isEmpty) throw StateError('Aucune boutique.');
    final shop = list.first as Map<String, dynamic>;
    final id = (shop['id'] ?? shop['_id']).toString();
    final response = await api.get<Map<String, dynamic>>('/shop/$id/promotions');
    final data = response.data?['data'];
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : [];
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Promotions')),
    floatingActionButton: FloatingActionButton.extended(onPressed: () => _create(context), icon: const Icon(Icons.add), label: const Text('Créer')),
    body: FutureBuilder<List<Map<String, dynamic>>>(
      future: load(),
      builder: (_, snapshot) {
        if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
        return ListView(children: snapshot.data!.map((p) => ListTile(
          title: Text(p['name']?.toString() ?? 'Promotion'),
          subtitle: Text('${p['type']} : ${p['value']} • ${p['couponCode'] ?? 'Sans coupon'}'),
          trailing: Icon(p['flash'] == true ? Icons.flash_on : Icons.local_offer_outlined),
        )).toList());
      },
    ),
  );

  Future<void> _create(BuildContext context) async {
    final name = TextEditingController(), value = TextEditingController();
    String type = 'percent';
    await showDialog<void>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setState) => AlertDialog(
      title: const Text('Nouvelle promotion'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: name, decoration: const InputDecoration(labelText: 'Nom')),
        TextField(controller: value, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Valeur')),
        DropdownButton<String>(value: type, items: const [
          DropdownMenuItem(value: 'percent', child: Text('Réduction %')),
          DropdownMenuItem(value: 'fixed', child: Text('Réduction fixe')),
          DropdownMenuItem(value: 'price', child: Text('Prix promotionnel')),
        ], onChanged: (v) => setState(() => type = v!)),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Annuler')), FilledButton(onPressed: () async {
        final shops = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
        final list = shops.data?['data'] as List;
        final shop = list.first as Map<String, dynamic>;
        await ref.read(apiClientProvider).post<void>('/shop/${shop['id'] ?? shop['_id']}/promotions', data: {
          'name': name.text, 'type': type, 'value': double.tryParse(value.text) ?? 0,
          'startsAt': DateTime.now().toIso8601String(), 'endsAt': DateTime.now().add(const Duration(days: 30)).toIso8601String(),
        });
        if (dialogContext.mounted) Navigator.pop(dialogContext);
        setState(() {});
      }, child: const Text('Créer'))],
    )));
    name.dispose(); value.dispose();
    if (mounted) setState(() {});
  }
}
