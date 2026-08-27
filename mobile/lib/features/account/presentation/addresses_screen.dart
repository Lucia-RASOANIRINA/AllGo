import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final AutoDisposeFutureProvider<List<Map<String, dynamic>>> addressesProvider =
  FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/me/addresses');
  final data = response.data?['data'];
  if (data is! List<dynamic>) return const <Map<String, dynamic>>[];
  return data.whereType<Map<String, dynamic>>().toList();
  });

class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final addresses = ref.watch(addressesProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Adresses de livraison'),
        actions: <Widget>[
          IconButton(
            onPressed: () => _addAddress(context, ref),
            icon: const Icon(Icons.add),
            tooltip: 'Ajouter une adresse',
          ),
        ],
      ),
      body: addresses.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text(error is DioException ? 'Impossible de charger les adresses.' : 'Une erreur est survenue.')),
        data: (items) => items.isEmpty
            ? const Center(child: Text('Aucune adresse enregistrée.'))
            : ListView.separated(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: AllGoTokens.space3),
                itemBuilder: (context, index) {
                  final address = items[index];
                  final id = address['id']?.toString() ?? address['_id']?.toString();
                  return Card(
                    child: ListTile(
                      leading: const Icon(Icons.location_on_outlined),
                      title: Text(address['label'] as String? ?? 'Adresse'),
                      subtitle: Text('${address['line'] as String? ?? ''}\n${address['city'] as String? ?? ''}'),
                      isThreeLine: true,
                      trailing: id == null
                          ? null
                          : IconButton(
                              onPressed: () => _removeAddress(context, ref, id),
                              icon: const Icon(Icons.delete_outline),
                              tooltip: 'Supprimer cette adresse',
                            ),
                    ),
                  );
                },
              ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _addAddress(context, ref),
        icon: const Icon(Icons.add_location_alt_outlined),
        label: const Text('Ajouter'),
      ),
    );
  }

  Future<void> _addAddress(BuildContext context, WidgetRef ref) async {
    final formKey = GlobalKey<FormState>();
    final label = TextEditingController();
    final city = TextEditingController(text: 'Mahajanga');
    final line = TextEditingController();
    final district = TextEditingController();
    ({double latitude, double longitude})? position;
    final added = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nouvelle adresse'),
        content: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TextFormField(controller: label, decoration: const InputDecoration(labelText: 'Libellé'), validator: _required),
                TextFormField(controller: line, decoration: const InputDecoration(labelText: 'Adresse'), validator: _required),
                TextFormField(controller: district, decoration: const InputDecoration(labelText: 'Quartier (facultatif)')),
                TextFormField(controller: city, decoration: const InputDecoration(labelText: 'Ville'), validator: _required),
                StatefulBuilder(
                  builder: (context, setState) => Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () async {
                        final result = await ref.read(currentPositionProvider.future);
                        setState(() => position = result);
                      },
                      icon: const Icon(Icons.my_location_outlined),
                      label: Text(position == null ? 'Utiliser ma position' : 'Position ajoutée'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annuler')),
          FilledButton(
            onPressed: () async {
              if (!formKey.currentState!.validate()) return;
              try {
                await ref.read(apiClientProvider).post<void>(
                  '/me/addresses',
                  data: <String, dynamic>{
                    'label': label.text.trim(),
                    'line': line.text.trim(),
                    'city': city.text.trim(),
                    if (district.text.trim().isNotEmpty) 'district': district.text.trim(),
                    if (position != null)
                      'location': <String, dynamic>{
                        'type': 'Point',
                        'coordinates': <double>[position!.longitude, position!.latitude],
                      },
                  },
                );
                if (context.mounted) Navigator.pop(context, true);
              } on DioException {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Impossible d’ajouter cette adresse.')));
              }
            },
            child: const Text('Ajouter'),
          ),
        ],
      ),
    );
    label.dispose();
    city.dispose();
    line.dispose();
    district.dispose();
    if (added == true) ref.invalidate(addressesProvider);
  }

  Future<void> _removeAddress(BuildContext context, WidgetRef ref, String id) async {
    try {
      await ref.read(apiClientProvider).delete<void>('/me/addresses/$id');
      ref.invalidate(addressesProvider);
    } on DioException {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Impossible de supprimer cette adresse.')));
    }
  }

  String? _required(String? value) => value == null || value.trim().isEmpty ? 'Champ requis' : null;
}
