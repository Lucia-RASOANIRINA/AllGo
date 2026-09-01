import 'package:allgo/core/network/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class CourierEarningsScreen extends ConsumerStatefulWidget {
  const CourierEarningsScreen({super.key});
  @override
  ConsumerState<CourierEarningsScreen> createState() => _CourierEarningsScreenState();
}

class _CourierEarningsScreenState extends ConsumerState<CourierEarningsScreen> {
  Map<String, dynamic>? summary;
  List<dynamic> history = const [];
  List<dynamic> withdrawals = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = ref.read(apiClientProvider);
    final responses = await Future.wait([
      api.get<dynamic>('/courier/earnings'),
      api.get<dynamic>('/courier/earnings/history'),
      api.get<dynamic>('/courier/earnings/withdrawals'),
    ]);
    if (!mounted) return;
    final summaryData = responses[0].data;
    final historyData = responses[1].data;
    final withdrawalsData = responses[2].data;
    setState(() {
      summary = summaryData?['data'] is Map
          ? Map<String, dynamic>.from(summaryData!['data'] as Map)
          : summaryData;
      history = historyData?['data'] is List ? historyData!['data'] as List : historyData ?? const [];
      withdrawals = withdrawalsData?['data'] is List ? withdrawalsData!['data'] as List : withdrawalsData ?? const [];
    });
  }

  String _money(dynamic value) {
    final amount = value is num ? value.toDouble() : double.tryParse(value?.toString() ?? '') ?? 0;
    return '${amount.toStringAsFixed(0)} Ar';
  }
  @override
  Widget build(BuildContext context) {
    final data = summary ?? const <String, dynamic>{};
    return Scaffold(
      appBar: AppBar(title: const Text('Revenus livreur')),
      body: summary == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(child: ListTile(title: const Text('Solde disponible'), titleTextStyle: Theme.of(context).textTheme.titleMedium, trailing: Text(_money(data['balance'])))),
                  _period('Aujourd’hui', data['today']),
                  _period('Cette semaine', data['week']),
                  _period('Ce mois', data['month']),
                  const SizedBox(height: 16),
                  Text('Historique des livraisons', style: Theme.of(context).textTheme.titleLarge),
                  ...history.map((item) => ListTile(
                    title: Text('Commande ${item['orderNumber'] ?? ''}'),
                    subtitle: Text(item['updatedAt']?.toString() ?? ''),
                    trailing: Text(_money(item['amounts']?['shippingFee'])),
                  )),
                  const SizedBox(height: 16),
                  Text('Retraits', style: Theme.of(context).textTheme.titleLarge),
                  ...withdrawals.map((item) => ListTile(
                    title: Text('${item['method'] ?? ''} • ${item['status'] ?? ''}'),
                    trailing: Text(_money(item['amount'])),
                  )),
                ],
              ),
            ),
      floatingActionButton: summary == null ? null : FloatingActionButton.extended(
        onPressed: () => _requestWithdrawal(context),
        label: const Text('Retirer'),
        icon: const Icon(Icons.account_balance_wallet_outlined),
      ),
    );
  }

  Widget _period(String label, dynamic value) {
    final data = value is Map ? value : const <String, dynamic>{};
    return ListTile(
      title: Text(label),
      subtitle: Text('${data['deliveries'] ?? 0} livraison(s) • Commissions: ${_money(data['commissions'])} • Bonus: ${_money(data['bonuses'])} • Pourboires: ${_money(data['tips'])}'),
      trailing: Text(_money(data['total'])),
    );
  }

  Future<void> _requestWithdrawal(BuildContext context) async {
    final amount = TextEditingController();
    final account = TextEditingController();
    final confirmed = await showDialog<bool>(context: context, builder: (_) => AlertDialog(
      title: const Text('Demander un retrait'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Montant (Ar)')),
        TextField(controller: account, decoration: const InputDecoration(labelText: 'Compte mobile money')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annuler')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Demander')),
      ],
    ));
    if (confirmed != true) return;
    await ref.read(apiClientProvider).post<void>('/courier/earnings/withdrawals', data: {
      'amount': double.tryParse(amount.text),
      'method': 'mobile_money',
      'account': account.text,
    });
    if (mounted) await _load();
  }
}
