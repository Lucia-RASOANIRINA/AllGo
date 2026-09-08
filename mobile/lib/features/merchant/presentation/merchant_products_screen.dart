import 'dart:convert';
import 'dart:typed_data';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart'
    show Category;
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/field_icon.dart';
import 'package:csv/csv.dart';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

final merchantProductsProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final shops = await api.get<Map<String, dynamic>>('/me/shops');
  final items = shops.data?['data'];
  if (items is! List || items.isEmpty)
    throw StateError('Aucune boutique associée.');
  final shopId = ((items.first as Map<String, dynamic>)['id'] ??
          (items.first as Map<String, dynamic>)['_id'])
      .toString();
  final response =
      await api.get<Map<String, dynamic>>('/shop/$shopId/products');
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
      body: AsyncView<List<Map<String, dynamic>>>(
        value: products,
        onRetry: () => ref.invalidate(merchantProductsProvider),
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucun produit pour l’instant',
        emptyMessage:
            'Ajoutez votre premier produit avec le bouton « Ajouter ».',
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(merchantProductsProvider),
          child: ListView.separated(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: items.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AllGoTokens.space2),
            itemBuilder: (context, index) {
              final product = items[index];
              final hidden = product['isHidden'] == true;
              final media = product['media'];
              final thumb =
                  media is List && media.isNotEmpty && media.first is Map
                      ? (media.first as Map)['thumbUrl']?.toString() ??
                          (media.first as Map)['url']?.toString()
                      : null;
              return Card(
                clipBehavior: Clip.antiAlias,
                child: ListTile(
                  leading: ClipRRect(
                    borderRadius: BorderRadius.circular(AllGoTokens.space2),
                    child: thumb == null
                        ? Container(
                            width: 48,
                            height: 48,
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                            child: Icon(
                              Icons.image_outlined,
                              color: Theme.of(context).colorScheme.outline,
                            ),
                          )
                        : Image.network(thumb,
                            width: 48, height: 48, fit: BoxFit.cover),
                  ),
                  title: Text(
                      '${product['name'] ?? 'Produit'}${hidden ? ' (masqué)' : ''}'),
                  subtitle: Text(
                    '${product['price'] ?? 0} Ar • Stock : ${product['stock'] ?? 0}'
                    '${product['isFeatured'] == true ? ' • Vedette' : ''}',
                  ),
                  trailing: PopupMenuButton<String>(
                    onSelected: (action) =>
                        _action(context, ref, product, action),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'edit', child: Text('Modifier')),
                      PopupMenuItem(
                          value: 'duplicate', child: Text('Dupliquer')),
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

  Future<void> _action(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> product,
    String action,
  ) async {
    final shops = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/me/shops');
    final items = shops.data?['data'];
    if (items is! List || items.isEmpty) return;
    final shop = items.first as Map<String, dynamic>;
    final shopId = (shop['id'] ?? shop['_id']).toString();
    final id = (product['id'] ?? product['_id']).toString();
    final api = ref.read(apiClientProvider);
    if (action == 'edit') {
      if (!context.mounted) return;
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
            TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Annuler')),
            FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Supprimer')),
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
      messenger.showSnackBar(
          const SnackBar(content: Text('Fichier CSV illisible.')));
      return;
    }
    if (rows.length < 2) {
      messenger.showSnackBar(const SnackBar(
          content: Text('Le fichier ne contient aucune ligne de produit.')));
      return;
    }

    final header =
        rows.first.map((cell) => cell.toString().trim().toLowerCase()).toList();
    int colIndex(String name) => header.indexOf(name);
    final nameCol = colIndex('name');
    final slugCol = colIndex('slug');
    final priceCol = colIndex('price');
    if (nameCol == -1 || slugCol == -1 || priceCol == -1) {
      messenger.showSnackBar(
        const SnackBar(
            content:
                Text('Colonnes obligatoires manquantes : name, slug, price.')),
      );
      return;
    }
    final promoCol = colIndex('promoprice');
    final stockCol = colIndex('stock');
    final skuCol = colIndex('sku');
    final barcodeCol = colIndex('barcode');
    final descriptionCol = colIndex('description');

    String? cell(List<dynamic> row, int index) => index == -1 ||
            index >= row.length ||
            row[index].toString().trim().isEmpty
        ? null
        : row[index].toString().trim();

    final items = <Map<String, dynamic>>[];
    for (final row in rows.skip(1)) {
      if (row.every((value) => value.toString().trim().isEmpty)) continue;
      items.add(<String, dynamic>{
        'name': cell(row, nameCol) ?? '',
        'slug': cell(row, slugCol) ?? '',
        'price': double.tryParse(cell(row, priceCol) ?? '') ?? 0,
        if (cell(row, promoCol) != null)
          'promoPrice': double.tryParse(cell(row, promoCol)!),
        if (cell(row, stockCol) != null)
          'stock': int.tryParse(cell(row, stockCol)!),
        if (cell(row, skuCol) != null) 'sku': cell(row, skuCol),
        if (cell(row, barcodeCol) != null) 'barcode': cell(row, barcodeCol),
        if (cell(row, descriptionCol) != null)
          'description': cell(row, descriptionCol),
      });
    }

    final shops = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/me/shops');
    final shopItems = shops.data?['data'];
    if (shopItems is! List || shopItems.isEmpty) return;
    final shopId = ((shopItems.first as Map<String, dynamic>)['id'] ??
            (shopItems.first as Map<String, dynamic>)['_id'])
        .toString();

    try {
      final response =
          await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/shop/$shopId/products/import',
        data: <String, dynamic>{'items': items},
      );
      final data = response.data?['data'] as Map<String, dynamic>? ??
          const <String, dynamic>{};
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
      messenger.showSnackBar(
          SnackBar(content: Text(message ?? 'Import impossible.')));
    }
  }

  Future<void> _openForm(
    BuildContext context,
    WidgetRef ref, {
    Map<String, dynamic>? product,
    String? shopId,
  }) async {
    final api = ref.read(apiClientProvider);
    var resolvedShopId = shopId;
    if (resolvedShopId == null) {
      final shops = await api.get<Map<String, dynamic>>('/me/shops');
      final items = shops.data?['data'];
      if (items is! List || items.isEmpty)
        throw StateError('Aucune boutique associée.');
      final shop = items.first as Map<String, dynamic>;
      resolvedShopId = (shop['id'] ?? shop['_id']).toString();
    }
    if (!context.mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) =>
          _ProductFormSheet(shopId: resolvedShopId!, product: product),
    );
  }
}

/// Slug conseillé : minuscules, chiffres et tirets — c'est ce que l'URL
/// publique de la fiche produit affichera telle quelle.
final RegExp _slugPattern = RegExp(r'^[a-z0-9]+(-[a-z0-9]+)*$');

class _ProductFormSheet extends ConsumerStatefulWidget {
  const _ProductFormSheet({required this.shopId, this.product});

  final String shopId;
  final Map<String, dynamic>? product;

  @override
  ConsumerState<_ProductFormSheet> createState() => _ProductFormSheetState();
}

class _ProductFormSheetState extends ConsumerState<_ProductFormSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _slug;
  late final TextEditingController _sku;
  late final TextEditingController _price;
  late final TextEditingController _promo;
  late final TextEditingController _stock;
  late final TextEditingController _size;
  late final TextEditingController _color;

  String? _categoryId;
  bool _featured = false;
  bool _hidden = false;
  bool _available = true;

  String? _existingImageUrl;
  Uint8List? _pickedImageBytes;
  String? _mediaKey;
  bool _uploadingImage = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final product = widget.product;
    _name = TextEditingController(text: product?['name']?.toString());
    _slug = TextEditingController(text: product?['slug']?.toString());
    _sku = TextEditingController(text: product?['sku']?.toString());
    _price = TextEditingController(text: product?['price']?.toString());
    _promo = TextEditingController(text: product?['promoPrice']?.toString());
    _stock = TextEditingController(text: product?['stock']?.toString() ?? '0');
    _size = TextEditingController();
    _color = TextEditingController();
    _categoryId = product?['categoryId']?.toString();
    _featured = product?['isFeatured'] == true;
    _hidden = product?['isHidden'] == true;
    _available = product?['isAvailable'] != false;

    final media = product?['media'];
    final firstMedia = media is List && media.isNotEmpty && media.first is Map
        ? media.first as Map
        : null;
    _existingImageUrl =
        firstMedia?['thumbUrl']?.toString() ?? firstMedia?['url']?.toString();
  }

  @override
  void dispose() {
    for (final controller in <TextEditingController>[
      _name,
      _slug,
      _sku,
      _price,
      _promo,
      _stock,
      _size,
      _color,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _pickImage() async {
    final image = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (image == null) return;

    setState(() => _uploadingImage = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await image.readAsBytes();
      final api = ref.read(apiClientProvider);
      final upload = await api.post<Map<String, dynamic>>(
        '/media/upload-url',
        data: <String, dynamic>{'type': 'image/jpeg', 'size': bytes.length},
      );
      final data = upload.data?['data'];
      if (data is! Map<String, dynamic>)
        throw const FormatException('Réponse média invalide.');
      await api.put<void>(
        data['uploadUrl'] as String,
        data: bytes,
        options: Options(
          headers: <String, dynamic>{
            'Content-Type': 'image/jpeg',
            'Content-Length': bytes.length,
          },
        ),
      );
      setState(() {
        _mediaKey = data['key'] as String;
        _pickedImageBytes = bytes;
      });
    } on DioException {
      messenger.showSnackBar(
          const SnackBar(content: Text('Impossible d’envoyer cette image.')));
    } finally {
      if (mounted) setState(() => _uploadingImage = false);
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final api = ref.read(apiClientProvider);
    final data = <String, dynamic>{
      'name': _name.text.trim(),
      'slug': _slug.text.trim(),
      'price': double.parse(_price.text.trim()),
      'stock': int.parse(_stock.text.trim()),
      'isFeatured': _featured,
      'isHidden': _hidden,
      'isAvailable': _available,
      if (_sku.text.trim().isNotEmpty) 'sku': _sku.text.trim(),
      if (_promo.text.trim().isNotEmpty)
        'promoPrice': double.parse(_promo.text.trim()),
      if (_categoryId != null) 'categoryId': _categoryId,
      if (_mediaKey != null) 'mediaKey': _mediaKey,
      if (_size.text.trim().isNotEmpty || _color.text.trim().isNotEmpty)
        'variants': <Map<String, dynamic>>[
          <String, dynamic>{
            'name': '${_size.text} ${_color.text}'.trim(),
            'size': _size.text.trim(),
            'color': _color.text.trim(),
            'stock': int.tryParse(_stock.text.trim()) ?? 0,
          },
        ],
    };

    try {
      final product = widget.product;
      if (product == null) {
        await api.post<void>('/shop/${widget.shopId}/products', data: data);
      } else {
        final id = (product['id'] ?? product['_id']).toString();
        await api.patch<void>('/shop/${widget.shopId}/products/$id',
            data: data);
      }
      ref.invalidate(merchantProductsProvider);
      if (mounted) Navigator.pop(context);
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
      messenger.showSnackBar(
          SnackBar(content: Text(message ?? 'Enregistrement impossible.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoryTreeProvider);

    return Padding(
      padding: EdgeInsets.fromLTRB(
          16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Form(
          key: _formKey,
          // Une erreur de prix ou de slug se voit dès la frappe, pas après un
          // rejet serveur au moment d'enregistrer (§12.1).
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                widget.product == null
                    ? 'Nouveau produit'
                    : 'Modifier le produit',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: AllGoTokens.space4),
              Center(
                child: GestureDetector(
                  onTap: _uploadingImage ? null : _pickImage,
                  child: Stack(
                    alignment: Alignment.bottomRight,
                    children: <Widget>[
                      ClipRRect(
                        borderRadius:
                            BorderRadius.circular(AllGoTokens.radiusCard),
                        child: _pickedImageBytes != null
                            ? Image.memory(_pickedImageBytes!,
                                width: 120, height: 120, fit: BoxFit.cover)
                            : _existingImageUrl != null
                                ? Image.network(_existingImageUrl!,
                                    width: 120, height: 120, fit: BoxFit.cover)
                                : Container(
                                    width: 120,
                                    height: 120,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .surfaceContainerHighest,
                                    child: Icon(
                                      Icons.add_photo_alternate_outlined,
                                      size: 32,
                                      color:
                                          Theme.of(context).colorScheme.outline,
                                    ),
                                  ),
                      ),
                      CircleAvatar(
                        radius: 16,
                        child: _uploadingImage
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.camera_alt_outlined, size: 16),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AllGoTokens.space4),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Nom',
                  prefixIcon: FieldIcon(Icons.shopping_bag_outlined),
                ),
                validator: (value) => (value ?? '').trim().isEmpty
                    ? 'Entrez le nom du produit.'
                    : null,
              ),
              const SizedBox(height: AllGoTokens.space3),
              TextFormField(
                controller: _slug,
                decoration: const InputDecoration(
                  labelText: 'Slug (identifiant dans l’URL)',
                  hintText: 'robe-imprimee-lamba',
                  prefixIcon: FieldIcon(Icons.link_outlined),
                ),
                validator: (value) {
                  final v = (value ?? '').trim();
                  if (v.isEmpty) return 'Entrez un identifiant.';
                  if (!_slugPattern.hasMatch(v)) {
                    return 'Minuscules, chiffres et tirets uniquement.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: AllGoTokens.space3),
              TextFormField(
                controller: _sku,
                decoration: const InputDecoration(
                  labelText: 'SKU (optionnel)',
                  prefixIcon: FieldIcon(Icons.qr_code_outlined),
                ),
              ),
              const SizedBox(height: AllGoTokens.space3),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: TextFormField(
                      controller: _price,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'Prix (Ar)',
                        prefixIcon: FieldIcon(Icons.sell_outlined),
                      ),
                      validator: (value) {
                        final parsed = double.tryParse((value ?? '').trim());
                        if (parsed == null) return 'Prix invalide.';
                        if (parsed <= 0) return 'Doit être supérieur à 0.';
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: AllGoTokens.space3),
                  Expanded(
                    child: TextFormField(
                      controller: _promo,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: 'Prix promo (optionnel)',
                        prefixIcon: FieldIcon(Icons.local_offer_outlined),
                      ),
                      validator: (value) {
                        final text = (value ?? '').trim();
                        if (text.isEmpty) return null;
                        final parsed = double.tryParse(text);
                        if (parsed == null || parsed <= 0)
                          return 'Prix invalide.';
                        final price = double.tryParse(_price.text.trim());
                        if (price != null && parsed >= price) {
                          return 'Doit être inférieur au prix.';
                        }
                        return null;
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AllGoTokens.space3),
              TextFormField(
                controller: _stock,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Stock',
                  prefixIcon: FieldIcon(Icons.inventory_2_outlined),
                ),
                validator: (value) {
                  final parsed = int.tryParse((value ?? '').trim());
                  if (parsed == null) return 'Nombre entier requis.';
                  if (parsed < 0) return 'Ne peut pas être négatif.';
                  return null;
                },
              ),
              const SizedBox(height: AllGoTokens.space3),
              categories.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: AllGoTokens.space2),
                  child: LinearProgressIndicator(),
                ),
                error: (_, __) => const SizedBox.shrink(),
                data: (list) {
                  final flat = <(String, String, int)>[];
                  void collect(List<Category> nodes, int depth) {
                    for (final node in nodes) {
                      flat.add((node.id, node.name, depth));
                      collect(node.children, depth + 1);
                    }
                  }

                  collect(list, 0);

                  return DropdownButtonFormField<String>(
                    initialValue: _categoryId,
                    decoration: const InputDecoration(
                      labelText: 'Catégorie (optionnel)',
                      prefixIcon: FieldIcon(Icons.category_outlined),
                    ),
                    items: <DropdownMenuItem<String>>[
                      for (final (id, name, depth) in flat)
                        DropdownMenuItem(
                            value: id, child: Text('${'   ' * depth}$name')),
                    ],
                    onChanged: (value) => setState(() => _categoryId = value),
                  );
                },
              ),
              const SizedBox(height: AllGoTokens.space3),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TextFormField(
                      controller: _size,
                      decoration: const InputDecoration(
                          labelText: 'Taille (optionnel)'),
                    ),
                  ),
                  const SizedBox(width: AllGoTokens.space3),
                  Expanded(
                    child: TextFormField(
                      controller: _color,
                      decoration: const InputDecoration(
                          labelText: 'Couleur (optionnel)'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AllGoTokens.space2),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Produit vedette'),
                value: _featured,
                onChanged: (value) => setState(() => _featured = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Produit masqué'),
                value: _hidden,
                onChanged: (value) => setState(() => _hidden = value),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Disponible'),
                value: _available,
                onChanged: (value) => setState(() => _available = value),
              ),
              const SizedBox(height: AllGoTokens.space4),
              FilledButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Enregistrer'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
