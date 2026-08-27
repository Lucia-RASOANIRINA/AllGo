import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => const TokenStore());

/// Jetons dans le Keychain iOS et le Keystore Android — §12.2.
///
/// Jamais `SharedPreferences` : sur un terminal rooté, un fichier de
/// préférences se lit en clair. Le Keystore matériel, non.
class TokenStore {
  const TokenStore();

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  static const _accessKey = 'allgo.access_token';
  static const _refreshKey = 'allgo.refresh_token';
  static const _databaseKey = 'allgo.db_key';

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  /// Clé de chiffrement SQLCipher de la base Drift (§12.2).
  ///
  /// Générée au premier lancement et conservée dans le stockage sécurisé.
  /// Perdre cette clé rend le cache illisible — ce qui est acceptable : le
  /// cache se reconstruit, contrairement à un secret.
  Future<String?> readDatabaseKey() => _storage.read(key: _databaseKey);

  Future<void> saveDatabaseKey(String key) => _storage.write(key: _databaseKey, value: key);

  /// Purge complète à la déconnexion — §12.2.
  ///
  /// Efface les jetons ET la clé de la base : sur un téléphone souvent partagé
  /// en famille, laisser le cache lisible après déconnexion reviendrait à ne
  /// pas s'être déconnecté.
  Future<void> clear() => _storage.deleteAll();
}
