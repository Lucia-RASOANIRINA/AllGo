import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const _sections = <String, String>{
  'transactions': 'Transactions',
  'payments': 'Paiements',
  'commissions': 'Commissions AllGo',
  'revenue': 'Revenus',
  'delivery-fees': 'Frais de livraison',
  'refunds': 'Remboursements',
  'merchant-withdrawals': 'Retraits commerçants',
  'courier-withdrawals': 'Retraits livreurs',
  'invoices': 'Factures',
  'reports': 'Rapports financiers',
};

/// Sections dont la réponse est un résumé agrégé (`{...}`), jamais une liste
/// de lignes — rendues comme des jauges, pas comme un `ListView` de lignes
/// qui n'existent pas.
const _summarySections = <String>{
  'commissions',
  'revenue',
  'delivery-fees',
  'reports'
};

typedef FinanceSectionData = ({
  List<dynamic> rows,
  Map<String, dynamic> summary
});

final financeSectionProvider = FutureProvider.autoDispose
    .family<FinanceSectionData, String>((ref, section) async {
  final api = ref.watch(apiClientProvider);
  final path = switch (section) {
    'commissions' => '/finance/commissions',
    'revenue' => '/finance/revenue',
    'delivery-fees' => '/finance/delivery-fees',
    'reports' => '/finance/reports',
    'merchant-withdrawals' => '/finance/withdrawals/merchants',
    'courier-withdrawals' => '/finance/withdrawals/couriers',
    _ => '/finance/$section',
  };
  final response = await api.get<dynamic>(path);
  final data = response.data;
  if (_summarySections.contains(section)) {
    return (
      rows: const <dynamic>[],
      summary: (data is Map && data['data'] is Map)
          ? Map<String, dynamic>.from(data['data'] as Map)
          : const <String, dynamic>{},
    );
  }
  return (
    rows: data is Map && data['data'] is List
        ? data['data'] as List
        : const <dynamic>[],
    summary: const <String, dynamic>{},
  );
});

/// Administration financière — §30. Transactions, paiements, commissions,
/// revenus, frais de livraison, remboursements, retraits (commerçants et
/// livreurs), factures et rapports financiers : un seul espace, même motif
/// que `AdminDashboardScreen` pour la modération — chaque section expose une
/// action déjà prête côté API (`FinanceController`).
class FinanceAdminScreen extends ConsumerStatefulWidget {
  const FinanceAdminScreen({super.key});
  @override
  ConsumerState<FinanceAdminScreen> createState() => _FinanceAdminScreenState();
}

class _FinanceAdminScreenState extends ConsumerState<FinanceAdminScreen> {
  String section = 'transactions';

  void _load() => ref.invalidate(financeSectionProvider(section));

  Future<void> _act(
      Future<void> Function() action, String successMessage) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      messenger.showSnackBar(SnackBar(content: Text(successMessage)));
      _load();
    } on DioException catch (error) {
      final body = error.response?.data;
      final message = body is Map<String, dynamic>
          ? ((body['error'] as Map<String, dynamic>?)?['message'] as String?)
          : null;
      messenger.showSnackBar(
          SnackBar(content: Text(message ?? 'Action impossible.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final sectionData = ref.watch(financeSectionProvider(section));

    return Scaffold(
      appBar: AppBar(title: const Text('Administration financière')),
      floatingActionButton: section == 'refunds'
          ? FloatingActionButton(
              onPressed: _createRefund, child: const Icon(Icons.add))
          : null,
      body: Column(
        children: <Widget>[
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(AllGoTokens.space2),
            child: Row(
              children: _sections.entries
                  .map(
                    (entry) => Padding(
                      padding: const EdgeInsets.only(right: AllGoTokens.space2),
                      child: ChoiceChip(
                        label: Text(entry.value),
                        selected: section == entry.key,
                        onSelected: (_) => setState(() => section = entry.key),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
          Expanded(
            child: AsyncView<FinanceSectionData>(
              value: sectionData,
              onRetry: _load,
              isEmpty: (data) =>
                  !_summarySections.contains(section) && data.rows.isEmpty,
              emptyTitle: 'Rien à afficher dans cette section',
              data: (data) => _summarySections.contains(section)
                  ? _SummaryView(
                      section: section,
                      summary: data.summary,
                      onRefresh: () async => _load())
                  : RefreshIndicator(
                      onRefresh: () async => _load(),
                      child: ListView.builder(
                        itemCount: data.rows.length,
                        itemBuilder: (_, index) =>
                            _rowTile(data.rows[index] as Map<String, dynamic>),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _rowTile(Map<String, dynamic> item) {
    switch (section) {
      case 'transactions':
        return ListTile(
          leading: Icon(_transactionIcon(item['type'] as String?)),
          title: Text(
              '${item['amount']} Ar — ${_transactionLabel(item['type'] as String?)}'),
          subtitle: Text(item['note'] as String? ?? ''),
          trailing: Text(item['status'] as String? ?? ''),
        );
      case 'payments':
        final amounts = item['amounts'] as Map<String, dynamic>? ?? const {};
        final payment = item['payment'] as Map<String, dynamic>? ?? const {};
        final shop = item['shop'] as Map<String, dynamic>? ?? const {};
        return ListTile(
          title: Text('${item['orderNumber']} — ${shop['name'] ?? ''}'),
          subtitle: Text('${payment['method']} · ${amounts['total']} Ar'),
          trailing: Text(payment['status'] as String? ?? ''),
        );
      case 'refunds':
        return ListTile(
          leading: const Icon(Icons.replay_outlined),
          title: Text('${item['amount']} Ar'),
          subtitle: Text(item['reason'] as String? ?? ''),
          trailing: Text(item['status'] as String? ?? ''),
        );
      case 'invoices':
        final amounts = item['amounts'] as Map<String, dynamic>? ?? const {};
        return ListTile(
          leading: const Icon(Icons.receipt_outlined),
          title: Text(item['invoiceNumber'] as String? ?? ''),
          subtitle: Text('${amounts['total']} Ar · ${item['paymentMethod']}'),
          trailing: Text(item['status'] as String? ?? ''),
        );
      case 'merchant-withdrawals':
      case 'courier-withdrawals':
        final status = item['status'] as String?;
        return ListTile(
          leading: const Icon(Icons.account_balance_wallet_outlined),
          title: Text('${item['amount']} Ar — ${item['method']}'),
          subtitle: Text(item['account'] as String? ?? ''),
          trailing: status == 'pending'
              ? PopupMenuButton<String>(
                  itemBuilder: (_) => const <PopupMenuEntry<String>>[
                    PopupMenuItem<String>(
                        value: 'paid', child: Text('Marquer payé')),
                    PopupMenuItem<String>(
                        value: 'rejected', child: Text('Rejeter')),
                  ],
                  onSelected: (value) {
                    final kind = section == 'merchant-withdrawals'
                        ? 'merchants'
                        : 'couriers';
                    final id = (item['id'] ?? item['_id']).toString();
                    _act(
                      () => ref.read(apiClientProvider).patch<void>(
                          '/finance/withdrawals/$kind/$id',
                          data: <String, String>{'status': value}),
                      value == 'paid'
                          ? 'Retrait marqué payé.'
                          : 'Retrait rejeté.',
                    );
                  },
                )
              : Text(status ?? ''),
        );
      default:
        return ListTile(title: Text(item.toString()));
    }
  }

  IconData _transactionIcon(String? type) => switch (type) {
        'commission' => Icons.percent,
        'delivery_fee' => Icons.local_shipping_outlined,
        'refund' => Icons.replay_outlined,
        'merchant_withdrawal' => Icons.storefront_outlined,
        'courier_withdrawal' => Icons.two_wheeler_outlined,
        _ => Icons.receipt_long_outlined,
      };

  String _transactionLabel(String? type) => switch (type) {
        'commission' => 'Commission',
        'delivery_fee' => 'Frais de livraison',
        'refund' => 'Remboursement',
        'merchant_withdrawal' => 'Retrait commerçant',
        'courier_withdrawal' => 'Retrait livreur',
        _ => 'Transaction',
      };

  Future<void> _createRefund() async {
    final orderId = TextEditingController();
    final amount = TextEditingController();
    final reason = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Émettre un remboursement'),
        content: Form(
          key: formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              TextFormField(
                controller: orderId,
                decoration: const InputDecoration(
                    labelText: 'Identifiant de la commande'),
                validator: (value) => (value ?? '').trim().isEmpty
                    ? 'Entrez l’identifiant de la commande.'
                    : null,
              ),
              TextFormField(
                controller: amount,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                    labelText: 'Montant (Ar) — vide = total de la commande'),
                validator: (value) {
                  final text = (value ?? '').trim();
                  if (text.isEmpty) return null;
                  final parsed = double.tryParse(text);
                  return (parsed == null || parsed <= 0)
                      ? 'Montant invalide.'
                      : null;
                },
              ),
              TextFormField(
                  controller: reason,
                  decoration: const InputDecoration(labelText: 'Motif')),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Annuler')),
          FilledButton(
            onPressed: () {
              if (!(formKey.currentState?.validate() ?? false)) return;
              Navigator.pop(dialogContext, true);
            },
            child: const Text('Rembourser'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await _act(
      () => ref
          .read(apiClientProvider)
          .post<void>('/finance/refunds', data: <String, dynamic>{
        'orderId': orderId.text.trim(),
        if (amount.text.trim().isNotEmpty)
          'amount': double.tryParse(amount.text.trim()),
        'reason': reason.text.trim().isEmpty
            ? 'Remboursement administratif'
            : reason.text.trim(),
      }),
      'Remboursement émis.',
    );
  }
}

class _SummaryView extends StatelessWidget {
  const _SummaryView(
      {required this.section, required this.summary, required this.onRefresh});

  final String section;
  final Map<String, dynamic> summary;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final tiles = switch (section) {
      'commissions' => _commissionTiles(),
      'delivery-fees' => _deliveryFeeTiles(),
      'revenue' => _revenueTiles(),
      'reports' => _reportTiles(),
      _ => const <(String, String)>[],
    };

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        children: <Widget>[
          for (final tile in tiles)
            Card(
              child: ListTile(
                title: Text(tile.$1),
                trailing: Text(tile.$2,
                    style: Theme.of(context).textTheme.titleMedium),
              ),
            ),
        ],
      ),
    );
  }

  List<(String, String)> _commissionTiles() {
    final lifetime = summary['lifetime'] as Map<String, dynamic>? ?? const {};
    return <(String, String)>[
      ('Commissions cumulées', '${lifetime['total'] ?? 0} Ar'),
      ('Nombre de commandes commissionnées', '${lifetime['count'] ?? 0}'),
    ];
  }

  List<(String, String)> _deliveryFeeTiles() {
    final lifetime = summary['lifetime'] as Map<String, dynamic>? ?? const {};
    return <(String, String)>[
      ('Frais de livraison cumulés', '${lifetime['total'] ?? 0} Ar'),
      ('Nombre de livraisons facturées', '${lifetime['count'] ?? 0}'),
    ];
  }

  List<(String, String)> _revenueTiles() => <(String, String)>[
        ('Période', '${summary['periodDays'] ?? 30} jours'),
        ('Volume brut de commandes', '${summary['grossOrderVolume'] ?? 0} Ar'),
        ('Commandes livrées', '${summary['deliveredOrders'] ?? 0}'),
        ('Revenu commissions', '${summary['commissionRevenue'] ?? 0} Ar'),
        (
          'Revenu frais de livraison',
          '${summary['deliveryFeeRevenue'] ?? 0} Ar'
        ),
        ('Remboursé', '${summary['refunded'] ?? 0} Ar'),
        (
          'Revenu net de plateforme',
          '${summary['netPlatformRevenue'] ?? 0} Ar'
        ),
      ];

  List<(String, String)> _reportTiles() {
    final byType = summary['byType'] as Map<String, dynamic>? ?? const {};
    final merchantWithdrawals =
        summary['merchantWithdrawalsPaid'] as Map<String, dynamic>? ?? const {};
    final courierWithdrawals =
        summary['courierWithdrawalsPaid'] as Map<String, dynamic>? ?? const {};
    final tiles = <(String, String)>[
      ('Période', '${summary['from'] ?? ''} → ${summary['to'] ?? ''}'),
      ('Remboursements émis', '${summary['refundsIssued'] ?? 0}'),
      (
        'Retraits commerçants payés',
        '${merchantWithdrawals['total'] ?? 0} Ar (${merchantWithdrawals['count'] ?? 0})'
      ),
      (
        'Retraits livreurs payés',
        '${courierWithdrawals['total'] ?? 0} Ar (${courierWithdrawals['count'] ?? 0})'
      ),
    ];
    for (final entry in byType.entries) {
      final value = entry.value as Map<String, dynamic>;
      tiles.add((
        'Mouvements « ${entry.key} »',
        '${value['total']} Ar (${value['count']})'
      ));
    }
    return tiles;
  }
}
