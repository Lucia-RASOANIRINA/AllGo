import 'package:allgo/app/theme.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/cart/domain/cart.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(cartControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Panier'),
        actions: <Widget>[
          if (!(cart.valueOrNull?.isEmpty ?? true))
            IconButton(
              onPressed: () => _confirmClear(context, ref),
              icon: const Icon(Icons.delete_sweep_outlined),
              tooltip: 'Vider le panier',
            ),
        ],
      ),
      body: AsyncView<Cart>(
        value: cart,
        isEmpty: (c) => c.isEmpty,
        emptyTitle: 'Votre panier est vide',
        emptyMessage: 'Parcourez le catalogue et ajoutez ce dont vous avez besoin.',
        emptyAction: FilledButton(
          onPressed: () => context.go('/'),
          child: const Text('Voir le catalogue'),
        ),
        onRetry: () => ref.invalidate(cartControllerProvider),
        data: (c) => _CartContent(cart: c),
      ),
      bottomNavigationBar:
          cart.valueOrNull?.isEmpty ?? true ? null : _CheckoutBar(cart: cart.value!),
    );
  }

  Future<void> _confirmClear(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Vider le panier ?'),
        content: const Text('Tous les articles seront retirés. Cette action est irréversible.'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Vider'),
          ),
        ],
      ),
    );
    if (confirmed == true) await ref.read(cartControllerProvider.notifier).clear();
  }
}

class _CartContent extends ConsumerWidget {
  const _CartContent({required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final groups = cart.byShop.entries.toList();

    return ListView(
      padding: const EdgeInsets.all(AllGoTokens.space4),
      children: <Widget>[
        if (cart.hasPendingLines)
          const Padding(
            padding: EdgeInsets.only(bottom: AllGoTokens.space4),
            child: _PendingNotice(),
          ),

        // Un panier de plusieurs boutiques annonce d'emblée qu'il produira
        // plusieurs commandes : le découvrir après paiement serait une mauvaise
        // surprise (§8.2).
        if (groups.length > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: AllGoTokens.space4),
            child: Text(
              '${groups.length} boutiques — ${groups.length} commandes distinctes, '
              'chacune avec sa livraison et son suivi.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),

        for (final group in groups) ...<Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
            child: Row(
              children: <Widget>[
                const Icon(Icons.storefront_outlined, size: 18),
                const SizedBox(width: AllGoTokens.space2),
                Text(group.value.first.shopName, style: theme.textTheme.titleSmall),
              ],
            ),
          ),
          ...group.value.map((line) => _CartLineTile(line: line)),
          const SizedBox(height: AllGoTokens.space4),
        ],
      ],
    );
  }
}

class _CartLineTile extends ConsumerWidget {
  const _CartLineTile({required this.line});

  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final controller = ref.read(cartControllerProvider.notifier);

    return Dismissible(
      key: ValueKey<String>(line.id),
      direction: DismissDirection.endToStart,
      background: ColoredBox(
        color: theme.colorScheme.errorContainer,
        child: const Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: EdgeInsets.only(right: AllGoTokens.space4),
            child: Icon(Icons.delete_outline),
          ),
        ),
      ),
      onDismissed: (_) => controller.remove(line.id),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            ClipRRect(
              borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
              child: SizedBox(
                width: 64,
                height: 64,
                child: line.image == null
                    ? ColoredBox(color: theme.colorScheme.surfaceContainerHighest)
                    : CachedNetworkImage(imageUrl: line.image!, fit: BoxFit.cover),
              ),
            ),
            const SizedBox(width: AllGoTokens.space3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(line.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: AllGoTokens.space1),
                  if (line.quantity > 1)
                    Text(
                      '${Ariary.format(line.unitPrice)} × ${line.quantity}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  Text(
                    Ariary.format(line.subtotal),
                    style: theme.textTheme.titleSmall?.copyWith(color: AllGoTokens.brand),
                  ),
                  if (line.isPending)
                    Text(
                      'En attente d’envoi',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.tertiary,
                      ),
                    ),
                ],
              ),
            ),
            _QuantityStepper(
              quantity: line.quantity,
              onChanged: (value) => controller.setQuantity(line.id, value),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({required this.quantity, required this.onChanged});

  final int quantity;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        IconButton(
          onPressed: () => onChanged(quantity - 1),
          icon: const Icon(Icons.remove),
          // 48 × 48 dp minimum : en dessous, la cible devient inatteignable
          // pour un pouce (§11.1).
          constraints: const BoxConstraints(
            minWidth: AllGoTokens.minTouchTarget,
            minHeight: AllGoTokens.minTouchTarget,
          ),
          tooltip: 'Diminuer la quantité',
        ),
        Text('$quantity', style: Theme.of(context).textTheme.titleMedium),
        IconButton(
          onPressed: () => onChanged(quantity + 1),
          icon: const Icon(Icons.add),
          constraints: const BoxConstraints(
            minWidth: AllGoTokens.minTouchTarget,
            minHeight: AllGoTokens.minTouchTarget,
          ),
          tooltip: 'Augmenter la quantité',
        ),
      ],
    );
  }
}

class _PendingNotice extends StatelessWidget {
  const _PendingNotice();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(AllGoTokens.space3),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.schedule, size: 20, color: scheme.onTertiaryContainer),
          const SizedBox(width: AllGoTokens.space2),
          Expanded(
            child: Text(
              'Certains articles seront envoyés dès le retour de la connexion. '
              'Leur disponibilité sera revérifiée à ce moment-là.',
              style: TextStyle(color: scheme.onTertiaryContainer, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutBar extends StatelessWidget {
  const _CheckoutBar({required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Text('Sous-total', style: theme.textTheme.bodyLarge),
                Text(
                  Ariary.format(cart.subtotal),
                  style: theme.textTheme.titleLarge?.copyWith(color: AllGoTokens.brand),
                ),
              ],
            ),
            const SizedBox(height: AllGoTokens.space1),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Frais de livraison calculés à l’étape suivante.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(height: AllGoTokens.space3),
            FilledButton(
              onPressed: () => context.push('/panier/livraison'),
              child: Text('Commander · ${cart.itemCount} article'
                  '${cart.itemCount > 1 ? 's' : ''}'),
            ),
          ],
        ),
      ),
    );
  }
}
