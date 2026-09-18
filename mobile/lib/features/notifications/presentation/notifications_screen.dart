import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final notificationsProvider =
    FutureProvider.autoDispose<List<AppNotification>>((ref) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/notifications');
  final raw = response.data?['data'];
  final values = raw is Map<String, dynamic> ? raw['items'] : raw;
  if (values is! List<dynamic>) return const <AppNotification>[];
  return values
      .whereType<Map<String, dynamic>>()
      .map(AppNotification.fromJson)
      .toList();
});

/// Pastilles de `ShellScaffold` — même mécanisme que le compteur du panier,
/// mais réparti par catégorie (`AppNotification.category`, même règle de
/// préfixe que `NotificationsService.categoryFor` côté serveur) pour que le
/// chiffre apparaisse sur l'onglet concerné (Commandes, Messages…) plutôt
/// que systématiquement sur Compte. `{}` tant que la liste n'a pas encore
/// chargé plutôt que d'attendre : une pastille qui clignote à zéro puis au
/// bon chiffre serait plus distrayante qu'utile.
final unreadNotificationCountsByCategoryProvider = Provider.autoDispose<Map<String, int>>((ref) {
  final notifications = ref.watch(notificationsProvider).valueOrNull ?? const <AppNotification>[];
  final counts = <String, int>{};
  for (final notification in notifications) {
    if (notification.read) continue;
    counts[notification.category] = (counts[notification.category] ?? 0) + 1;
  }
  return counts;
});

class AppNotification {
  const AppNotification({
    required this.type,
    required this.title,
    required this.body,
    required this.read,
  });

  final String type;
  final String title;
  final String body;
  final bool read;

  /// Même règle de préfixe que `NotificationsService.categoryFor` côté
  /// serveur — dupliquée plutôt qu'exposée par l'API, pour rester la seule
  /// donnée déjà transportée (`type`) sans aller-retour réseau supplémentaire.
  String get category {
    if (type.startsWith('order.')) return 'orders';
    if (type.startsWith('promo.')) return 'promotions';
    if (type.startsWith('message.')) return 'messages';
    if (type.startsWith('delivery.')) return 'delivery';
    return 'social';
  }

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        type: json['type'] as String? ?? '',
        title: json['title'] as String? ?? 'Notification',
        body: json['body'] as String? ?? '',
        read: json['isRead'] as bool? ?? false,
      );
}

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifications = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(notificationsProvider),
        child: AsyncView<List<AppNotification>>(
          value: notifications,
          isEmpty: (items) => items.isEmpty,
          emptyTitle: 'Aucune notification',
          emptyMessage:
              'Les nouvelles commandes, promotions, messages et activités sociales apparaîtront ici.',
          onRetry: () => ref.invalidate(notificationsProvider),
          data: (items) => ListView.separated(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(),
            itemBuilder: (_, index) => ListTile(
              leading: Icon(
                items[index].read
                    ? Icons.notifications_none
                    : Icons.notifications_active,
              ),
              title: Text(
                items[index].title,
                style: TextStyle(
                  fontWeight:
                      items[index].read ? FontWeight.normal : FontWeight.w700,
                ),
              ),
              subtitle: Text(items[index].body),
            ),
          ),
        ),
      ),
    );
  }
}
