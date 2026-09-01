import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/app/router.dart';
import 'package:allgo/features/orders/presentation/orders_screen.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class OrderDetail {
  const OrderDetail({
    required this.id,
    required this.orderNumber,
    required this.shopName,
    required this.total,
    required this.status,
    required this.items,
    required this.timeline,
    required this.shopId,
    this.deliveryAddress,
    this.deliveryMethod,
    this.paymentMethod,
    this.courierId,
  });

  final String id;
  final String orderNumber;
  final String shopName;
  final int total;
  final OrderStatus status;
  final List<OrderItemDetail> items;
  final List<OrderTimeline> timeline;
  final String shopId;
  final String? courierId;
  final String? deliveryAddress;
  final String? deliveryMethod;
  final String? paymentMethod;
}

class OrderItemDetail {
  const OrderItemDetail(
      {required this.productId,
      required this.name,
      required this.quantity,
      required this.subtotal});

  final String productId;
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
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/orders/$id');
  final raw = response.data?['data'];
  if (raw is! Map<String, dynamic>)
    throw const FormatException('Commande invalide.');
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
  final itemValues = json['items'] is List<dynamic>
      ? json['items'] as List<dynamic>
      : const <dynamic>[];
  final timelineValues = json['timeline'] is List<dynamic>
      ? json['timeline'] as List<dynamic>
      : const <dynamic>[];

  return OrderDetail(
    id: idFromJson(json),
    orderNumber: json['orderNumber'] as String? ?? '',
    shopName: shop['name'] as String? ?? '',
    total: moneyFromJson(amounts['total']),
    status: OrderStatus.parse(json['status'] as String?),
    deliveryAddress: delivery['address'] as String?,
    deliveryMethod: delivery['method'] as String?,
    paymentMethod: payment['method'] as String?,
    shopId: json['shopId']?.toString() ?? idFromJson(shop),
    courierId: delivery['courierId'] as String?,
    items: itemValues.whereType<Map<String, dynamic>>().map((item) {
      return OrderItemDetail(
        productId: idFromJson(item),
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
        _StatusHeader(status: order.status),
        if (order.status == OrderStatus.delivered) ...<Widget>[
          const SizedBox(height: AllGoTokens.space4),
          FilledButton.icon(
            onPressed: () => _showReviewDialog(context, order),
            icon: const Icon(Icons.star_outline),
            label: const Text('Évaluer cette commande'),
          ),
        ],
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
          trailing: Text(Ariary.format(order.total),
              style: theme.textTheme.titleMedium),
        ),
        if (order.deliveryAddress != null) ...<Widget>[
          const SizedBox(height: AllGoTokens.space4),
          Text('Livraison', style: theme.textTheme.titleMedium),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.location_on_outlined),
            title: Text(order.deliveryAddress!),
            subtitle: Text(order.deliveryMethod == 'pickup'
                ? 'Retrait en boutique'
                : 'Livraison à domicile'),
          ),
        ],
        if (order.status != OrderStatus.delivered &&
            order.status != OrderStatus.cancelled) ...<Widget>[
          const SizedBox(height: AllGoTokens.space3),
          FilledButton.icon(
            onPressed: () => context.push('/tournee'),
            icon: const Icon(Icons.local_shipping_outlined),
            label: const Text('Suivre le livreur'),
          ),
        ],
        const SizedBox(height: AllGoTokens.space4),
        Text('Suivi', style: theme.textTheme.titleMedium),
        const SizedBox(height: AllGoTokens.space2),
        ...order.timeline.map(
          (entry) => ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(entry.status.icon, color: theme.colorScheme.primary),
            title: Text(entry.status.label),
            subtitle: Text(entry.note ?? _formatDate(entry.at)),
          ),
        ),
      ],
    );
  }

  String _formatDate(DateTime date) => '${date.day}/${date.month}/${date.year}';

  Future<void> _showReviewDialog(
      BuildContext context, OrderDetail order) async {
    final comment = TextEditingController();
    final photo = TextEditingController();
    var rating = 5;
    var targetType = 'shop';
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Votre avis'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                DropdownButtonFormField<String>(
                  value: targetType,
                  items: <String>[
                    'shop',
                    'product',
                    if (order.courierId != null) 'courier'
                  ]
                      .map((value) => DropdownMenuItem(
                          value: value,
                          child: Text(value == 'shop'
                              ? 'Boutique'
                              : value == 'product'
                                  ? 'Produit'
                                  : 'Livreur')))
                      .toList(),
                  onChanged: (value) =>
                      setState(() => targetType = value ?? 'shop'),
                  decoration: const InputDecoration(labelText: 'Évaluer'),
                ),
                DropdownButtonFormField<int>(
                  value: rating,
                  items: List.generate(
                      5,
                      (i) => DropdownMenuItem(
                          value: i + 1, child: Text('${i + 1} étoile(s)'))),
                  onChanged: (value) => setState(() => rating = value ?? 5),
                  decoration: const InputDecoration(labelText: 'Note'),
                ),
                TextField(
                    controller: comment,
                    maxLines: 3,
                    decoration:
                        const InputDecoration(labelText: 'Commentaire')),
                TextField(
                    controller: photo,
                    decoration: const InputDecoration(
                        labelText: 'URL photo (optionnel)')),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Annuler')),
            FilledButton(
              onPressed: () async {
                final api =
                    ProviderScope.containerOf(context).read(apiClientProvider);
                final photos = photo.text.trim().isEmpty
                    ? <String>[]
                    : <String>[photo.text.trim()];
                final targetId = targetType == 'shop'
                    ? order.shopId
                    : targetType == 'courier'
                        ? order.courierId!
                        : order.items.first.productId;
                await api.post<void>('/reviews', data: {
                  'orderId': order.id,
                  'targetType': targetType,
                  'targetId': targetId,
                  'rating': rating,
                  'comment': comment.text.trim(),
                  'photos': photos,
                });
                if (dialogContext.mounted) Navigator.pop(dialogContext);
              },
              child: const Text('Envoyer'),
            ),
          ],
        ),
      ),
    );
    comment.dispose();
    photo.dispose();
  }
}

class _StatusHeader extends StatelessWidget {
  const _StatusHeader({required this.status});

  final OrderStatus status;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Icon(status.icon, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: AllGoTokens.space2),
        Text(status.label, style: Theme.of(context).textTheme.titleMedium),
      ],
    );
  }
}
