import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

typedef CourierEarnings = ({
  Map<String, dynamic> summary,
  List<dynamic> history,
  List<dynamic> withdrawals,
});

final courierEarningsProvider =
    FutureProvider.autoDispose<CourierEarnings>((ref) async {
  final api = ref.watch(apiClientProvider);
  final responses = await Future.wait(<Future<Response<Map<String, dynamic>>>>[
    api.get<Map<String, dynamic>>('/courier/earnings'),
    api.get<Map<String, dynamic>>('/courier/earnings/history'),
    api.get<Map<String, dynamic>>('/courier/earnings/withdrawals'),
  ]);

  Map<String, dynamic>? asMap(dynamic data) =>
      data is Map ? Map<String, dynamic>.from(data) : null;
  List<dynamic> asList(dynamic data) => data is List ? data : const <dynamic>[];

  return (
    summary: asMap(responses[0].data?['data']) ??
        asMap(responses[0].data) ??
        const <String, dynamic>{},
    history: asList(responses[1].data?['data']),
    withdrawals: asList(responses[2].data?['data']),
  );
});

class CourierEarningsScreen extends ConsumerWidget {
  const CourierEarningsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final earnings = ref.watch(courierEarningsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Revenus livreur')),
      body: AsyncView<CourierEarnings>(
        value: earnings,
        onRetry: () => ref.invalidate(courierEarningsProvider),
        isEmpty: (_) => false,
        emptyTitle: '',
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(courierEarningsProvider),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: ListTile(
                  title: const Text('Solde disponible'),
                  titleTextStyle: Theme.of(context).textTheme.titleMedium,
                  trailing: Text(_money(data.summary['balance'])),
                ),
              ),
              _period('Aujourd’hui', data.summary['today']),
              _period('Cette semaine', data.summary['week']),
              _period('Ce mois', data.summary['month']),
              const SizedBox(height: 16),
              Text('Historique des livraisons',
                  style: Theme.of(context).textTheme.titleLarge),
              if (data.history.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('Aucune livraison rémunérée pour l’instant.'),
                )
              else
                ...data.history.map((item) => ListTile(
                      title: Text('Commande ${item['orderNumber'] ?? ''}'),
                      subtitle: Text(item['updatedAt']?.toString() ?? ''),
                      trailing: Text(_money(item['amounts']?['shippingFee'])),
                    )),
              const SizedBox(height: 16),
              Text('Retraits', style: Theme.of(context).textTheme.titleLarge),
              if (data.withdrawals.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('Aucune demande de retrait.'),
                )
              else
                ...data.withdrawals.map((item) => ListTile(
                      title: Text(
                          '${item['method'] ?? ''} • ${item['status'] ?? ''}'),
                      trailing: Text(_money(item['amount'])),
                    )),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _requestWithdrawal(context, ref),
        label: const Text('Retirer'),
        icon: const Icon(Icons.account_balance_wallet_outlined),
      ),
    );
  }

  String _money(dynamic value) {
    final amount = value is num
        ? value.toDouble()
        : double.tryParse(value?.toString() ?? '') ?? 0;
    return '${amount.toStringAsFixed(0)} Ar';
  }

  Widget _period(String label, dynamic value) {
    final data = value is Map ? value : const <String, dynamic>{};
    return ListTile(
      title: Text(label),
      subtitle: Text(
        '${data['deliveries'] ?? 0} livraison(s) • Commissions: ${_money(data['commissions'])} '
        '• Bonus: ${_money(data['bonuses'])} • Pourboires: ${_money(data['tips'])}',
      ),
      trailing: Text(_money(data['total'])),
    );
  }

  Future<void> _requestWithdrawal(BuildContext context, WidgetRef ref) async {
    final formKey = GlobalKey<FormState>();
    final amount = TextEditingController();
    final account = TextEditingController();
    String method = 'mobile_money';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: const Text('Demander un retrait'),
          content: Form(
            key: formKey,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: amount,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Montant (Ar)'),
                  validator: (value) {
                    final parsed = double.tryParse((value ?? '').trim());
                    if (parsed == null) return 'Montant invalide.';
                    if (parsed <= 0) return 'Doit être supérieur à 0.';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: method,
                  decoration: const InputDecoration(labelText: 'Méthode'),
                  items: const <DropdownMenuItem<String>>[
                    DropdownMenuItem(
                        value: 'mobile_money', child: Text('Mobile money')),
                    DropdownMenuItem(
                        value: 'bank_transfer',
                        child: Text('Virement bancaire')),
                  ],
                  onChanged: (value) =>
                      setState(() => method = value ?? method),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: account,
                  decoration:
                      const InputDecoration(labelText: 'Compte mobile money'),
                  validator: (value) => (value ?? '').trim().isEmpty
                      ? 'Entrez le numéro de compte.'
                      : null,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Annuler'),
            ),
            FilledButton(
              onPressed: () {
                if (!(formKey.currentState?.validate() ?? false)) return;
                Navigator.pop(dialogContext, true);
              },
              child: const Text('Demander'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    await ref
        .read(apiClientProvider)
        .post<void>('/courier/earnings/withdrawals', data: {
      'amount': double.parse(amount.text.trim()),
      'method': method,
      'account': account.text.trim(),
    });
    ref.invalidate(courierEarningsProvider);
  }
}
