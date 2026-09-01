import 'dart:async';

import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/storage/token_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Rôle actif — pilote la barre de navigation et les écrans accessibles (§11.2).
enum ActiveProfile { client, merchant, courier }

@immutable
class SessionState {
  const SessionState({
    this.userId,
    this.displayName,
    this.roles = const <String>[],
    this.activeProfile = ActiveProfile.client,
    this.isRestoring = true,
  });

  final String? userId;
  final String? displayName;
  final List<String> roles;
  final ActiveProfile activeProfile;

  /// Vrai pendant la lecture des jetons au démarrage : évite de rediriger vers
  /// l'écran de connexion un utilisateur en fait déjà connecté.
  final bool isRestoring;

  bool get isAuthenticated => userId != null;

  /// Un commerçant reste un client sur AllGo (§11.2) : les profils se cumulent,
  /// ils ne s'excluent pas.
  bool get canSwitchProfile => roles.any((r) => r != 'client');
}

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() {
    unawaited(_restore());
    return const SessionState();
  }

  Future<void> _restore() async {
    final token = await ref.read(tokenStoreProvider).readAccessToken();
    if (token == null) {
      state = const SessionState(isRestoring: false);
      return;
    }

    try {
      final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me');
      final me = response.data!['data'] as Map<String, dynamic>;

      state = SessionState(
        userId: me['id'] as String,
        displayName: '${me['firstName']} ${me['lastName']}',
        roles: ((me['roles'] as List<dynamic>?) ?? const <dynamic>[])
            .map((r) => (r as Map<String, dynamic>)['role'] as String)
            .toList(),
        isRestoring: false,
      );
    } on DioException {
      // Jeton invalide ou hors ligne : on n'efface rien. Effacer les jetons sur
      // une simple coupure réseau déconnecterait l'utilisateur chaque fois
      // qu'il ouvre l'application sans réseau — exactement le contraire du
      // fonctionnement hors ligne d'abord.
      state = const SessionState(isRestoring: false);
    }
  }

  Future<void> signIn({required String phone, required String password}) async {
    await _authenticate('/auth/login', <String, String>{
      'phone': phone,
      'password': password,
    });
  }

  /// Création de compte — `POST /auth/register`.
  /// La réponse contient déjà la paire de jetons : aucune connexion séparée.
  Future<void> register({
    required String phone,
    required String password,
    required String firstName,
    required String lastName,
  }) async {
    await _authenticate('/auth/register', <String, String>{
      'phone': phone,
      'password': password,
      'firstName': firstName,
      'lastName': lastName,
    });
  }

  /// Demande d'un code SMS à 6 chiffres, valable 5 minutes (§12.2).
  Future<void> sendOtp(String phone) async {
    await ref.read(apiClientProvider).post<Map<String, dynamic>>(
          '/auth/otp/send',
          data: <String, String>{'phone': phone},
          options: Options(extra: <String, bool>{'skipAuth': true}),
        );
  }

  Future<void> verifyOtp({required String phone, required String code}) async {
    await _authenticate('/auth/otp/verify', <String, String>{
      'phone': phone,
      'code': code,
    });
  }

  /// Demande de réinitialisation. Ne renvoie jamais d'information sur
  /// l'existence du compte — la réponse serveur est constante par conception.
  Future<void> forgotPassword(String phone) async {
    await ref.read(apiClientProvider).post<Map<String, dynamic>>(
          '/auth/password/forgot',
          data: <String, String>{'phone': phone},
          options: Options(extra: <String, bool>{'skipAuth': true}),
        );
  }

  /// Enchaînement commun aux trois voies d'accès : appel, stockage sécurisé des
  /// jetons, puis relecture du profil. Le dupliquer trois fois garantirait
  /// qu'une des trois oublie un jour d'enregistrer le jeton de rafraîchissement.
  Future<void> _authenticate(String path, Map<String, String> body) async {
    final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
          path,
          data: body,
          options: Options(extra: <String, bool>{'skipAuth': true}),
        );

    final data = response.data!['data'] as Map<String, dynamic>;
    await ref.read(tokenStoreProvider).save(
          accessToken: data['accessToken'] as String,
          refreshToken: data['refreshToken'] as String,
        );

    await _restore();
  }

  Future<void> signOut() async {
    try {
      await ref.read(apiClientProvider).post<void>('/auth/logout');
    } on DioException {
      // Une déconnexion locale doit aboutir même sans réseau : le jeton de
      // rafraîchissement expirera de lui-même côté serveur.
    }

    Future<void> refresh() => _restore();

    // Purge complète du cache et des jetons (§12.2).
    await ref.read(tokenStoreProvider).clear();
    state = const SessionState(isRestoring: false);
  }

  void switchProfile(ActiveProfile profile) {
    state = SessionState(
      userId: state.userId,
      displayName: state.displayName,
      roles: state.roles,
      activeProfile: profile,
      isRestoring: false,
    );
  }
}

final sessionControllerProvider =
    NotifierProvider<SessionController, SessionState>(SessionController.new);
