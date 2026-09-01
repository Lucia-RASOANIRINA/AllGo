import 'dart:async';

import 'package:allgo/core/storage/token_store.dart';
import 'package:dio/dio.dart';

/// Joint le jeton d'accès et rafraîchit la session à l'expiration.
///
/// Le jeton d'accès vit 15 minutes, le jeton de rafraîchissement 30 jours et
/// il est **rotatif** (§12.2). Le rafraîchissement est donc fréquent et doit
/// rester invisible à l'utilisateur.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor(this._tokens, this._dio) : _plainDio = Dio(_dio.options);

  final TokenStore _tokens;
  final Dio _dio;

  /// `_dio` porte cet intercepteur en `QueuedInterceptor` : il sérialise
  /// toutes les requêtes une par une. Rejouer la requête ou rafraîchir le
  /// jeton EN PASSANT PAR `_dio` mettrait cette nouvelle requête dans la même
  /// file — derrière la requête en cours de traitement, qui attend
  /// justement que celle-ci se termine. Blocage mutuel garanti. Ce second
  /// client, sans intercepteur, contourne la file.
  final Dio _plainDio;

  /// Une seule tentative de rafraîchissement à la fois. Sans ce verrou, cinq
  /// requêtes recevant 401 simultanément déclencheraient cinq rotations
  /// concurrentes — et la rotation invaliderait les quatre autres, provoquant
  /// une déconnexion alors que la session est parfaitement valide.
  Future<String?>? _refreshInFlight;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (options.extra['skipAuth'] != true) {
      final token = await _tokens.readAccessToken();
      if (token != null) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }
    handler.next(options);
  }

  @override
  Future<void> onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) async {
    if (response.statusCode != 401 || response.requestOptions.extra['retried'] == true) {
      handler.next(response);
      return;
    }

    final refreshed = await (_refreshInFlight ??= _refresh());
    _refreshInFlight = null;

    if (refreshed == null) {
      await _tokens.clear();
      handler.next(response);
      return;
    }

    final options = response.requestOptions
      ..headers['Authorization'] = 'Bearer $refreshed'
      ..extra['retried'] = true;

    try {
      handler.resolve(await _plainDio.fetch<dynamic>(options));
    } on DioException catch (error) {
      handler.reject(error);
    }
  }

  Future<String?> _refresh() async {
    final refreshToken = await _tokens.readRefreshToken();
    if (refreshToken == null) return null;

    try {
      final response = await _plainDio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: <String, String>{'refreshToken': refreshToken},
        options: Options(extra: <String, bool>{'skipAuth': true}),
      );

      final data = response.data?['data'] as Map<String, dynamic>?;
      if (data == null) return null;

      await _tokens.save(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String,
      );
      return data['accessToken'] as String;
    } on DioException {
      return null;
    }
  }
}
