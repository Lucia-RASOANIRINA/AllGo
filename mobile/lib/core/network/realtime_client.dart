import 'package:allgo/core/env/environment.dart';
import 'package:allgo/core/storage/token_store.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Connexion Socket.IO authentifiée — remplace le sondage HTTP du web (§7.5).
///
/// Une seule connexion est réutilisée pour toute l'application (`multiplex`
/// par défaut) : chaque écran qui a besoin du temps réel s'abonne à ses
/// propres événements sur le même socket plutôt que d'ouvrir une connexion
/// dédiée.
class RealtimeClient {
  RealtimeClient(this._tokenStore);

  final TokenStore _tokenStore;
  io.Socket? _socket;

  Future<io.Socket> connect() async {
    final existing = _socket;
    if (existing != null && existing.connected) return existing;

    final token = await _tokenStore.readAccessToken();
    final socket = existing ??
        io.io(
          Environment.socketUrl,
          io.OptionBuilder()
              .setTransports(<String>['websocket', 'polling'])
              .setAuth(<String, dynamic>{'token': token})
              .disableAutoConnect()
              .build(),
        );
    _socket = socket;
    socket.connect();
    return socket;
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}

final realtimeClientProvider = Provider<RealtimeClient>((ref) {
  final client = RealtimeClient(ref.watch(tokenStoreProvider));
  ref.onDispose(client.dispose);
  return client;
});
