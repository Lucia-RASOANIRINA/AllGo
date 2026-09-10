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

    final failure = switch (err.type) {
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
    // Un 401 qui atteint encore ici a survécu au rafraîchissement silencieux
    // de `AuthInterceptor` (jeton de rafraîchissement lui-même expiré ou
    // révoqué) : ce n'est plus une erreur métier ordinaire, mais le signal
    // que l'utilisateur doit se reconnecter — d'où un type dédié plutôt
    // qu'un `ApiFailure` de plus, que chaque écran devrait réinterpréter lui-
    // même pour retrouver ce même constat.
    //
    // Exception : une requête `skipAuth` (login, inscription, OTP...) n'a
    // jamais porté de jeton et n'est jamais passée par ce rafraîchissement —
    // son 401 est un refus métier ordinaire (identifiants invalides), pas une
    // session expirée. Sans cette distinction, une simple erreur de mot de
    // passe à la connexion s'affichait comme « Votre session a expiré ».
    final isAuthEndpoint = response.requestOptions.extra['skipAuth'] == true;
    if (response.statusCode == 401 && !isAuthEndpoint) return const Failure.unauthenticated();

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
