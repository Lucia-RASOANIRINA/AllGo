import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

/// Statuts de commande — §6.2. `preparing` n'existe pas dans le web.
enum OrderStatus {
  pending('En attente', Icons.schedule),
  confirmed('Confirmée', Icons.check_circle_outline),
  preparing('En préparation', Icons.inventory_2_outlined),
  shipped('En cours de livraison', Icons.local_shipping_outlined),
  delivered('Livrée', Icons.done_all),
  cancelled('Annulée', Icons.cancel_outlined);

  const OrderStatus(this.label, this.icon);

  final String label;
  final IconData icon;

  static OrderStatus parse(String? raw) => OrderStatus.values
      .firstWhere((s) => s.name == raw, orElse: () => OrderStatus.pending);
}

class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.orderNumber,
    required this.shopName,
    required this.total,
    required this.status,
    required this.createdAt,
    required this.itemCount,
  });

  final String id;
  final String orderNumber;
  final String shopName;
  final int total;
  final OrderStatus status;
  final DateTime createdAt;
  final int itemCount;
}

/// Mes commandes — rétention hors ligne permanente (§9.2).
final AutoDisposeFutureProvider<List<OrderSummary>> myOrdersProvider =
    FutureProvider.autoDispose<List<OrderSummary>>((ref) async {
  final database = ref.watch(appDatabaseProvider);

  // Une commande passée « confirmée » côté boutique doit se voir dans la
  // liste sans que le client ait à tirer l'écran (§7.5).
  final socket = await ref.read(realtimeClientProvider).connect();
  void handler(dynamic _) => ref.invalidateSelf();
  socket.on('order:status', handler);
  ref.onDispose(() => socket.off('order:status', handler));

  try {
    final response =
        await ref.watch(apiClientProvider).get<Map<String, dynamic>>(
      '/orders',
      queryParameters: <String, dynamic>{'limit': 20},
    );

    final summaries = (response.data!['data'] as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .map(_summaryFromJson)
        .toList();
    await database.replaceOrders(summaries.map(_toCachedOrder).toList());
    return summaries;
  } on DioException catch (error) {
    if (error.error is NetworkFailure) {
      final cached = await database.loadOrders();
      if (cached.isNotEmpty) return cached.map(_summaryFromCache).toList();
    }
    rethrow;
  }
});

OrderSummary _summaryFromJson(Map<String, dynamic> json) {
  final amounts =
      json['amounts'] as Map<String, dynamic>? ?? const <String, dynamic>{};
  final shop =
      json['shop'] as Map<String, dynamic>? ?? const <String, dynamic>{};
  return OrderSummary(
    id: idFromJson(json),
    orderNumber: json['orderNumber'] as String? ?? '',
    shopName: shop['name'] as String? ?? '',
    total: moneyFromJson(amounts['total']),
    status: OrderStatus.parse(json['status'] as String?),
    createdAt: DateTime.parse(json['createdAt'] as String),
    itemCount: (json['items'] as List<dynamic>?)?.length ?? 0,
  );
}

CachedOrdersCompanion _toCachedOrder(OrderSummary order) =>
    CachedOrdersCompanion.insert(
      id: order.id,
      orderNumber: order.orderNumber,
      shopName: order.shopName,
      total: order.total,
      status: order.status.name,
      createdAt: order.createdAt,
      itemCount: order.itemCount,
      cachedAt: DateTime.now(),
    );

OrderSummary _summaryFromCache(CachedOrder order) => OrderSummary(
      id: order.id,
      orderNumber: order.orderNumber,
      shopName: order.shopName,
      total: order.total,
      status: OrderStatus.parse(order.status),
      createdAt: order.createdAt,
      itemCount: order.itemCount,
    );

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(myOrdersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Mes commandes')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myOrdersProvider),
        child: AsyncView<List<OrderSummary>>(
          value: orders,
          isEmpty: (list) => list.isEmpty,
          emptyTitle: 'Aucune commande',
          emptyMessage:
              'Vos achats apparaîtront ici, avec leur suivi de livraison.',
          emptyAction: FilledButton(
            onPressed: () => context.go('/'),
            child: const Text('Découvrir le catalogue'),
          ),
          onRetry: () => ref.invalidate(myOrdersProvider),
          data: (list) => ListView.separated(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: list.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AllGoTokens.space3),
            itemBuilder: (context, i) => _OrderCard(order: list[i]),
          ),
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order});

  final OrderSummary order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final date = DateFormat('d MMMM y', 'fr').format(order.createdAt);

    return Card(
      child: InkWell(
        onTap: () => context.push('/commandes/${order.id}'),
        borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
        child: Padding(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text(order.orderNumber, style: theme.textTheme.labelLarge),
                  _StatusChip(status: order.status),
                ],
              ),
              const SizedBox(height: AllGoTokens.space2),
              Text(order.shopName, style: theme.textTheme.titleMedium),
              const SizedBox(height: AllGoTokens.space1),
              Text(
                '$date · ${order.itemCount} article${order.itemCount > 1 ? 's' : ''}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AllGoTokens.space3),
              Text(
                Ariary.format(order.total),
                style: theme.textTheme.titleMedium?.copyWith(
                  color: AllGoTokens.brand,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final OrderStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    final (background, foreground) = switch (status) {
      OrderStatus.delivered => (
          scheme.primaryContainer,
          scheme.onPrimaryContainer
        ),
      OrderStatus.cancelled => (scheme.errorContainer, scheme.onErrorContainer),
      _ => (scheme.secondaryContainer, scheme.onSecondaryContainer),
    };

    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AllGoTokens.space2, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
      ),
      // L'icône double la couleur : aucune information n'est portée par la
      // couleur seule (§11.4).
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(status.icon, size: 14, color: foreground),
          const SizedBox(width: 4),
          Text(status.label, style: TextStyle(color: foreground, fontSize: 12)),
        ],
      ),
    );
  }
}
