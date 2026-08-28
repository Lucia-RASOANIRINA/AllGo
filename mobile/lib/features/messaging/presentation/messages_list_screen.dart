import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

/// Liste de mes conversations — `GET /me/conversations`.
class MessagesListScreen extends ConsumerWidget {
  const MessagesListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversations = ref.watch(conversationsProvider);
    final myUserId = currentUserId(ref);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: conversations.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AllGoTokens.space6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const Text('Messages indisponibles hors ligne.'),
                const SizedBox(height: AllGoTokens.space3),
                OutlinedButton(
                  onPressed: () => ref.invalidate(conversationsProvider),
                  child: const Text('Réessayer'),
                ),
              ],
            ),
          ),
        ),
        data: (list) => list.isEmpty
            ? const Center(child: Text('Aucune conversation pour l’instant.'))
            : ListView.separated(
                itemCount: list.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, i) {
                  final conversation = list[i];
                  final other = myUserId == null ? null : conversation.other(myUserId);

                  return ListTile(
                    leading: CircleAvatar(
                      backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      backgroundImage:
                          other?.avatar != null ? NetworkImage(other!.avatar!) : null,
                      child: other?.avatar == null
                          ? const Icon(Icons.storefront_outlined)
                          : null,
                    ),
                    title: Text(other?.name ?? 'Boutique'),
                    subtitle: conversation.lastMessageContent == null
                        ? null
                        : Text(
                            conversation.lastMessageContent!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                    trailing: conversation.lastMessageAt == null
                        ? null
                        : Text(
                            DateFormat.Hm('fr').format(conversation.lastMessageAt!.toLocal()),
                            style: theme.textTheme.labelSmall,
                          ),
                    onTap: () => context.push(
                      Routes.messagePath(conversation.id),
                      extra: other?.name,
                    ),
                  );
                },
              ),
      ),
    );
  }
}
