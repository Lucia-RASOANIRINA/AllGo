import 'dart:io';

import 'package:allgo/core/env/environment.dart';
import 'package:allgo/core/network/auth_interceptor.dart';
import 'package:allgo/core/network/error_interceptor.dart';
import 'package:allgo/core/network/retry_interceptor.dart';
import 'package:allgo/core/storage/token_store.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
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
        // `dart:io` (l'adaptateur HTTP par défaut de Dio) ne décompresse que le
        // gzip automatiquement. Annoncer « br » fait répondre le serveur en
        // Brotli — que Dio ne sait pas décoder — et casse le parsing JSON de
        // toute réponse dépassant le seuil de compression.
        'Accept-Encoding': 'gzip',
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

  // Contournement TEMPORAIRE, désactivé par défaut — voir le commentaire sur
  // `Environment.allowInsecureCert`. Limité au seul hôte de l'API : même
  // activé, une requête vers un hôte tiers reste normalement vérifiée.
  if (Environment.allowInsecureCert) {
    final apiHost = Uri.parse(Environment.apiBaseUrl).host;
    (dio.httpClientAdapter as IOHttpClientAdapter).createHttpClient = () {
      return HttpClient()
        ..badCertificateCallback = (cert, host, port) => host == apiHost;
    };
  }

  return dio;
});
