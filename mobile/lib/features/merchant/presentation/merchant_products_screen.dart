import 'dart:convert';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:csv/csv.dart';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final merchantProductsProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final shops = await api.get<Map<String, dynamic>>('/me/shops');
  final items = shops.data?['data'];
  if (items is! List || items.isEmpty) throw StateError('Aucune boutique associée.');
  final shopId = ((items.first as Map<String, dynamic>)['id'] ??
          (items.first as Map<String, dynamic>)['_id'])
      .toString();
  final response = await api.get<Map<String, dynamic>>('/shop/$shopId/products');
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

class MerchantProductsScreen extends ConsumerWidget {
  const MerchantProductsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(merchantProductsProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gestion des produits'),
        actions: <Widget>[
          IconButton(
            onPressed: () => _importCsv(context, ref),
            icon: const Icon(Icons.upload_file_outlined),
            tooltip: 'Importer des produits (CSV)',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Ajouter'),
      ),
      body: products.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('Erreur : $error')),
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(merchantProductsProvider),
          child: ListView.builder(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: items.length,
            itemBuilder: (context, index) {
              final product = items[index];
              final hidden = product['isHidden'] == true;
              return Card(
                child: ListTile(
                  title: Text('${product['name'] ?? 'Produit'}${hidden ? ' (masqué)' : ''}'),
                  subtitle: Text(
                    '${product['price'] ?? 0} Ar • Stock : ${product['stock'] ?? 0}'
                    '${product['isFeatured'] == true ? ' • Vedette' : ''}',
                  ),
                  trailing: PopupMenuButton<String>(
                    onSelected: (action) => _action(context, ref, product, action),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Modifier')),
                      PopupMenuItem(value: 'duplicate', child: Text('Dupliquer')),
                      PopupMenuItem(value: 'delete', child: Text('Supprimer')),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _action(BuildContext context, WidgetRef ref,
      Map<String, dynamic> product, String action) async {
    final shops = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
    final items = shops.data?['data'];
    if (items is! List || items.isEmpty) return;
    final shop = items.first as Map<String, dynamic>;
    final shopId = (shop['id'] ?? shop['_id']).toString();
    final id = (product['id'] ?? product['_id']).toString();
    final api = ref.read(apiClientProvider);
    if (action == 'edit') {
      await _openForm(context, ref, product: product, shopId: shopId);
    } else if (action == 'duplicate') {
      await api.post<void>('/shop/$shopId/products/$id/duplicate');
      ref.invalidate(merchantProductsProvider);
    } else if (action == 'delete' && context.mounted) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Supprimer ce produit ?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Annuler')),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Supprimer')),
          ],
        ),
      );
      if (confirmed == true) {
        await api.delete<void>('/shop/$shopId/products/$id');
        ref.invalidate(merchantProductsProvider);
      }
    }
  }

  /// Import en masse — colonnes attendues (dans n'importe quel ordre) :
  /// `name,slug,price` obligatoires, `promoPrice,stock,sku,barcode,description`
  /// optionnelles. La première ligne est l'en-tête.
  Future<void> _importCsv(BuildContext context, WidgetRef ref) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: <String>['csv'],
      withData: true,
    );
    final bytes = result?.files.single.bytes;
    if (bytes == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    late final List<List<dynamic>> rows;
    try {
      rows = const CsvToListConverter(eol: '\n', shouldParseNumbers: false)
          .convert(utf8.decode(bytes));
    } on Exception {
      messenger.showSnackBar(const SnackBar(content: Text('Fichier CSV illisible.')));
      return;
    }
    if (rows.length < 2) {
      messenger.showSnackBar(const SnackBar(content: Text('Le fichier ne contient aucune ligne de produit.')));
      return;
    }

    final header = rows.first.map((cell) => cell.toString().trim().toLowerCase()).toList();
    int colIndex(String name) => header.indexOf(name);
    final nameCol = colIndex('name');
    final slugCol = colIndex('slug');
    final priceCol = colIndex('price');
    if (nameCol == -1 || slugCol == -1 || priceCol == -1) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Colonnes obligatoires manquantes : name, slug, price.')),
      );
      return;
    }
    final promoCol = colIndex('promoprice');
    final stockCol = colIndex('stock');
    final skuCol = colIndex('sku');
    final barcodeCol = colIndex('barcode');
    final descriptionCol = colIndex('description');

    String? cell(List<dynamic> row, int index) =>
        index == -1 || index >= row.length || row[index].toString().trim().isEmpty
            ? null
            : row[index].toString().trim();

    final items = <Map<String, dynamic>>[];
    for (final row in rows.skip(1)) {
      if (row.every((value) => value.toString().trim().isEmpty)) continue;
      items.add(<String, dynamic>{
        'name': cell(row, nameCol) ?? '',
        'slug': cell(row, slugCol) ?? '',
        'price': double.tryParse(cell(row, priceCol) ?? '') ?? 0,
        if (cell(row, promoCol) != null) 'promoPrice': double.tryParse(cell(row, promoCol)!),
        if (cell(row, stockCol) != null) 'stock': int.tryParse(cell(row, stockCol)!),
        if (cell(row, skuCol) != null) 'sku': cell(row, skuCol),
        if (cell(row, barcodeCol) != null) 'barcode': cell(row, barcodeCol),
        if (cell(row, descriptionCol) != null) 'description': cell(row, descriptionCol),
      });
    }

    final shops = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
    final shopItems = shops.data?['data'];
    if (shopItems is! List || shopItems.isEmpty) return;
    final shopId = ((shopItems.first as Map<String, dynamic>)['id'] ??
            (shopItems.first as Map<String, dynamic>)['_id'])
        .toString();

    try {
      final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/shop/$shopId/products/import',
        data: <String, dynamic>{'items': items},
      );
      final data = response.data?['data'] as Map<String, dynamic>? ?? const <String, dynamic>{};
      final created = data['created'] as int? ?? 0;
      final errors = (data['errors'] as List<dynamic>?) ?? const <dynamic>[];
      ref.invalidate(merchantProductsProvider);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            errors.isEmpty
                ? '$created produit${created > 1 ? 's' : ''} importé${created > 1 ? 's' : ''}.'
                : '$created importé(s), ${errors.length} ligne(s) en erreur.',
          ),
        ),
      );
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
      messenger.showSnackBar(SnackBar(content: Text(message ?? 'Import impossible.')));
    }
  }

  Future<void> _openForm(BuildContext context, WidgetRef ref,
      {Map<String, dynamic>? product, String? shopId}) async {
    final api = ref.read(apiClientProvider);
    if (shopId == null) {
      final shops = await api.get<Map<String, dynamic>>('/me/shops');
      final items = shops.data?['data'];
      if (items is! List || items.isEmpty) throw StateError('Aucune boutique associée.');
      final shop = items.first as Map<String, dynamic>;
      shopId = (shop['id'] ?? shop['_id']).toString();
    }
    if (!context.mounted) return;
    final name = TextEditingController(text: product?['name']?.toString());
    final slug = TextEditingController(text: product?['slug']?.toString());
    final price = TextEditingController(text: product?['price']?.toString());
    final promo = TextEditingController(text: product?['promoPrice']?.toString());
    final stock = TextEditingController(text: product?['stock']?.toString() ?? '0');
    final sku = TextEditingController(text: product?['sku']?.toString());
    final media = product?['media'];
    final firstMedia = media is List && media.isNotEmpty && media.first is Map
        ? media.first as Map
        : null;
    final image = TextEditingController(text: firstMedia?['url']?.toString());
    final category = TextEditingController(text: product?['categoryId']?.toString());
    final size = TextEditingController();
    final color = TextEditingController();
    bool featured = product?['isFeatured'] == true;
    bool hidden = product?['isHidden'] == true;
    bool available = product?['isAvailable'] != false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(builder: (context, setState) {
        final fields = <(String, TextEditingController)>[
          ('Nom', name), ('Slug', slug), ('SKU', sku), ('Prix', price),
          ('Prix promotionnel', promo), ('Stock', stock),
          ('Catégorie (ID)', category), ('Image URL', image),
          ('Tailles (optionnel)', size), ('Couleurs (optionnel)', color),
        ];
        return Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(children: [
              Text(product == null ? 'Nouveau produit' : 'Modifier le produit',
                  style: Theme.of(context).textTheme.titleLarge),
              for (final field in fields)
                Padding(padding: const EdgeInsets.only(top: 10),
                  child: TextField(controller: field.$2, decoration: InputDecoration(labelText: field.$1))),
              SwitchListTile(title: const Text('Produit vedette'), value: featured,
                  onChanged: (value) => setState(() => featured = value)),
              SwitchListTile(title: const Text('Produit masqué'), value: hidden,
                  onChanged: (value) => setState(() => hidden = value)),
              SwitchListTile(title: const Text('Disponible'), value: available,
                  onChanged: (value) => setState(() => available = value)),
              FilledButton(
                onPressed: () async {
                  final data = <String, dynamic>{
                    'name': name.text, 'slug': slug.text, 'sku': sku.text,
                    'price': double.tryParse(price.text) ?? 0,
                    'promoPrice': double.tryParse(promo.text),
                    'stock': int.tryParse(stock.text) ?? 0,
                    'isFeatured': featured, 'isHidden': hidden, 'isAvailable': available,
                    'categoryId': category.text,
                    'media': image.text.isEmpty ? <dynamic>[] : [{'url': image.text, 'isMain': true}],
                    'variants': (size.text.isEmpty && color.text.isEmpty)
                        ? <dynamic>[]
                        : [{'name': '${size.text} ${color.text}'.trim(), 'size': size.text, 'color': color.text, 'stock': int.tryParse(stock.text) ?? 0}],
                  }..removeWhere((key, value) => value == null || (value is String && value.isEmpty));
                  if (product == null) {
                    await api.post<void>('/shop/$shopId/products', data: data);
                  } else {
                    final id = (product['id'] ?? product['_id']).toString();
                    await api.patch<void>('/shop/$shopId/products/$id', data: data);
                  }
                  if (sheetContext.mounted) Navigator.pop(sheetContext);
                  ref.invalidate(merchantProductsProvider);
                },
                child: const Text('Enregistrer'),
              ),
            ]),
          ),
        );
      }),
    );
    for (final controller in [name, slug, price, promo, stock, sku, image, category, size, color]) {
      controller.dispose();
    }
  }
}
