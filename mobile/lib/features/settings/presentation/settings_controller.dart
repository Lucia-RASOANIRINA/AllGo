import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Préférences d'affichage, synchronisées avec `users.preferences` côté API.
@immutable
class SettingsState {
  const SettingsState({
    this.themeMode = ThemeMode.system,
    this.locale = const Locale('fr'),
    this.dataSaver = false,
  });

  final ThemeMode themeMode;
  final Locale locale;

  /// Mode économie de données — mesure de maîtrise du risque R7 (§20).
  /// Désactive le préchargement des images et n'affiche que les miniatures.
  final bool dataSaver;

  SettingsState copyWith({ThemeMode? themeMode, Locale? locale, bool? dataSaver}) {
    return SettingsState(
      themeMode: themeMode ?? this.themeMode,
      locale: locale ?? this.locale,
      dataSaver: dataSaver ?? this.dataSaver,
    );
  }
}

class SettingsController extends Notifier<SettingsState> {
  @override
  SettingsState build() => const SettingsState();

  void setThemeMode(ThemeMode mode) => state = state.copyWith(themeMode: mode);

  /// Français par défaut, malgache en seconde langue (§11.5).
  void setLocale(Locale locale) => state = state.copyWith(locale: locale);

  void setDataSaver({required bool enabled}) => state = state.copyWith(dataSaver: enabled);
}

final settingsControllerProvider =
    NotifierProvider<SettingsController, SettingsState>(SettingsController.new);
