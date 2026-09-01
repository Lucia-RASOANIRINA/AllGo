import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/network/realtime_client.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Participant d'une conversation — client ou interlocuteur côté boutique.
class Participant {
  const Participant({required this.userId, required this.name, this.avatar, this.shopId});

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
    this.lastMessageContent,
    this.lastMessageAt,
  });

  factory Conversation.fromJson(Map<String, dynamic> json) {
    final lastMessage = json['lastMessage'] as Map<String, dynamic>?;
    return Conversation(
      id: idFromJson(json),
      participants: ((json['participants'] as List<dynamic>?) ?? const <dynamic>[])
          .map((p) => Participant.fromJson(p as Map<String, dynamic>))
          .toList(),
      lastMessageContent: lastMessage?['content'] as String?,
      lastMessageAt:
          lastMessage?['sentAt'] == null ? null : DateTime.parse(lastMessage!['sentAt'] as String),
    );
  }

  final String id;
  final List<Participant> participants;
  final String? lastMessageContent;
  final DateTime? lastMessageAt;

  /// L'autre interlocuteur, vu depuis un client : la boutique.
  Participant? other(String myUserId) =>
      participants.where((p) => p.userId != myUserId).firstOrNull;
}

class Message {
  const Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.createdAt,
    this.content,
  });

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: idFromJson(json),
        conversationId: json['conversationId'] as String,
        senderId: json['senderId'] as String,
        content: json['content'] as String?,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  final String id;
  final String conversationId;
  final String senderId;
  final String? content;
  final DateTime createdAt;
}

/// Mes conversations, triées par activité récente côté serveur.
final AutoDisposeFutureProvider<List<Conversation>> conversationsProvider =
    FutureProvider.autoDispose<List<Conversation>>((ref) async {
  final response =
      await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/conversations');

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
class ConversationController extends AutoDisposeFamilyAsyncNotifier<List<Message>, String> {
  @override
  Future<List<Message>> build(String conversationId) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
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
      final message = Message.fromJson(Map<String, dynamic>.from(data as Map));
      if (message.conversationId != conversationId) return;
      state = AsyncData(<Message>[...(state.valueOrNull ?? const <Message>[]), message]);
    }

    socket.on('message:new', handler);
    ref.onDispose(() => socket.off('message:new', handler));

    return items;
  }

  Future<void> send(String content) async {
    final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
      '/conversations/$arg/messages',
      data: <String, String>{'content': content},
    );

    // Le serveur n'émet PAS l'événement temps réel vers son propre auteur
    // (§ `MessagingService.sendMessage`) : la réponse REST est donc la seule
    // source pour afficher mon propre message.
    final message = Message.fromJson(response.data!['data'] as Map<String, dynamic>);
    state = AsyncData(<Message>[...(state.valueOrNull ?? const <Message>[]), message]);
  }
}

final AutoDisposeAsyncNotifierProviderFamily<ConversationController, List<Message>, String>
    conversationControllerProvider =
    AsyncNotifierProvider.autoDispose.family<ConversationController, List<Message>, String>(
  ConversationController.new,
);

/// Identifiant de l'utilisateur courant — pour distinguer « moi » de
/// l'interlocuteur dans une bulle de conversation.
String? currentUserId(WidgetRef ref) => ref.watch(sessionControllerProvider).userId;

Future<void> blockConversation(WidgetRef ref, String conversationId) async {
  await ref.read(apiClientProvider).post<void>('/conversations/$conversationId/block');
}

Future<void> unblockConversation(WidgetRef ref, String conversationId) async {
  await ref.read(apiClientProvider).delete<void>('/conversations/$conversationId/block');
}

Future<void> reportConversation(WidgetRef ref, String conversationId, {String? reason}) async {
  await ref.read(apiClientProvider).post<void>(
    '/conversations/$conversationId/report',
    data: <String, String?>{'reason': reason},
  );
}
