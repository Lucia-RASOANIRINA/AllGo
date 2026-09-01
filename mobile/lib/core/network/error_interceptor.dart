import 'package:allgo/core/error/failure.dart';
import 'package:dio/dio.dart';

/// Traduit toute réponse d'échec en [Failure] typé.
///
/// L'API renvoie un `message` **déjà localisé et prêt à afficher** (§7.2) : le
/// client ne compose jamais de texte d'erreur métier lui-même. Cet
/// intercepteur se contente de le transporter jusqu'à l'interface.
class ErrorInterceptor extends Interceptor {
  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    final status = response.statusCode ?? 0;
    if (status < 400) {
      handler.next(response);
      return;
    }

    handler.reject(
      DioException(
        requestOptions: response.requestOptions,
        response: response,
        type: DioExceptionType.badResponse,
        error: _failureFrom(response),
      ),
    );
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.error is Failure) {
      handler.next(err);
      return;
    }

    // `validateStatus` (§ `api_client.dart`) n'accepte que les statuts < 500 :
    // un 5xx (ex. `PROVIDER_UNAVAILABLE`, 503) n'atteint donc jamais
    // `onResponse` et arrive ici sous forme de `badResponse` — sans ce
    // rattachement, son corps JSON (déjà un message affichable, §7.2) était
    // ignoré au profit du texte générique « erreur inattendue ».
    final response = err.response;
    final failure = response != null
        ? _failureFrom(response)
        : switch (err.type) {
            DioExceptionType.connectionError ||
            DioExceptionType.connectionTimeout ||
            DioExceptionType.receiveTimeout ||
            DioExceptionType.sendTimeout =>
              const Failure.network(),
            DioExceptionType.cancel => const Failure.cancelled(),
            _ => const Failure.unexpected(),
          };

    handler.next(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: failure,
      ),
    );
  }

  Failure _failureFrom(Response<dynamic> response) {
    final body = response.data;
    final error = body is Map<String, dynamic> ? body['error'] as Map<String, dynamic>? : null;

    if (error == null) return const Failure.unexpected();

    return Failure.api(
      code: error['code'] as String? ?? 'ERROR',
      message: error['message'] as String? ?? 'Une erreur est survenue.',
      details: error['details'] as Map<String, dynamic>?,
      requestId: error['requestId'] as String?,
      statusCode: response.statusCode ?? 0,
    );
  }
}
