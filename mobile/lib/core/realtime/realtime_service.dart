import 'package:allgo/core/env/environment.dart';
import 'package:allgo/core/storage/token_store.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

final realtimeServiceProvider = Provider<RealtimeService>((ref) {
  final service = RealtimeService(ref.read(tokenStoreProvider));
  ref.onDispose(service.dispose);
  return service;
});

class RealtimeService {
  RealtimeService(this._tokens);

  final TokenStore _tokens;
  io.Socket? _socket;

  Future<void> connect({
    required void Function(String event, dynamic payload) onEvent,
  }) async {
    final token = await _tokens.readAccessToken();
    if (token == null || token.isEmpty) return;

    final socket = io.io(
      Environment.socketUrl,
      <String, dynamic>{
        // Voir `realtime_client.dart` : sur `dart:io`, ce package utilise de
        // toute façon toujours `websocket`, jamais `polling`.
        'transports': <String>['websocket'],
        // Voir `realtime_client.dart` : le `.htaccess` du site PHP ne laisse
        // passer que `/v1/` vers Node/Passenger.
        'path': '/v1/socket.io/',
        'autoConnect': false,
        'auth': <String, dynamic>{'token': token},
        'reconnection': true,
        'reconnectionAttempts': 5,
      },
    );
    _socket?.dispose();
    _socket = socket;
    socket.onAny(onEvent);
    socket.connect();
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
  }
}
