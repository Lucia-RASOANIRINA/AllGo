import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/moderation/presentation/moderation_actions.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class _BlockedUser {
  const _BlockedUser({required this.id, required this.blockedId});
  final String id;
  final String blockedId;

  factory _BlockedUser.fromJson(Map<String, dynamic> json) => _BlockedUser(
        id: (json['id'] ?? json['_id']).toString(),
        blockedId: json['blockedId'].toString(),
      );
}

final _blockedUsersProvider = FutureProvider.autoDispose<List<_BlockedUser>>((ref) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/moderation/blocked-users');
  final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return items.whereType<Map<String, dynamic>>().map(_BlockedUser.fromJson).toList();
});

/// Comptes bloqués (§29) — le blocage ferme la messagerie dans les deux sens
/// et masque les publications du compte bloqué de mon fil ; le débloquer ici
/// restaure les deux immédiatement.
class BlockedUsersScreen extends ConsumerWidget {
  const BlockedUsersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final blocked = ref.watch(_blockedUsersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Comptes bloqués')),
      body: AsyncView<List<_BlockedUser>>(
        value: blocked,
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucun compte bloqué',
        emptyMessage: 'Les comptes que vous bloquez apparaîtront ici.',
        onRetry: () => ref.invalidate(_blockedUsersProvider),
        data: (items) => ListView.separated(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          itemCount: items.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final entry = items[index];
            return ListTile(
              leading: const CircleAvatar(child: Icon(Icons.person_off_outlined)),
              title: Text('Compte ${entry.blockedId.substring(0, 8)}…'),
              trailing: OutlinedButton(
                onPressed: () async {
                  final unblocked = await unblockUserAccount(context, ref, entry.blockedId);
                  if (unblocked) ref.invalidate(_blockedUsersProvider);
                },
                child: const Text('Débloquer'),
              ),
            );
          },
        ),
      ),
    );
  }
}
