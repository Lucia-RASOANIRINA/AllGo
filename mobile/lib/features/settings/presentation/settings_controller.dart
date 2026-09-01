import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:allgo/core/network/api_client.dart';

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
  SettingsState build() => const SettingsState();

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
