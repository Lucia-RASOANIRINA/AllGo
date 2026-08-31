import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Adresse enregistrée — `GET/POST/DELETE /me/addresses`. Extrait de
/// `addresses_screen.dart` pour être réutilisable au checkout (§ décisions de
/// portée : le tunnel de commande doit pouvoir piocher dans ce carnet plutôt
/// que forcer une ressaisie à chaque commande).
class SavedAddress {
  const SavedAddress({
    required this.id,
    required this.label,
    required this.line,
    required this.city,
    this.district,
    this.latitude,
    this.longitude,
    this.isDefault = false,
  });

  factory SavedAddress.fromJson(Map<String, dynamic> json) {
    final coordinates =
        (json['location'] as Map<String, dynamic>?)?['coordinates'] as List<dynamic>?;
    return SavedAddress(
      id: idFromJson(json),
      label: json['label'] as String? ?? 'Adresse',
      line: json['line'] as String? ?? '',
      city: json['city'] as String? ?? '',
      district: json['district'] as String?,
      // ATTENTION : `coordinates` est en GeoJSON, donc [longitude, latitude].
      longitude: coordinates == null ? null : doubleFromJson(coordinates[0]),
      latitude: coordinates == null ? null : doubleFromJson(coordinates[1]),
      isDefault: json['isDefault'] as bool? ?? false,
    );
  }

  final String id;
  final String label;
  final String line;
  final String city;
  final String? district;
  final double? latitude;
  final double? longitude;
  final bool isDefault;

  bool get hasLocation => latitude != null && longitude != null;
}

final AutoDisposeFutureProvider<List<SavedAddress>> addressesProvider =
    FutureProvider.autoDispose<List<SavedAddress>>((ref) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/me/addresses');
  final data = response.data?['data'];
  if (data is! List<dynamic>) return const <SavedAddress>[];
  return data.whereType<Map<String, dynamic>>().map(SavedAddress.fromJson).toList();
});
