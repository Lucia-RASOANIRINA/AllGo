import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/orders/presentation/orders_screen.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class OrderDetail {
  const OrderDetail({
    required this.id,
    required this.orderNumber,
    required this.shopName,
    required this.total,
    required this.status,
    required this.items,
    required this.timeline,
    this.deliveryAddress,
    this.deliveryMethod,
    this.paymentMethod,
    this.paymentStatus,
  });

  final String id;
  final String orderNumber;
  final String shopName;
  final int total;
  final OrderStatus status;
  final List<OrderItemDetail> items;
  final List<OrderTimeline> timeline;
  final String? deliveryAddress;
  final String? deliveryMethod;
  final String? paymentMethod;
  final String? paymentStatus;
}

class OrderItemDetail {
  const OrderItemDetail({required this.name, required this.quantity, required this.subtotal});

  final String name;
  final int quantity;
  final int subtotal;
}

class OrderTimeline {
  const OrderTimeline({required this.status, required this.at, this.note});

  final OrderStatus status;
  final DateTime at;
  final String? note;
}

final AutoDisposeFutureProviderFamily<OrderDetail, String> orderDetailProvider =
    FutureProvider.autoDispose.family<OrderDetail, String>((ref, id) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/orders/$id');
  final raw = response.data?['data'];
  if (raw is! Map<String, dynamic>) throw const FormatException('Commande invalide.');

  // Statut et paiement poussés en direct (§7.5) : une commande suivie n'a plus
  // besoin d'un tirer-pour-actualiser pour refléter un changement du commerçant
  // ou un rappel de paiement.
  final socket = await ref.read(realtimeClientProvider).connect();
  void handler(dynamic data) {
    final event = Map<String, dynamic>.from(data as Map);
    if ((event['orderId'] as String?) != id) return;
    ref.invalidateSelf();
  }

  socket.on('order:status', handler);
  ref.onDispose(() => socket.off('order:status', handler));

  return _orderFromJson(raw);
});

OrderDetail _orderFromJson(Map<String, dynamic> json) {
  final shop = json['shop'] is Map<String, dynamic>
      ? json['shop'] as Map<String, dynamic>
      : const <String, dynamic>{};
  final amounts = json['amounts'] is Map<String, dynamic>
      ? json['amounts'] as Map<String, dynamic>
      : const <String, dynamic>{};
  final delivery = json['delivery'] is Map<String, dynamic>
      ? json['delivery'] as Map<String, dynamic>
      : const <String, dynamic>{};
  final payment = json['payment'] is Map<String, dynamic>
      ? json['payment'] as Map<String, dynamic>
      : const <String, dynamic>{};
  final itemValues = json['items'] is List<dynamic> ? json['items'] as List<dynamic> : const <dynamic>[];
  final timelineValues =
      json['timeline'] is List<dynamic> ? json['timeline'] as List<dynamic> : const <dynamic>[];

  return OrderDetail(
    id: idFromJson(json),
    orderNumber: json['orderNumber'] as String? ?? '',
    shopName: shop['name'] as String? ?? '',
    total: moneyFromJson(amounts['total']),
    status: OrderStatus.parse(json['status'] as String?),
    deliveryAddress: delivery['address'] as String?,
    deliveryMethod: delivery['method'] as String?,
    paymentMethod: payment['method'] as String?,
    paymentStatus: payment['status'] as String?,
    items: itemValues.whereType<Map<String, dynamic>>().map((item) {
      return OrderItemDetail(
        name: item['name'] as String? ?? '',
        quantity: item['quantity'] as int? ?? 1,
        subtotal: moneyFromJson(item['subtotal']),
      );
    }).toList(),
    timeline: timelineValues.whereType<Map<String, dynamic>>().map((entry) {
      return OrderTimeline(
        status: OrderStatus.parse(entry['status'] as String?),
        at: DateTime.tryParse(entry['at'] as String? ?? '') ?? DateTime.now(),
        note: entry['note'] as String?,
      );
    }).toList(),
  );
}

class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({required this.orderId, super.key});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final order = ref.watch(orderDetailProvider(orderId));

    return Scaffold(
      appBar: AppBar(title: const Text('Détail de la commande')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(orderDetailProvider(orderId)),
        child: AsyncView<OrderDetail>(
          value: order,
          isEmpty: (_) => false,
          emptyTitle: '',
          onRetry: () => ref.invalidate(orderDetailProvider(orderId)),
          data: (detail) => _OrderDetailContent(order: detail),
        ),
      ),
    );
  }
}

class _OrderDetailContent extends StatelessWidget {
  const _OrderDetailContent({required this.order});

  final OrderDetail order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(AllGoTokens.space4),
      children: <Widget>[
        Text(order.orderNumber, style: theme.textTheme.headlineSmall),
        const SizedBox(height: AllGoTokens.space1),
        Text(order.shopName, style: theme.textTheme.titleMedium),
        const SizedBox(height: AllGoTokens.space4),
        Row(
          children: <Widget>[
            Expanded(
              child: _StatusHeader(status: order.status, isPickup: order.deliveryMethod == 'pickup'),
            ),
            if (order.paymentStatus != null) _PaymentChip(status: order.paymentStatus!),
          ],
        ),
        const SizedBox(height: AllGoTokens.space6),
        Text('Articles', style: theme.textTheme.titleMedium),
        const SizedBox(height: AllGoTokens.space2),
            ...order.items.map(
              (item) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(item.name),
                subtitle: Text('Quantité : ${item.quantity}'),
                trailing: Text(Ariary.format(item.subtotal)),
              ),
            ),
        const Divider(),
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Total'),
          trailing: Text(Ariary.format(order.total), style: theme.textTheme.titleMedium),
        ),
        if (order.deliveryAddress != null) ...<Widget>[
          const SizedBox(height: AllGoTokens.space4),
          Text('Livraison', style: theme.textTheme.titleMedium),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.location_on_outlined),
            title: Text(order.deliveryAddress!),
            subtitle: Text(order.deliveryMethod == 'pickup' ? 'Retrait en boutique' : 'Livraison à domicile'),
          ),
        ],
        const SizedBox(height: AllGoTokens.space4),
        Text('Suivi', style: theme.textTheme.titleMedium),
        const SizedBox(height: AllGoTokens.space2),
        ...order.timeline.map(
          (entry) => ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(entry.status.icon, color: theme.colorScheme.primary),
            title: Text(_statusLabel(entry.status, order.deliveryMethod)),
            subtitle: Text(entry.note ?? _formatDate(entry.at)),
          ),
        ),
      ],
    );
  }

  String _formatDate(DateTime date) => '${date.day}/${date.month}/${date.year}';
}

/// « Livrée » n'a pas de sens pour un retrait en boutique — un seul statut
/// backend (`delivered`) couvre les deux modes (§ décisions de portée), la
/// nuance reste donc purement un libellé côté mobile.
String _statusLabel(OrderStatus status, String? deliveryMethod) {
  if (status == OrderStatus.delivered && deliveryMethod == 'pickup') return 'Retirée';
  return status.label;
}

class _StatusHeader extends StatelessWidget {
  const _StatusHeader({required this.status, required this.isPickup});

  final OrderStatus status;
  final bool isPickup;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Icon(status.icon, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: AllGoTokens.space2),
        Text(
          _statusLabel(status, isPickup ? 'pickup' : 'delivery'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
      ],
    );
  }
}

/// Paiement — dimension séparée du statut de la commande (§ décisions de
/// portée) : une commande payée à la livraison reste légitimement `unpaid`
/// jusqu'à `delivered`, ce n'est jamais une anomalie à signaler comme telle.
class _PaymentChip extends StatelessWidget {
  const _PaymentChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (label, background, foreground) = switch (status) {
      'paid' => ('Payée', scheme.primaryContainer, scheme.onPrimaryContainer),
      'refunded' => ('Remboursée', scheme.secondaryContainer, scheme.onSecondaryContainer),
      'pending' => ('Paiement en cours', scheme.tertiaryContainer, scheme.onTertiaryContainer),
      'failed' => ('Échec du paiement', scheme.errorContainer, scheme.onErrorContainer),
      'cancelled' => ('Paiement annulé', scheme.errorContainer, scheme.onErrorContainer),
      _ => ('Non payée', scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space2, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
      ),
      child: Text(label, style: TextStyle(color: foreground, fontSize: 12)),
    );
  }
}
