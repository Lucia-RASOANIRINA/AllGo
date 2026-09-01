import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/realtime/realtime_service.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final conversationsProvider =
    FutureProvider.autoDispose<List<Conversation>>((ref) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/conversations');
  final data = response.data?['data'];
  final values = data is List<dynamic> ? data : const <dynamic>[];
  return values
      .whereType<Map<String, dynamic>>()
      .map(Conversation.fromJson)
      .toList();
});

class Conversation {
  const Conversation({
    required this.id,
    required this.name,
    required this.lastMessage,
    required this.unread,
  });

  final String id;
  final String name;
  final String lastMessage;
  final int unread;

  factory Conversation.fromJson(Map<String, dynamic> json) {
    final participants = json['participants'] is List<dynamic>
        ? json['participants'] as List<dynamic>
        : const <dynamic>[];
    final participantValues = participants.whereType<Map<String, dynamic>>();
    final participant =
        participantValues.isEmpty ? null : participantValues.first;
    final last = json['lastMessage'] is Map<String, dynamic>
        ? json['lastMessage'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final unread = json['unread'] is Map<String, dynamic>
        ? json['unread'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return Conversation(
      id: (json['_id'] ?? json['id']) as String,
      name: participant?['name'] as String? ?? 'Conversation',
      lastMessage: last['content'] as String? ?? 'Aucun message',
      unread: unread.values
          .whereType<num>()
          .fold<int>(0, (sum, value) => sum + value.toInt()),
    );
  }
}

final messagesProvider = FutureProvider.autoDispose
    .family<List<ChatMessage>, String>((ref, id) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/conversations/$id/messages');
  final data = response.data?['data'];
  final values = data is List<dynamic> ? data : const <dynamic>[];
  return values
      .whereType<Map<String, dynamic>>()
      .map(ChatMessage.fromJson)
      .toList();
});

class ChatMessage {
  const ChatMessage(
      {required this.id, required this.senderId, required this.content});

  final String id;
  final String senderId;
  final String content;

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    final sender = json['senderId'];
    return ChatMessage(
      id: (json['_id'] ?? json['id']) as String,
      senderId: sender is String
          ? sender
          : (sender as Map<String, dynamic>)['_id'] as String,
      content: json['content'] as String? ?? '',
    );
  }
}

class MessagesScreen extends ConsumerStatefulWidget {
  const MessagesScreen({super.key});

  @override
  ConsumerState<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends ConsumerState<MessagesScreen> {
  @override
  void initState() {
    super.initState();
    Future<void>.microtask(() async {
      await ref.read(realtimeServiceProvider).connect(
        onEvent: (event, payload) {
          if (!mounted) return;
          if (event == 'message:new') {
            ref.invalidate(conversationsProvider);
            if (payload is Map<String, dynamic>) {
              final conversationId = payload['conversationId'];
              if (conversationId is String) {
                ref.invalidate(messagesProvider(conversationId));
              }
            }
          } else if (event == 'notification:new' &&
              payload is Map<String, dynamic>) {
            final title = payload['title'] as String?;
            final body = payload['body'] as String?;
            if (title != null || body != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                    content:
                        Text([title, body].whereType<String>().join(' — '))),
              );
            }
          }
        },
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final conversations = ref.watch(conversationsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(conversationsProvider),
        child: AsyncView<List<Conversation>>(
          value: conversations,
          isEmpty: (items) => items.isEmpty,
          emptyTitle: 'Aucune conversation',
          emptyMessage:
              'Vos échanges avec les commerçants et livreurs apparaîtront ici.',
          onRetry: () => ref.invalidate(conversationsProvider),
          data: (items) => ListView.separated(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: items.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AllGoTokens.space2),
            itemBuilder: (context, index) =>
                _ConversationTile(conversation: items[index]),
          ),
        ),
      ),
    );
  }
}

class _ConversationTile extends ConsumerWidget {
  const _ConversationTile({required this.conversation});

  final Conversation conversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.person_outline)),
        title: Text(conversation.name),
        subtitle: Text(conversation.lastMessage,
            maxLines: 1, overflow: TextOverflow.ellipsis),
        trailing: conversation.unread == 0
            ? null
            : CircleAvatar(
                radius: 14,
                child: Text('${conversation.unread}',
                    style: const TextStyle(fontSize: 12)),
              ),
        onTap: () => _openChat(context, ref),
      ),
    );
  }

  Future<void> _openChat(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _ChatSheet(conversation: conversation),
    );
    ref.invalidate(conversationsProvider);
  }
}

class _ChatSheet extends ConsumerStatefulWidget {
  const _ChatSheet({required this.conversation});

  final Conversation conversation;

  @override
  ConsumerState<_ChatSheet> createState() => _ChatSheetState();
}

class _ChatSheetState extends ConsumerState<_ChatSheet> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final content = _controller.text.trim();
    if (content.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/conversations/${widget.conversation.id}/messages',
        data: <String, dynamic>{'content': content},
      );
      _controller.clear();
      ref.invalidate(messagesProvider(widget.conversation.id));
    } on DioException catch (error) {
      if (!mounted) return;
      final body = error.response?.data;
      final message =
          body is Map<String, dynamic> ? body['message'] as String? : null;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message ?? 'Impossible d’envoyer le message.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(messagesProvider(widget.conversation.id));
    final currentUserId = ref.watch(sessionControllerProvider).userId;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.82,
      child: Column(
        children: <Widget>[
          ListTile(
            title: Text(widget.conversation.name),
            trailing: IconButton(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close),
            ),
          ),
          Expanded(
            child: AsyncView<List<ChatMessage>>(
              value: messages,
              isEmpty: (_) => false,
              emptyTitle: '',
              data: (items) => ListView.builder(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                itemCount: items.length,
                itemBuilder: (_, index) {
                  final message = items[index];
                  final mine = message.senderId == currentUserId;
                  return Align(
                    alignment:
                        mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: AllGoTokens.space2),
                      padding: const EdgeInsets.all(AllGoTokens.space3),
                      constraints: const BoxConstraints(maxWidth: 300),
                      decoration: BoxDecoration(
                        color: mine
                            ? Theme.of(context).colorScheme.primary
                            : Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                        borderRadius:
                            BorderRadius.circular(AllGoTokens.radiusCard),
                      ),
                      child: Text(
                        message.content,
                        style: TextStyle(
                            color: mine
                                ? Theme.of(context).colorScheme.onPrimary
                                : null),
                      ),
                    ),
                  );
                },
              ),
              onRetry: () =>
                  ref.invalidate(messagesProvider(widget.conversation.id)),
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(
              AllGoTokens.space4,
              AllGoTokens.space2,
              AllGoTokens.space4,
              MediaQuery.viewInsetsOf(context).bottom + AllGoTokens.space4,
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _controller,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration:
                        const InputDecoration(hintText: 'Votre message'),
                  ),
                ),
                IconButton(
                  onPressed: _sending ? null : _send,
                  icon: _sending
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.send),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
