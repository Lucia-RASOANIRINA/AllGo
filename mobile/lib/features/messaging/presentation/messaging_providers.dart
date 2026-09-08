import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Participant d'une conversation — client ou interlocuteur côté boutique.
class Participant {
  const Participant(
      {required this.userId, required this.name, this.avatar, this.shopId});

  factory Participant.fromJson(Map<String, dynamic> json) => Participant(
        userId: json['userId'] as String,
        name: json['name'] as String? ?? '',
        avatar: json['avatar'] as String?,
        shopId: json['shopId'] as String?,
      );

  final String userId;
  final String name;
  final String? avatar;
  final String? shopId;
}

class Conversation {
  const Conversation({
    required this.id,
    required this.participants,
    required this.unread,
    this.lastMessageContent,
    this.lastMessageAt,
    this.blockedBy = const <String>[],
  });

  factory Conversation.fromJson(Map<String, dynamic> json) {
    final lastMessage = json['lastMessage'] as Map<String, dynamic>?;
    final unread =
        json['unread'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    return Conversation(
      id: idFromJson(json),
      participants:
          ((json['participants'] as List<dynamic>?) ?? const <dynamic>[])
              .map((p) => Participant.fromJson(p as Map<String, dynamic>))
              .toList(),
      unread: unread
          .map((key, value) => MapEntry(key, (value as num?)?.toInt() ?? 0)),
      lastMessageContent: lastMessage?['content'] as String?,
      lastMessageAt: lastMessage?['sentAt'] == null
          ? null
          : DateTime.parse(lastMessage!['sentAt'] as String),
      blockedBy: ((json['blockedBy'] as List<dynamic>?) ?? const <dynamic>[])
          .map((id) => id as String)
          .toList(),
    );
  }

  final String id;
  final List<Participant> participants;
  final Map<String, int> unread;
  final String? lastMessageContent;
  final DateTime? lastMessageAt;
  final List<String> blockedBy;

  /// L'autre interlocuteur, vu depuis un client : la boutique.
  Participant? other(String myUserId) =>
      participants.where((p) => p.userId != myUserId).firstOrNull;

  int unreadFor(String myUserId) => unread[myUserId] ?? 0;

  /// Bloquée par n'importe quel participant — même règle que côté serveur
  /// (`send` refuse dès qu'un blocage existe, peu importe qui l'a posé).
  bool get isBlocked => blockedBy.isNotEmpty;
}

class Message {
  const Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.createdAt,
    this.content,
    this.editedAt,
  });

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: idFromJson(json),
        conversationId: json['conversationId'] as String,
        senderId: json['senderId'] as String,
        content: json['content'] as String?,
        createdAt: DateTime.parse(json['createdAt'] as String),
        editedAt: json['editedAt'] == null
            ? null
            : DateTime.parse(json['editedAt'] as String),
      );

  final String id;
  final String conversationId;
  final String senderId;
  final String? content;
  final DateTime createdAt;
  final DateTime? editedAt;

  bool get isEdited => editedAt != null;

  Message copyWith({String? content, DateTime? editedAt}) => Message(
        id: id,
        conversationId: conversationId,
        senderId: senderId,
        createdAt: createdAt,
        content: content ?? this.content,
        editedAt: editedAt ?? this.editedAt,
      );
}

/// Mes conversations, triées par activité récente côté serveur.
///
/// Paramétré par `archived` : la boîte principale (`false`) et les
/// conversations archivées (`true`) sont deux listes distinctes côté
/// serveur, jamais un simple filtre local — l'archivage est un état
/// persistant, pas un tri d'écran.
final AutoDisposeFutureProviderFamily<List<Conversation>, bool>
    conversationsProvider = FutureProvider.autoDispose
        .family<List<Conversation>, bool>((ref, archived) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>(
    '/conversations',
    queryParameters: <String, dynamic>{if (archived) 'archived': 'true'},
  );

  return (response.data!['data'] as List<dynamic>)
      .map((json) => Conversation.fromJson(json as Map<String, dynamic>))
      .toList();
});

/// Ouvre (ou reprend) la conversation avec une boutique et renvoie son
/// identifiant — utilisé par le bouton « Envoyer un message » de la fiche
/// boutique.
Future<String> startConversationWithShop(WidgetRef ref, String shopId) async {
  final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
    '/conversations',
    data: <String, String>{'shopId': shopId},
  );
  return idFromJson(response.data!['data'] as Map<String, dynamic>);
}

/// Historique d'une conversation + réception temps réel des nouveaux messages.
class ConversationController
    extends AutoDisposeFamilyAsyncNotifier<List<Message>, String> {
  @override
  Future<List<Message>> build(String conversationId) async {
    final response =
        await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/conversations/$conversationId/messages',
      queryParameters: <String, dynamic>{'limit': 50},
    );

    // Le serveur trie du plus récent au plus ancien (pagination "charger plus
    // ancien") ; l'affichage d'une conversation veut l'ordre chronologique.
    final items = (response.data!['data'] as List<dynamic>)
        .map((json) => Message.fromJson(json as Map<String, dynamic>))
        .toList()
        .reversed
        .toList();

    final socket = await ref.read(realtimeClientProvider).connect();
    void handler(dynamic data) {
      final payload = Map<String, dynamic>.from(data as Map);
      final message = Message.fromJson(payload);
      if (message.conversationId != conversationId) return;
      final current = state.valueOrNull ?? const <Message>[];
      final index = current.indexWhere((m) => m.id == message.id);
      // Édition ou suppression reçue en temps réel : remplace la ligne
      // existante plutôt que d'en ajouter une nouvelle en double.
      state = AsyncData(
        index == -1
            ? <Message>[...current, message]
            : <Message>[
                ...current.sublist(0, index),
                message,
                ...current.sublist(index + 1),
              ],
      );
    }

    socket.on('message:new', handler);
    ref.onDispose(() => socket.off('message:new', handler));

    return items;
  }

  Future<void> send(String content) async {
    final response =
        await ref.read(apiClientProvider).post<Map<String, dynamic>>(
      '/conversations/$arg/messages',
      data: <String, String>{'content': content},
    );

    // Le serveur n'émet PAS l'événement temps réel vers son propre auteur
    // (§ `MessagingService.sendMessage`) : la réponse REST est donc la seule
    // source pour afficher mon propre message.
    final message =
        Message.fromJson(response.data!['data'] as Map<String, dynamic>);
    state = AsyncData(
        <Message>[...(state.valueOrNull ?? const <Message>[]), message]);
  }

  Future<void> edit(String messageId, String content) async {
    final response =
        await ref.read(apiClientProvider).patch<Map<String, dynamic>>(
      '/conversations/$arg/messages/$messageId',
      data: <String, String>{'content': content},
    );
    final updated =
        Message.fromJson(response.data!['data'] as Map<String, dynamic>);
    _replace(updated);
  }

  /// Suppression « pour moi » : le serveur ne retire le message que de MA
  /// vue (l'autre participant continue de le voir), donc côté client on le
  /// retire purement et simplement de la liste, sans repère « supprimé ».
  Future<void> delete(String messageId) async {
    await ref
        .read(apiClientProvider)
        .delete<void>('/conversations/$arg/messages/$messageId');
    final current = state.valueOrNull ?? const <Message>[];
    state = AsyncData(current.where((m) => m.id != messageId).toList());
  }

  void _replace(Message updated) {
    final current = state.valueOrNull ?? const <Message>[];
    final index = current.indexWhere((m) => m.id == updated.id);
    if (index == -1) return;
    state = AsyncData(<Message>[
      ...current.sublist(0, index),
      updated,
      ...current.sublist(index + 1),
    ]);
  }
}

final AutoDisposeAsyncNotifierProviderFamily<ConversationController,
        List<Message>, String> conversationControllerProvider =
    AsyncNotifierProvider.autoDispose
        .family<ConversationController, List<Message>, String>(
  ConversationController.new,
);

/// Identifiant de l'utilisateur courant — pour distinguer « moi » de
/// l'interlocuteur dans une bulle de conversation.
String? currentUserId(WidgetRef ref) =>
    ref.watch(sessionControllerProvider).userId;

Future<void> blockConversation(WidgetRef ref, String conversationId) async {
  await ref
      .read(apiClientProvider)
      .post<void>('/conversations/$conversationId/block');
}

Future<void> unblockConversation(WidgetRef ref, String conversationId) async {
  await ref
      .read(apiClientProvider)
      .delete<void>('/conversations/$conversationId/block');
}

Future<void> reportConversation(WidgetRef ref, String conversationId,
    {String? reason}) async {
  await ref.read(apiClientProvider).post<void>(
    '/conversations/$conversationId/report',
    data: <String, String?>{'reason': reason},
  );
}

Future<void> markConversationRead(WidgetRef ref, String conversationId) async {
  await ref
      .read(apiClientProvider)
      .post<void>('/conversations/$conversationId/read');
}

Future<void> setConversationArchived(WidgetRef ref, String conversationId,
    {required bool archived}) async {
  final api = ref.read(apiClientProvider);
  if (archived) {
    await api.post<void>('/conversations/$conversationId/archive');
  } else {
    await api.delete<void>('/conversations/$conversationId/archive');
  }
}
