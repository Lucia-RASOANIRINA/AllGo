import 'dart:async';

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
              // Le `.htaccess` du site PHP historique ne laisse passer que
              // `/v1/` vers Passenger/Node — le chemin par défaut
              // `/socket.io/` tombe sur le site PHP (404), doit donc vivre
              // sous `/v1/` comme le reste de l'API (même contrainte que
              // Swagger dans `main.ts`).
              .setPath('/v1/socket.io/')
              .setAuth(<String, dynamic>{'token': token})
              .disableAutoConnect()
              .build(),
        );
    _socket = socket;
    if (!socket.connected) {
      final connected = Completer<void>();
      socket.once('connect', (_) {
        if (!connected.isCompleted) connected.complete();
      });
      socket.once('connect_error', (error) {
        if (!connected.isCompleted) {
          connected.completeError(StateError('Connexion temps réel impossible: $error'));
        }
      });
      socket.connect();
      await connected.future.timeout(const Duration(seconds: 10));
    }
    return socket;
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
  }

  Future<void> subscribeDelivery(String orderId) async {
    final socket = await connect();
    socket.emit('delivery:subscribe', <String, dynamic>{'orderId': orderId});
  }

  Future<void> publishDeliveryPosition({
    required String orderId,
    required double latitude,
    required double longitude,
    double? remainingDistance,
    int? etaMinutes,
  }) async {
    final socket = await connect();
    socket.emit('delivery:position', <String, dynamic>{
      'orderId': orderId,
      'latitude': latitude,
      'longitude': longitude,
      if (remainingDistance != null) 'remainingDistance': remainingDistance,
      if (etaMinutes != null) 'etaMinutes': etaMinutes,
    });
  }
}

final realtimeClientProvider = Provider<RealtimeClient>((ref) {
  final client = RealtimeClient(ref.watch(tokenStoreProvider));
  ref.onDispose(client.dispose);
  return client;
});
