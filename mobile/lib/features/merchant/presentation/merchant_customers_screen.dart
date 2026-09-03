import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

class MerchantCustomersScreen extends ConsumerStatefulWidget {
  const MerchantCustomersScreen({required this.shopId, super.key});

  final String shopId;

  @override
  ConsumerState<MerchantCustomersScreen> createState() => _MerchantCustomersScreenState();
}

class _MerchantCustomersScreenState extends ConsumerState<MerchantCustomersScreen> {
  late Future<List<Map<String, dynamic>>> _future = _load();

  Future<List<Map<String, dynamic>>> _load() async {
    final response = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/shop/${widget.shopId}/customers');
    final data = response.data?['data'];
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : const [];
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Clients')),
        body: FutureBuilder<List<Map<String, dynamic>>>(
          future: _future,
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final customers = snapshot.data!;
            if (customers.isEmpty) {
              return const Center(child: Text('Aucun client pour le moment.'));
            }
            final currency = NumberFormat.decimalPattern('fr_FR');
            final date = DateFormat('dd/MM/yyyy');
            return RefreshIndicator(
              onRefresh: () async => setState(() => _future = _load()),
              child: ListView.separated(
                itemCount: customers.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final customer = customers[index];
                  final lastOrderAt = DateTime.tryParse(
                      customer['lastOrderAt']?.toString() ?? '');
                  return ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.person_outline)),
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
            );
          },
        ),
      );
}
