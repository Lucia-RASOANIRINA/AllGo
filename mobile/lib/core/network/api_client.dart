import 'package:allgo/core/env/environment.dart';
import 'package:allgo/core/network/auth_interceptor.dart';
import 'package:allgo/core/network/error_interceptor.dart';
import 'package:allgo/core/network/retry_interceptor.dart';
import 'package:allgo/core/storage/token_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final apiClientProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: Environment.apiBaseUrl,
      // Délais courts et assumés : sur un réseau 3G intermittent, mieux vaut
      // échouer vite et servir le cache que faire patienter 60 secondes.
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      sendTimeout: const Duration(seconds: 30),
      headers: <String, String>{
        'Accept': 'application/json',
        'Accept-Encoding': 'br, gzip',
      },
      // Les codes 4xx sont traités par `ErrorInterceptor`, pas par une
      // exception brute de Dio : l'API renvoie un message déjà affichable.
      validateStatus: (status) => status != null && status < 500,
    ),
  );

  dio.interceptors.addAll(<Interceptor>[
    AuthInterceptor(ref.read(tokenStoreProvider), dio),
    RetryInterceptor(dio),
    ErrorInterceptor(),
  ]);

  return dio;
});
