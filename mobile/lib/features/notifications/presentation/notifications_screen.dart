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

class AppNotification {
  const AppNotification(
      {required this.title, required this.body, required this.read});
  final String title;
  final String body;
  final bool read;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
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
