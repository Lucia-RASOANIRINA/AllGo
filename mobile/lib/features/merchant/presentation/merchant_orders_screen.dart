import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/shared/utils/receipt_pdf.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class MerchantOrdersScreen extends ConsumerStatefulWidget {
  const MerchantOrdersScreen({super.key});
  @override
  ConsumerState<MerchantOrdersScreen> createState() => _MerchantOrdersScreenState();
}

class _MerchantOrdersScreenState extends ConsumerState<MerchantOrdersScreen> {
  String? status;
  String query = '';
  final search = TextEditingController();

  Future<Map<String, dynamic>> _shop() async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
    final items = response.data?['data'];
    if (items is! List || items.isEmpty) throw StateError('Aucune boutique associée.');
    return items.first as Map<String, dynamic>;
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final shop = await _shop();
    final shopId = (shop['id'] ?? shop['_id']).toString();
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/shop/$shopId/orders',
      queryParameters: <String, dynamic>{'limit': 50, if (status != null) 'status': status, if (query.isNotEmpty) 'q': query},
    );
    final data = response.data?['data'];
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : <Map<String, dynamic>>[];
  }

  @override
  void dispose() { search.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Commandes commerçant')),
    body: Column(children: [
      Padding(
        padding: const EdgeInsets.all(AllGoTokens.space3),
        child: TextField(
          controller: search,
          decoration: const InputDecoration(labelText: 'Rechercher commande ou téléphone', prefixIcon: Icon(Icons.search)),
          onSubmitted: (value) => setState(() => query = value.trim()),
        ),
      ),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
        child: Row(children: [
          FilterChip(label: const Text('Toutes'), selected: status == null, onSelected: (_) => setState(() => status = null)),
          for (final item in const [('pending', 'Nouvelles'), ('preparing', 'En préparation'), ('shipped', 'Prêtes / expédiées'), ('delivered', 'Livrées'), ('cancelled', 'Annulées')])
            Padding(padding: const EdgeInsets.only(left: 8), child: FilterChip(label: Text(item.$2), selected: status == item.$1, onSelected: (_) => setState(() => status = item.$1))),
        ]),
      ),
      Expanded(child: FutureBuilder<List<Map<String, dynamic>>>(
        future: _load(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) return Center(child: Text('Erreur : ${snapshot.error}'));
          final orders = snapshot.data ?? <Map<String, dynamic>>[];
          if (orders.isEmpty) return const Center(child: Text('Aucune commande'));
          return RefreshIndicator(
            onRefresh: () async => setState(() {}),
            child: ListView.builder(
              padding: const EdgeInsets.all(AllGoTokens.space3),
              itemCount: orders.length,
              itemBuilder: (_, index) => _OrderTile(order: orders[index], onChanged: () => setState(() {})),
            ),
          );
        },
      )),
    ]),
  );
}

class _OrderTile extends ConsumerWidget {
  const _OrderTile({required this.order, required this.onChanged});
  final Map<String, dynamic> order;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = (order['id'] ?? order['_id']).toString();
    final status = order['status']?.toString() ?? 'pending';
    final next = <String, String>{'pending': 'confirmed', 'confirmed': 'preparing', 'preparing': 'shipped', 'shipped': 'delivered'}[status];
    final canCancel = const {'pending', 'confirmed', 'preparing', 'shipped'}.contains(status);
    final shopIdFuture = ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
    return Card(child: ListTile(
      title: Text(order['orderNumber']?.toString() ?? id),
      subtitle: Text('${order['customer']?['phone'] ?? ''} • ${order['amounts']?['total'] ?? 0} Ar\nStatut : $status'),
      isThreeLine: true,
      onTap: () => showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text('Commande ${order['orderNumber'] ?? id}'),
        content: Text('Articles : ${(order['items'] as List?)?.length ?? 0}\nClient : ${order['customer']?['name'] ?? ''}\nTotal : ${order['amounts']?['total'] ?? 0} Ar'),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Fermer')), TextButton(onPressed: () { Navigator.pop(dialogContext); _receipt(context, order); }, child: const Text('Reçu / imprimer'))],
      )),
      trailing: next == null && !canCancel ? null : PopupMenuButton<String>(
        onSelected: (action) async {
          final shops = await shopIdFuture;
          final items = shops.data?['data'];
          if (items is! List || items.isEmpty) return;
          final shop = items.first as Map<String, dynamic>;
          final shopId = (shop['id'] ?? shop['_id']).toString();
          if (action == 'cancel') {
            await ref.read(apiClientProvider).patch<void>('/shop/$shopId/orders/$id/cancel');
          } else if (next != null) {
            await ref.read(apiClientProvider).patch<void>('/shop/$shopId/orders/$id/status', data: {'status': next});
          }
          onChanged();
        },
        itemBuilder: (_) => [
          if (next != null) PopupMenuItem(value: 'next', child: Text(next == 'confirmed' ? 'Valider' : 'Suivant')),
          if (canCancel) const PopupMenuItem(value: 'cancel', child: Text('Refuser / annuler')),
        ],
      ),
    ));
  }

  Future<void> _receipt(BuildContext context, Map<String, dynamic> order) async {
    final amounts = order['amounts'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final customer = order['customer'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final payment = order['payment'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final items = (order['items'] as List<dynamic>?) ?? const <dynamic>[];

    await printReceipt(
      orderNumber: order['orderNumber']?.toString() ?? '',
      shopName: order['shop']?['name']?.toString() ?? '',
      customerName: customer['name']?.toString() ?? '',
      customerPhone: customer['phone']?.toString() ?? '',
      lines: items.whereType<Map<String, dynamic>>().map((item) {
        return ReceiptLine(
          name: item['name']?.toString() ?? '',
          quantity: item['quantity'] as int? ?? 1,
          subtotal: moneyFromJson(item['subtotal']),
        );
      }).toList(),
      subtotal: moneyFromJson(amounts['subtotal']),
      shippingFee: moneyFromJson(amounts['shippingFee']),
      discount: moneyFromJson(amounts['discount']),
      tip: moneyFromJson(amounts['tip']),
      total: moneyFromJson(amounts['total']),
      paymentMethod: payment['method']?.toString() ?? '',
      status: order['status']?.toString() ?? '',
      date: DateTime.tryParse(order['createdAt']?.toString() ?? '') ?? DateTime.now(),
    );
  }
}
