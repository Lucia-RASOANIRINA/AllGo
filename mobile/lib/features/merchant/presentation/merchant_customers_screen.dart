import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

final merchantCustomersProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, shopId) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/shop/$shopId/customers');
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

class MerchantCustomersScreen extends ConsumerWidget {
  const MerchantCustomersScreen({required this.shopId, super.key});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final customers = ref.watch(merchantCustomersProvider(shopId));
    final currency = NumberFormat.decimalPattern('fr_FR');
    final date = DateFormat('dd/MM/yyyy');

    return Scaffold(
      appBar: AppBar(title: const Text('Clients')),
      body: AsyncView<List<Map<String, dynamic>>>(
        value: customers,
        onRetry: () => ref.invalidate(merchantCustomersProvider(shopId)),
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucun client pour le moment',
        emptyMessage:
            'Vos clients apparaîtront ici après leur première commande.',
        data: (items) => RefreshIndicator(
          onRefresh: () async =>
              ref.invalidate(merchantCustomersProvider(shopId)),
          child: ListView.separated(
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final customer = items[index];
              final lastOrderAt =
                  DateTime.tryParse(customer['lastOrderAt']?.toString() ?? '');
              return ListTile(
                leading: CircleAvatar(
                  backgroundColor: AllGoTokens.brand.withValues(alpha: 0.12),
                  child: const Icon(Icons.person_outline,
                      color: AllGoTokens.brand),
                ),
                title: Text(customer['name']?.toString() ?? 'Client'),
                subtitle: Text(customer['phone']?.toString() ?? '—'),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Text('${currency.format(customer['totalSpent'] ?? 0)} Ar'),
                    Text(
                      '${customer['orders'] ?? 0} commande(s)'
                      '${lastOrderAt != null ? ' · ${date.format(lastOrderAt)}' : ''}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
