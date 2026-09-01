import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class MerchantTeamScreen extends ConsumerStatefulWidget {
  const MerchantTeamScreen({super.key});
  @override
  ConsumerState<MerchantTeamScreen> createState() => _MerchantTeamScreenState();
}

class _MerchantTeamScreenState extends ConsumerState<MerchantTeamScreen> {
  Future<List<Map<String, dynamic>>> _load() async {
    final api = ref.read(apiClientProvider);
    final shops = await api.get<Map<String, dynamic>>('/me/shops');
    final list = shops.data?['data'];
    if (list is! List || list.isEmpty) throw StateError('Aucune boutique.');
    final shop = list.first as Map<String, dynamic>;
    final response = await api.get<Map<String, dynamic>>(
        '/shop/${shop['id'] ?? shop['_id']}/team');
    final data = response.data?['data'];
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : [];
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Gestion de l’équipe')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _add,
          icon: const Icon(Icons.person_add_alt_1),
          label: const Text('Ajouter'),
        ),
        body: FutureBuilder<List<Map<String, dynamic>>>(
          future: _load(),
          builder: (_, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            return ListView(
              children: snapshot.data!
                  .map((member) => ListTile(
                        leading: const CircleAvatar(child: Icon(Icons.person)),
                        title: Text(member['name']?.toString() ?? 'Employé'),
                        subtitle: Text(_label(member['role']?.toString())),
                        trailing: member['role'] == 'shop_owner'
                            ? null
                            : PopupMenuButton<String>(
                                onSelected: (action) =>
                                    _memberAction(member, action),
                                itemBuilder: (_) => const [
                                  PopupMenuItem(
                                      value: 'manager',
                                      child: Text('Manager')),
                                  PopupMenuItem(
                                      value: 'cashier',
                                      child: Text('Caissier')),
                                  PopupMenuItem(
                                      value: 'stock',
                                      child: Text('Gestionnaire stock')),
                                  PopupMenuItem(
                                      value: 'marketing',
                                      child: Text('Community manager')),
                                  PopupMenuItem(
                                      value: 'remove',
                                      child: Text('Retirer')),
                                ],
                              ),
                      ))
                  .toList(),
            );
          },
        ),
      );

  String _label(String? role) => {
        'shop_owner': 'Propriétaire',
        'shop_manager': 'Manager — commandes et produits',
        'shop_sales': 'Préparateur — commandes',
        'shop_cashier': 'Caissier — paiements',
        'shop_stock': 'Gestionnaire stock — inventaire',
        'shop_marketing': 'Community manager — publications',
      }[role] ?? 'Employé';

  Future<void> _add() async {
    final phone = TextEditingController();
    String role = 'shop_manager';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Ajouter un employé'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
                controller: phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Téléphone')),
            DropdownButton<String>(
              value: role,
              items: const [
                DropdownMenuItem(
                    value: 'shop_manager', child: Text('Manager')),
                DropdownMenuItem(value: 'shop_sales', child: Text('Préparateur')),
                DropdownMenuItem(value: 'shop_cashier', child: Text('Caissier')),
                DropdownMenuItem(
                    value: 'shop_stock', child: Text('Gestionnaire stock')),
                DropdownMenuItem(
                    value: 'shop_marketing',
                    child: Text('Community manager')),
              ],
              onChanged: (value) => setState(() => role = value!),
            ),
          ]),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Annuler')),
            FilledButton(
              onPressed: () async {
                final shops = await ref
                    .read(apiClientProvider)
                    .get<Map<String, dynamic>>('/me/shops');
                final list = shops.data?['data'] as List;
                final shop = list.first as Map<String, dynamic>;
                await ref.read(apiClientProvider).post<void>(
                  '/shop/${shop['id'] ?? shop['_id']}/team',
                  data: {'phone': phone.text.trim(), 'role': role},
                );
                if (dialogContext.mounted) Navigator.pop(dialogContext);
                if (mounted) setState(() {});
              },
              child: const Text('Ajouter'),
            ),
          ],
        ),
      ),
    );
    phone.dispose();
  }

  Future<void> _memberAction(Map<String, dynamic> member, String action) async {
    final shops =
        await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
    final list = shops.data?['data'] as List;
    final shop = list.first as Map<String, dynamic>;
    final shopId = (shop['id'] ?? shop['_id']).toString();
    final rawUserId = member['userId'];
    final userId = rawUserId is Map
        ? (rawUserId['_id'] ?? rawUserId['id']).toString()
        : rawUserId.toString();
    if (action == 'remove') {
      await ref.read(apiClientProvider).delete<void>('/shop/$shopId/team/$userId');
    } else {
      final role = {
        'manager': 'shop_manager',
        'cashier': 'shop_cashier',
        'stock': 'shop_stock',
        'marketing': 'shop_marketing',
      }[action]!;
      await ref.read(apiClientProvider).patch<void>('/shop/$shopId/team/$userId',
          data: {'role': role});
    }
    if (mounted) setState(() {});
  }
}
