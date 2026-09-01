import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:dio/dio.dart';

/// Préférences d'affichage, synchronisées avec `users.preferences` côté API.
@immutable
class SettingsState {
  const SettingsState({
    this.themeMode = ThemeMode.system,
    this.locale = const Locale('fr'),
    this.dataSaver = false,
    this.pushEnabled = true,
    this.notificationCategories = const <String, bool>{
      'orders': true,
      'promotions': true,
      'social': true,
      'messages': true,
      'delivery': true,
    },
  });

  final ThemeMode themeMode;
  final Locale locale;

  /// Mode économie de données — mesure de maîtrise du risque R7 (§20).
  /// Désactive le préchargement des images et n'affiche que les miniatures.
  final bool dataSaver;
  final bool pushEnabled;
  final Map<String, bool> notificationCategories;

  SettingsState copyWith({
    ThemeMode? themeMode,
    Locale? locale,
    bool? dataSaver,
    bool? pushEnabled,
    Map<String, bool>? notificationCategories,
  }) {
    return SettingsState(
      themeMode: themeMode ?? this.themeMode,
      locale: locale ?? this.locale,
      dataSaver: dataSaver ?? this.dataSaver,
      pushEnabled: pushEnabled ?? this.pushEnabled,
      notificationCategories:
          notificationCategories ?? this.notificationCategories,
    );
  }
}

class SettingsController extends Notifier<SettingsState> {
  @override
  SettingsState build() {
    unawaited(_load());
    return const SettingsState();
  }

  /// Relit `/me` au démarrage : sans cela, l'écran réaffiche toujours les
  /// valeurs par défaut après un redémarrage, même si le serveur a bien
  /// enregistré les préférences d'une session précédente.
  Future<void> _load() async {
    try {
      final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me');
      final data = response.data?['data'];
      if (data is! Map<String, dynamic>) return;
      final preferences = data['preferences'] as Map<String, dynamic>? ?? const <String, dynamic>{};
      final pushCategories =
          preferences['pushCategories'] as Map<String, dynamic>? ?? const <String, dynamic>{};

      state = state.copyWith(
        pushEnabled: preferences['pushEnabled'] as bool? ?? state.pushEnabled,
        notificationCategories: <String, bool>{
          ...state.notificationCategories,
          for (final entry in pushCategories.entries)
            if (entry.value is bool) entry.key: entry.value as bool,
        },
      );
    } on DioException {
      // Hors ligne : les valeurs par défaut restent affichées, sans erreur
      // bloquante — ce sont des préférences, pas une donnée critique.
    }
  }

  void setThemeMode(ThemeMode mode) => state = state.copyWith(themeMode: mode);

  /// Français par défaut, malgache en seconde langue (§11.5).
  void setLocale(Locale locale) => state = state.copyWith(locale: locale);

  void setDataSaver({required bool enabled}) =>
      state = state.copyWith(dataSaver: enabled);

  Future<void> setPushEnabled({required bool enabled}) async {
    state = state.copyWith(pushEnabled: enabled);
    await _persist();
  }

  Future<void> setNotificationCategory(
    String category, {
    required bool enabled,
  }) async {
    state = state.copyWith(
      notificationCategories: <String, bool>{
        ...state.notificationCategories,
        category: enabled,
      },
    );
    await _persist();
  }

  Future<void> _persist() async {
    await ref.read(apiClientProvider).patch<void>(
      '/me',
      data: <String, dynamic>{
        'pushEnabled': state.pushEnabled,
        'notificationCategories': state.notificationCategories,
      },
    );
  }
}

final settingsControllerProvider =
    NotifierProvider<SettingsController, SettingsState>(SettingsController.new);
