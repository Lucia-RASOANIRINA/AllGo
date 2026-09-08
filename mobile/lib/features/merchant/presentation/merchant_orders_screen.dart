import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:allgo/shared/utils/receipt_pdf.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

typedef MerchantOrdersFilter = ({String? status, String query});

final merchantOrdersProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, MerchantOrdersFilter>(
        (ref, filter) async {
  final api = ref.watch(apiClientProvider);
  final shops = await api.get<Map<String, dynamic>>('/me/shops');
  final items = shops.data?['data'];
  if (items is! List || items.isEmpty)
    throw StateError('Aucune boutique associée.');
  final shop = items.first as Map<String, dynamic>;
  final shopId = (shop['id'] ?? shop['_id']).toString();

  // Une nouvelle commande ou un changement de statut (décidé par un autre
  // membre de l'équipe, ou par le client qui annule) apparaît sans que le
  // commerçant ait à tirer l'écran (§7.5).
  final socket = await ref.read(realtimeClientProvider).connect();
  void handler(dynamic _) => ref.invalidateSelf();
  socket.on('order:new', handler);
  socket.on('order:status', handler);
  ref.onDispose(() {
    socket.off('order:new', handler);
    socket.off('order:status', handler);
  });

  final response = await api.get<Map<String, dynamic>>(
    '/shop/$shopId/orders',
    queryParameters: <String, dynamic>{
      'limit': 50,
      if (filter.status != null) 'status': filter.status,
      if (filter.query.isNotEmpty) 'q': filter.query,
    },
  );
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

class MerchantOrdersScreen extends ConsumerStatefulWidget {
  const MerchantOrdersScreen({super.key});
  @override
  ConsumerState<MerchantOrdersScreen> createState() =>
      _MerchantOrdersScreenState();
}

class _MerchantOrdersScreenState extends ConsumerState<MerchantOrdersScreen> {
  String? status;
  String query = '';
  final search = TextEditingController();

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filter = (status: status, query: query);
    final orders = ref.watch(merchantOrdersProvider(filter));

    return Scaffold(
      appBar: AppBar(title: const Text('Commandes commerçant')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space3),
            child: TextField(
              controller: search,
              decoration: const InputDecoration(
                labelText: 'Rechercher commande ou téléphone',
                prefixIcon: Icon(Icons.search),
              ),
              onSubmitted: (value) => setState(() => query = value.trim()),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
            child: Row(
              children: [
                FilterChip(
                  label: const Text('Toutes'),
                  selected: status == null,
                  onSelected: (_) => setState(() => status = null),
                ),
                for (final item in const [
                  ('pending', 'Nouvelles'),
                  ('preparing', 'En préparation'),
                  ('shipped', 'Prêtes / expédiées'),
                  ('delivered', 'Livrées'),
                  ('cancelled', 'Annulées'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: FilterChip(
                      label: Text(item.$2),
                      selected: status == item.$1,
                      onSelected: (_) => setState(() => status = item.$1),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AllGoTokens.space2),
          Expanded(
            child: AsyncView<List<Map<String, dynamic>>>(
              value: orders,
              onRetry: () => ref.invalidate(merchantOrdersProvider(filter)),
              isEmpty: (items) => items.isEmpty,
              emptyTitle: 'Aucune commande',
              emptyMessage: status == null
                  ? 'Les commandes de votre boutique apparaîtront ici.'
                  : 'Aucune commande dans cette catégorie pour l’instant.',
              data: (list) => RefreshIndicator(
                onRefresh: () async =>
                    ref.invalidate(merchantOrdersProvider(filter)),
                child: ListView.builder(
                  padding: const EdgeInsets.all(AllGoTokens.space3),
                  itemCount: list.length,
                  itemBuilder: (_, index) => _OrderTile(
                    order: list[index],
                    onChanged: () => ref.invalidate(merchantOrdersProvider),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OrderTile extends ConsumerWidget {
  const _OrderTile({required this.order, required this.onChanged});
  final Map<String, dynamic> order;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = (order['id'] ?? order['_id']).toString();
    final status = order['status']?.toString() ?? 'pending';
    final next = <String, String>{
      'pending': 'confirmed',
      'confirmed': 'preparing',
      'preparing': 'shipped',
      'shipped': 'delivered',
    }[status];
    final canCancel =
        const {'pending', 'confirmed', 'preparing', 'shipped'}.contains(status);
    final payment =
        order['payment'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final awaitingCodCollection =
        payment['method'] == 'cod' && payment['status'] != 'paid';

    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: AllGoTokens.brand.withValues(alpha: 0.12),
          child: Icon(_statusIcon(status), color: AllGoTokens.brand),
        ),
        title: Text(order['orderNumber']?.toString() ?? id),
        subtitle: Text(
          '${order['customer']?['phone'] ?? ''} • ${order['amounts']?['total'] ?? 0} Ar\n'
          'Statut : $status${awaitingCodCollection ? ' • Contre-remboursement en attente' : ''}',
        ),
        isThreeLine: true,
        onTap: () => showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text('Commande ${order['orderNumber'] ?? id}'),
            content: Text(
              'Articles : ${(order['items'] as List?)?.length ?? 0}\n'
              'Client : ${order['customer']?['name'] ?? ''}\n'
              'Total : ${order['amounts']?['total'] ?? 0} Ar',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Fermer'),
              ),
              TextButton(
                onPressed: () {
                  Navigator.pop(dialogContext);
                  _receipt(context, order);
                },
                child: const Text('Reçu / imprimer'),
              ),
            ],
          ),
        ),
        trailing: next == null && !canCancel && !awaitingCodCollection
            ? null
            : PopupMenuButton<String>(
                onSelected: (action) async {
                  final api = ref.read(apiClientProvider);
                  final shops =
                      await api.get<Map<String, dynamic>>('/me/shops');
                  final items = shops.data?['data'];
                  if (items is! List || items.isEmpty) return;
                  final shop = items.first as Map<String, dynamic>;
                  final shopId = (shop['id'] ?? shop['_id']).toString();
                  if (action == 'cancel') {
                    await api.patch<void>('/shop/$shopId/orders/$id/cancel');
                  } else if (action == 'collect-payment') {
                    await api.patch<void>(
                        '/shop/$shopId/orders/$id/collect-payment');
                  } else if (next != null) {
                    await api.patch<void>(
                      '/shop/$shopId/orders/$id/status',
                      data: {'status': next},
                    );
                  }
                  onChanged();
                },
                itemBuilder: (_) => [
                  if (next != null)
                    PopupMenuItem(
                        value: 'next',
                        child:
                            Text(next == 'confirmed' ? 'Valider' : 'Suivant')),
                  if (awaitingCodCollection)
                    const PopupMenuItem(
                        value: 'collect-payment',
                        child: Text('Marquer payé (encaissé)')),
                  if (canCancel)
                    const PopupMenuItem(
                        value: 'cancel', child: Text('Refuser / annuler')),
                ],
              ),
      ),
    );
  }

  IconData _statusIcon(String status) => switch (status) {
        'pending' => Icons.schedule,
        'confirmed' => Icons.check_circle_outline,
        'preparing' => Icons.inventory_2_outlined,
        'shipped' => Icons.local_shipping_outlined,
        'delivered' => Icons.done_all,
        'cancelled' => Icons.cancel_outlined,
        _ => Icons.receipt_long_outlined,
      };

  Future<void> _receipt(
      BuildContext context, Map<String, dynamic> order) async {
    final amounts =
        order['amounts'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final customer =
        order['customer'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final payment =
        order['payment'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final items = (order['items'] as List<dynamic>?) ?? const <dynamic>[];

    await printReceipt(
      context: context,
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
      date: DateTime.tryParse(order['createdAt']?.toString() ?? '') ??
          DateTime.now(),
    );
  }
}
