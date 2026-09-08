import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

final merchantStockAlertsProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, shopId) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/shop/$shopId/stock/alerts');
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

final merchantStockHistoryProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, shopId) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/shop/$shopId/stock/movements');
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

class MerchantStockScreen extends ConsumerStatefulWidget {
  const MerchantStockScreen({required this.shopId, super.key});

  final String shopId;

  @override
  ConsumerState<MerchantStockScreen> createState() =>
      _MerchantStockScreenState();
}

class _MerchantStockScreenState extends ConsumerState<MerchantStockScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tab = TabController(length: 2, vsync: this);

  void _refresh() {
    ref.invalidate(merchantStockAlertsProvider(widget.shopId));
    ref.invalidate(merchantStockHistoryProvider(widget.shopId));
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Stock'),
          bottom: TabBar(controller: _tab, tabs: const <Widget>[
            Tab(text: 'Alertes'),
            Tab(text: 'Historique'),
          ]),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => _recordMovement(context),
          icon: const Icon(Icons.swap_vert),
          label: const Text('Mouvement'),
        ),
        body: TabBarView(
          controller: _tab,
          children: <Widget>[
            _AlertsList(shopId: widget.shopId),
            _HistoryList(shopId: widget.shopId),
          ],
        ),
      );

  Future<void> _recordMovement(BuildContext context) async {
    final productsResponse = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/shop/${widget.shopId}/products');
    final products = ((productsResponse.data?['data'] as List<dynamic>?) ??
            const <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .toList();
    if (!context.mounted) return;
    if (products.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Ajoutez d’abord un produit à votre catalogue.')),
      );
      return;
    }

    String? productId =
        (products.first['id'] ?? products.first['_id']).toString();
    String type = 'in';
    final quantity = TextEditingController();
    final reason = TextEditingController();
    final note = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: const Text('Nouveau mouvement de stock'),
          content: Form(
            key: formKey,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  DropdownButtonFormField<String>(
                    initialValue: productId,
                    decoration: const InputDecoration(labelText: 'Produit'),
                    items: <DropdownMenuItem<String>>[
                      for (final product in products)
                        DropdownMenuItem<String>(
                          value: (product['id'] ?? product['_id']).toString(),
                          child: Text(product['name']?.toString() ?? 'Produit'),
                        ),
                    ],
                    onChanged: (value) => setState(() => productId = value),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: type,
                    decoration: const InputDecoration(labelText: 'Type'),
                    items: const <DropdownMenuItem<String>>[
                      DropdownMenuItem(value: 'in', child: Text('Entrée')),
                      DropdownMenuItem(value: 'out', child: Text('Sortie')),
                      DropdownMenuItem(
                          value: 'correction',
                          child: Text('Correction (stock réel)')),
                    ],
                    onChanged: (value) => setState(() => type = value ?? 'in'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: quantity,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Quantité'),
                    validator: (value) {
                      final parsed = int.tryParse((value ?? '').trim());
                      if (parsed == null) return 'Quantité invalide.';
                      if (parsed <= 0) return 'Doit être supérieure à 0.';
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: reason,
                    maxLength: 80,
                    decoration: const InputDecoration(labelText: 'Motif'),
                    validator: (value) => (value ?? '').trim().isEmpty
                        ? 'Entrez un motif.'
                        : null,
                  ),
                  TextFormField(
                    controller: note,
                    maxLength: 300,
                    decoration:
                        const InputDecoration(labelText: 'Note (optionnel)'),
                  ),
                ],
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Annuler'),
            ),
            FilledButton(
              onPressed: () {
                if (!(formKey.currentState?.validate() ?? false)) return;
                Navigator.of(dialogContext).pop(true);
              },
              child: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );

    final parsedQuantity = int.tryParse(quantity.text.trim());
    quantity.dispose();
    final reasonText = reason.text.trim();
    final noteText = note.text.trim();
    reason.dispose();
    note.dispose();

    if (submitted != true ||
        !context.mounted ||
        productId == null ||
        parsedQuantity == null) {
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).post<void>(
        '/shop/${widget.shopId}/stock/movements',
        data: <String, dynamic>{
          'productId': productId,
          'type': type,
          'quantity': parsedQuantity,
          'reason': reasonText,
          if (noteText.isNotEmpty) 'note': noteText,
        },
      );
      _refresh();
      messenger
          .showSnackBar(const SnackBar(content: Text('Mouvement enregistré.')));
    } on DioException catch (error) {
      final body = error.response?.data;
      final message = body is Map<String, dynamic>
          ? ((body['error'] as Map<String, dynamic>?)?['message'] as String?)
          : null;
      messenger.showSnackBar(
        SnackBar(
            content: Text(message ?? 'Impossible d’enregistrer ce mouvement.')),
      );
    }
  }
}

class _AlertsList extends ConsumerWidget {
  const _AlertsList({required this.shopId});

  final String shopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alerts = ref.watch(merchantStockAlertsProvider(shopId));

    return AsyncView<List<Map<String, dynamic>>>(
      value: alerts,
      onRetry: () => ref.invalidate(merchantStockAlertsProvider(shopId)),
      isEmpty: (items) => items.isEmpty,
      emptyTitle: 'Aucune alerte de stock',
      emptyMessage:
          'Vous serez averti ici quand un produit passera sous son seuil minimum.',
      data: (products) => RefreshIndicator(
        onRefresh: () async =>
            ref.invalidate(merchantStockAlertsProvider(shopId)),
        child: ListView.separated(
          itemCount: products.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final product = products[index];
            return ListTile(
              leading: const Icon(Icons.warning_amber_outlined,
                  color: Colors.orange),
              title: Text(product['name']?.toString() ?? 'Produit'),
              subtitle: Text('Seuil : ${product['minStock'] ?? 0}'),
              trailing: Text(
                '${product['stock'] ?? 0}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            );
          },
        ),
      ),
    );
  }
}

class _HistoryList extends ConsumerWidget {
  const _HistoryList({required this.shopId});

  final String shopId;

  static const _typeLabels = <String, String>{
    'in': 'Entrée',
    'out': 'Sortie',
    'correction': 'Correction',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(merchantStockHistoryProvider(shopId));
    final date = DateFormat('dd/MM/yyyy HH:mm');

    return AsyncView<List<Map<String, dynamic>>>(
      value: history,
      onRetry: () => ref.invalidate(merchantStockHistoryProvider(shopId)),
      isEmpty: (items) => items.isEmpty,
      emptyTitle: 'Aucun mouvement enregistré',
      emptyMessage:
          'Chaque entrée, sortie ou correction de stock apparaîtra ici.',
      data: (movements) => RefreshIndicator(
        onRefresh: () async =>
            ref.invalidate(merchantStockHistoryProvider(shopId)),
        child: ListView.separated(
          itemCount: movements.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final movement = movements[index];
            final product = movement['product'] as Map<String, dynamic>?;
            final at = DateTime.tryParse(movement['at']?.toString() ?? '');
            final type = movement['type']?.toString();
            return ListTile(
              leading: Icon(
                type == 'in'
                    ? Icons.arrow_downward
                    : type == 'out'
                        ? Icons.arrow_upward
                        : Icons.sync_alt,
              ),
              title: Text(product?['name']?.toString() ?? 'Produit'),
              subtitle: Text(
                '${_typeLabels[type] ?? type} · ${movement['reason'] ?? ''}'
                '${at != null ? ' · ${date.format(at)}' : ''}',
              ),
              trailing: Text(
                  '${movement['stockBefore'] ?? '?'} → ${movement['stockAfter'] ?? '?'}'),
            );
          },
        ),
      ),
    );
  }
}
