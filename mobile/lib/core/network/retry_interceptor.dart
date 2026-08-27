import 'dart:async';
import 'dart:math';

import 'package:dio/dio.dart';

/// Reprise avec délai exponentiel — §9.3.
///
/// Ne reprend que ce qui mérite d'être repris : une coupure réseau ou une
/// indisponibilité serveur. Une erreur 4xx est un refus argumenté, la rejouer
/// est inutile et coûte des données mobiles.
///
/// Seules les méthodes idempotentes sont reprises automatiquement. Un `POST`
/// sans `Idempotency-Key` n'est jamais rejoué : dupliquer une commande est un
/// bien plus gros problème qu'un échec visible.
class RetryInterceptor extends Interceptor {
  RetryInterceptor(this._dio, {this.maxAttempts = 3});

  final Dio _dio;
  final int maxAttempts;

  static const Set<String> _idempotentMethods = <String>{'GET', 'HEAD', 'PUT', 'DELETE'};

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final options = err.requestOptions;
    final attempt = (options.extra['retryAttempt'] as int?) ?? 0;

    if (!_shouldRetry(err) || attempt >= maxAttempts) {
      handler.next(err);
      return;
    }

    // 1 s, 2 s, 4 s… plafonné à 5 minutes, avec dispersion aléatoire : sans
    // elle, tous les téléphones reconnectés au même instant après une coupure
    // de réseau frapperaient le serveur en rafale synchronisée.
    final base = Duration(milliseconds: 1000 * pow(2, attempt).toInt());
    final jitter = Duration(milliseconds: Random().nextInt(500));
    final delay =
        base + jitter > const Duration(minutes: 5) ? const Duration(minutes: 5) : base + jitter;

    await Future<void>.delayed(delay);

    options.extra['retryAttempt'] = attempt + 1;
    try {
      handler.resolve(await _dio.fetch<dynamic>(options));
    } on DioException catch (error) {
      handler.next(error);
    }
  }

  bool _shouldRetry(DioException err) {
    final isIdempotent = _idempotentMethods.contains(err.requestOptions.method.toUpperCase()) ||
        err.requestOptions.headers.containsKey('Idempotency-Key');
    if (!isIdempotent) return false;

    return switch (err.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.connectionError =>
        true,
      DioExceptionType.badResponse => (err.response?.statusCode ?? 0) >= 500,
      _ => false,
    };
  }
}
