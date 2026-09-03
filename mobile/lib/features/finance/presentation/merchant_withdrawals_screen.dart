import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class _MerchantFinance {
  const _MerchantFinance({required this.balance, required this.lifetimeRevenue, required this.withdrawn, required this.withdrawals});

  final double balance;
  final double lifetimeRevenue;
  final double withdrawn;
  final List<Map<String, dynamic>> withdrawals;
}

final _merchantFinanceProvider = FutureProvider.autoDispose.family<_MerchantFinance, String>((ref, shopId) async {
  final api = ref.watch(apiClientProvider);
  final results = await Future.wait(<Future<Response<Map<String, dynamic>>>>[
    api.get<Map<String, dynamic>>('/finance/merchant/balance', queryParameters: <String, String>{'shopId': shopId}),
    api.get<Map<String, dynamic>>('/finance/merchant/withdrawals', queryParameters: <String, String>{'shopId': shopId}),
  ]);
  final balance = results[0].data?['data'] as Map<String, dynamic>? ?? const <String, dynamic>{};
  final withdrawals = (results[1].data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return _MerchantFinance(
    balance: (balance['balance'] as num?)?.toDouble() ?? 0,
    lifetimeRevenue: (balance['lifetimeRevenue'] as num?)?.toDouble() ?? 0,
    withdrawn: (balance['withdrawn'] as num?)?.toDouble() ?? 0,
    withdrawals: withdrawals.whereType<Map<String, dynamic>>().toList(),
  );
});

/// Solde et retraits commerçant (§30) — le solde retirable est le chiffre
/// d'affaires livré net de la commission de plateforme, moins les retraits
/// déjà honorés ou en cours (`FinanceService.merchantBalance`).
class MerchantWithdrawalsScreen extends ConsumerWidget {
  const MerchantWithdrawalsScreen({required this.shopId, super.key});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final finance = ref.watch(_merchantFinanceProvider(shopId));

    return Scaffold(
      appBar: AppBar(title: const Text('Solde et retraits')),
      floatingActionButton: finance.maybeWhen(
        data: (data) => FloatingActionButton.extended(
          onPressed: () => _requestWithdrawal(context, ref, data.balance),
          icon: const Icon(Icons.account_balance_wallet_outlined),
          label: const Text('Retirer'),
        ),
        orElse: () => null,
      ),
      body: AsyncView<_MerchantFinance>(
        value: finance,
        isEmpty: (data) => false,
        emptyTitle: '',
        onRetry: () => ref.invalidate(_merchantFinanceProvider(shopId)),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(_merchantFinanceProvider(shopId)),
          child: ListView(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            children: <Widget>[
              Card(
                color: Theme.of(context).colorScheme.primaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(AllGoTokens.space4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text('Solde disponible', style: Theme.of(context).textTheme.titleSmall),
                      Text('${data.balance.toStringAsFixed(0)} Ar', style: Theme.of(context).textTheme.headlineMedium),
                      const SizedBox(height: AllGoTokens.space2),
                      Text('Chiffre d’affaires net (hors commission) : ${data.lifetimeRevenue.toStringAsFixed(0)} Ar'),
                      Text('Déjà retiré : ${data.withdrawn.toStringAsFixed(0)} Ar'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AllGoTokens.space4),
              Text('Historique des retraits', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AllGoTokens.space2),
              if (data.withdrawals.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
                  child: Text('Aucune demande de retrait pour le moment.'),
                )
              else
                for (final withdrawal in data.withdrawals)
                  Card(
                    child: ListTile(
                      leading: Icon(_iconFor(withdrawal['status'] as String?)),
                      title: Text('${withdrawal['amount']} Ar'),
                      subtitle: Text('${withdrawal['method']} · ${withdrawal['account']}'),
                      trailing: Text(_labelFor(withdrawal['status'] as String?)),
                    ),
                  ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _iconFor(String? status) => switch (status) {
        'paid' => Icons.check_circle_outline,
        'rejected' => Icons.cancel_outlined,
        _ => Icons.hourglass_empty,
      };

  String _labelFor(String? status) => switch (status) {
        'paid' => 'Payé',
        'rejected' => 'Refusé',
        _ => 'En attente',
      };

  Future<void> _requestWithdrawal(BuildContext context, WidgetRef ref, double balance) async {
    final amount = TextEditingController();
    final account = TextEditingController();
    String method = 'mobile_money';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: const Text('Demander un retrait'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text('Solde disponible : ${balance.toStringAsFixed(0)} Ar'),
              const SizedBox(height: AllGoTokens.space3),
              TextField(
                controller: amount,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Montant (Ar)'),
              ),
              DropdownButtonFormField<String>(
                initialValue: method,
                decoration: const InputDecoration(labelText: 'Méthode'),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem<String>(value: 'mobile_money', child: Text('Mobile money')),
                  DropdownMenuItem<String>(value: 'bank_transfer', child: Text('Virement bancaire')),
                ],
                onChanged: (value) => setState(() => method = value ?? method),
              ),
              TextField(
                controller: account,
                decoration: const InputDecoration(labelText: 'Numéro / compte de réception'),
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Annuler')),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Demander')),
          ],
        ),
      ),
    );
    if (confirmed != true || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).post<void>('/finance/merchant/withdrawals', data: <String, dynamic>{
        'shopId': shopId,
        'amount': double.tryParse(amount.text.trim()) ?? 0,
        'method': method,
        'account': account.text.trim(),
      });
      ref.invalidate(_merchantFinanceProvider(shopId));
      messenger.showSnackBar(const SnackBar(content: Text('Demande de retrait envoyée.')));
    } on DioException catch (error) {
      final response = error.response?.data;
      final message = response is Map<String, dynamic> ? (response['error']?['message'] as String?) : null;
      messenger.showSnackBar(SnackBar(content: Text(message ?? 'Impossible d’envoyer la demande.')));
    }
  }
}
