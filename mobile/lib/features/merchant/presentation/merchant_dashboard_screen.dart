import 'dart:typed_data';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/field_icon.dart';
import 'package:allgo/shared/widgets/shop_avatar.dart';
import 'package:allgo/features/merchant/presentation/merchant_customers_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_stock_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_team_screen.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

final merchantDashboardProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final shopsResponse = await api.get<Map<String, dynamic>>('/me/shops');
  final shops = shopsResponse.data?['data'];
  if (shops is! List || shops.isEmpty) {
    throw StateError('Aucune boutique associée à ce compte.');
  }
  final shop = shops.first as Map<String, dynamic>;
  final id = (shop['id'] ?? shop['_id']).toString();
  final response = await api.get<Map<String, dynamic>>('/shop/$id/dashboard');
  return (response.data?['data'] as Map<String, dynamic>?) ??
      <String, dynamic>{};
});

class MerchantDashboardScreen extends ConsumerWidget {
  const MerchantDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(merchantDashboardProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Espace commerçant')),
      body: AsyncView<Map<String, dynamic>>(
        value: dashboard,
        isEmpty: (data) => data.isEmpty,
        emptyTitle: 'Aucune boutique',
        emptyMessage: 'Créez votre boutique pour accéder au dashboard.',
        onRetry: () => ref.invalidate(merchantDashboardProvider),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(merchantDashboardProvider),
          child: ListView(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            children: <Widget>[
              _MetricGrid(data: data),
              const SizedBox(height: AllGoTokens.space4),
              _TopProductsCard(
                analytics:
                    data['analytics'] as Map<String, dynamic>? ?? const {},
              ),
              const SizedBox(height: AllGoTokens.space4),
              ListTile(
                leading: const Icon(Icons.storefront_outlined),
                title: const Text('Gérer ma boutique'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        MerchantShopScreen(shopId: data['shopId'] as String?),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.groups_outlined),
                title: const Text('Gérer l’équipe'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const MerchantTeamScreen(),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.account_balance_wallet_outlined),
                title: const Text('Solde et retraits'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(Routes.merchantWithdrawals,
                    extra: data['shopId']),
              ),
              ListTile(
                leading: const Icon(Icons.people_outline),
                title: const Text('Clients'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => MerchantCustomersScreen(
                        shopId: data['shopId'] as String),
                  ),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: const Text('Stock'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        MerchantStockScreen(shopId: data['shopId'] as String),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final stock = data['stock'] as Map<String, dynamic>?;
    final statistics = data['statistics'] as Map<String, dynamic>?;
    final analytics = data['analytics'] as Map<String, dynamic>? ?? const {};
    final engagement =
        analytics['publicationEngagement'] as Map<String, dynamic>? ?? const {};
    final metrics = <(String, String, IconData)>[
      (
        'Chiffre d’affaires',
        '${data['revenue'] ?? 0} Ar',
        Icons.payments_outlined
      ),
      ('Commandes', '${data['orders'] ?? 0}', Icons.receipt_long_outlined),
      ('Ventes livrées', '${data['sales'] ?? 0}', Icons.trending_up),
      ('Produits', '${data['products'] ?? 0}', Icons.inventory_2_outlined),
      (
        'Stock faible',
        '${stock?['lowStock'] ?? 0}',
        Icons.warning_amber_outlined
      ),
      ('Clients', '${data['customers'] ?? 0}', Icons.people_outline),
      ('Promotions', '${data['promotions'] ?? 0}', Icons.local_offer_outlined),
      (
        'Statuts',
        '${(statistics?['byStatus'] as List?)?.length ?? 0}',
        Icons.insights
      ),
      (
        'Notifications',
        '${data['notifications'] ?? 0}',
        Icons.notifications_none
      ),
      (
        'Panier moyen',
        '${analytics['averageBasket'] ?? 0} Ar',
        Icons.shopping_basket_outlined
      ),
      ('Visiteurs', '${analytics['visitors'] ?? 0}', Icons.visibility_outlined),
      ('Abonnés', '${analytics['followers'] ?? 0}', Icons.people_alt_outlined),
      (
        'Engagement',
        '${engagement['likes'] ?? 0} j’aime',
        Icons.favorite_border
      ),
      (
        'Revenus livraison',
        '${analytics['deliveryRevenue'] ?? 0} Ar',
        Icons.local_shipping_outlined
      ),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.7,
      crossAxisSpacing: AllGoTokens.space2,
      mainAxisSpacing: AllGoTokens.space2,
      children: metrics
          .map((metric) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(AllGoTokens.space3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Icon(metric.$3),
                      const Spacer(),
                      Text(metric.$1),
                      Text(metric.$2,
                          style: Theme.of(context).textTheme.titleMedium),
                    ],
                  ),
                ),
              ))
          .toList(),
    );
  }
}

/// §31 : les 30 derniers jours calculaient déjà `topProducts` côté serveur
/// (`ShopsService.dashboard`), mais aucun écran ne les affichait — seuls les
/// totaux agrégés apparaissaient dans `_MetricGrid`.
class _TopProductsCard extends StatelessWidget {
  const _TopProductsCard({required this.analytics});

  final Map<String, dynamic> analytics;

  @override
  Widget build(BuildContext context) {
    final topProducts =
        ((analytics['topProducts'] as List<dynamic>?) ?? const <dynamic>[])
            .whereType<Map<String, dynamic>>()
            .toList();
    if (topProducts.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AllGoTokens.space3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('Produits les plus vendus',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AllGoTokens.space2),
            for (final entry in topProducts.take(5))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        (entry['product'] as Map<String, dynamic>?)?['name']
                                ?.toString() ??
                            'Produit supprimé',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text('${entry['quantity'] ?? 0} vendus'),
                    const SizedBox(width: AllGoTokens.space2),
                    Text(
                      '${entry['revenue'] ?? 0} Ar',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

const _weekdays = <int, String>{
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
};

/// Modifie la boutique existante — `PATCH /shop/:id`, jamais `POST /shops`
/// (qui en créerait une seconde). La création d'une première boutique se fait
/// ailleurs, avant que ce tableau de bord ne soit même accessible.
class MerchantShopScreen extends ConsumerStatefulWidget {
  const MerchantShopScreen({required this.shopId, super.key});

  final String? shopId;

  @override
  ConsumerState<MerchantShopScreen> createState() => _MerchantShopScreenState();
}

class _MerchantShopScreenState extends ConsumerState<MerchantShopScreen> {
  final _formKey = GlobalKey<FormState>();
  final name = TextEditingController();
  final description = TextEditingController();
  final city = TextEditingController();
  final address = TextEditingController();
  final phone = TextEditingController();
  final whatsapp = TextEditingController();
  final logo = TextEditingController();
  final banner = TextEditingController();
  final latitude = TextEditingController();
  final longitude = TextEditingController();
  bool delivery = true;
  bool pickup = true;
  bool _loading = true;
  bool _saving = false;
  bool _uploadingLogo = false;

  /// Clé du fichier fraîchement envoyé — `null` tant que le commerçant n'a
  /// pas choisi une nouvelle image ; l'enregistrement renvoie alors `logo`
  /// tel qu'il a été chargé, sans y toucher.
  String? _logoKey;
  Uint8List? _pickedLogoBytes;
  final Map<int, bool> _openDays = {
    for (final day in _weekdays.keys) day: false
  };
  final Map<int, TextEditingController> _openTime = {
    for (final day in _weekdays.keys) day: TextEditingController(text: '08:00'),
  };
  final Map<int, TextEditingController> _closeTime = {
    for (final day in _weekdays.keys) day: TextEditingController(text: '18:00'),
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.shopId == null) {
      setState(() => _loading = false);
      return;
    }
    final response = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/me/shops');
    final shops =
        (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
    final mine = shops.cast<Map<String, dynamic>>().firstWhere(
          (s) => (s['id'] ?? s['_id']).toString() == widget.shopId,
          orElse: () => const <String, dynamic>{},
        );
    final slug = mine['slug'] as String?;
    if (slug == null) {
      setState(() => _loading = false);
      return;
    }
    final detail = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/shops/$slug');
    final shop = detail.data?['data'] as Map<String, dynamic>? ??
        const <String, dynamic>{};
    final contact =
        shop['contact'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final shopAddress =
        shop['address'] as Map<String, dynamic>? ?? const <String, dynamic>{};
    final location = shop['location'] as Map<String, dynamic>?;
    final coordinates = location?['coordinates'] as List<dynamic>?;
    final hours = (shop['openingHours'] as List<dynamic>?) ?? const <dynamic>[];

    name.text = shop['name'] as String? ?? '';
    description.text = shop['description'] as String? ?? '';
    city.text = shopAddress['city'] as String? ?? '';
    address.text = shopAddress['line'] as String? ?? '';
    phone.text = contact['phone'] as String? ?? '';
    whatsapp.text = contact['whatsapp'] as String? ?? '';
    logo.text = shop['logo'] as String? ?? '';
    banner.text = shop['banner'] as String? ?? '';
    if (coordinates != null && coordinates.length == 2) {
      longitude.text = coordinates[0].toString();
      latitude.text = coordinates[1].toString();
    }
    delivery = shop['deliveryAvailable'] as bool? ?? true;
    pickup = shop['pickupAvailable'] as bool? ?? true;
    for (final raw in hours) {
      final slot = raw as Map<String, dynamic>;
      final day = slot['day'] as int?;
      if (day == null || !_weekdays.containsKey(day)) continue;
      _openDays[day] = true;
      _openTime[day]!.text = slot['open'] as String? ?? '08:00';
      _closeTime[day]!.text = slot['close'] as String? ?? '18:00';
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  void dispose() {
    for (final controller in <TextEditingController>[
      name,
      description,
      city,
      address,
      phone,
      whatsapp,
      logo,
      banner,
      latitude,
      longitude,
      ..._openTime.values,
      ..._closeTime.values,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  /// Envoie une nouvelle image de logo — même mécanique que la photo de
  /// profil (`ProfileScreen`) : le fichier part directement vers le stockage
  /// objet, jamais par le serveur applicatif (§ upload-url).
  Future<void> _pickLogo() async {
    final image = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (image == null) return;

    setState(() => _uploadingLogo = true);
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
        _logoKey = data['key'] as String;
        _pickedLogoBytes = bytes;
      });
    } on DioException {
      messenger.showSnackBar(
          const SnackBar(content: Text('Impossible d’envoyer cette image.')));
    } finally {
      if (mounted) setState(() => _uploadingLogo = false);
    }
  }

  Future<void> _save() async {
    if (widget.shopId == null) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(apiClientProvider)
          .patch<void>('/shop/${widget.shopId}', data: <String, dynamic>{
        'name': name.text,
        'description': description.text,
        'city': city.text,
        'address': address.text,
        'phone': phone.text,
        'whatsapp': whatsapp.text,
        if (_logoKey != null) 'logoKey': _logoKey else 'logo': logo.text,
        'banner': banner.text,
        'deliveryAvailable': delivery,
        'pickupAvailable': pickup,
        if (latitude.text.trim().isNotEmpty)
          'latitude': double.tryParse(latitude.text.trim()),
        if (longitude.text.trim().isNotEmpty)
          'longitude': double.tryParse(longitude.text.trim()),
        'openingHours': <Map<String, dynamic>>[
          for (final day in _weekdays.keys)
            if (_openDays[day] == true)
              <String, dynamic>{
                'day': day,
                'open': _openTime[day]!.text.trim(),
                'close': _closeTime[day]!.text.trim(),
              },
        ],
      });
      messenger
          .showSnackBar(const SnackBar(content: Text('Boutique mise à jour.')));
      if (mounted) Navigator.pop(context);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Gestion de boutique')),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : Form(
                key: _formKey,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: ListView(
                  padding: const EdgeInsets.all(AllGoTokens.space4),
                  children: <Widget>[
                    Center(
                      child: GestureDetector(
                        onTap: _uploadingLogo ? null : _pickLogo,
                        child: Stack(
                          alignment: Alignment.bottomRight,
                          children: <Widget>[
                            ClipOval(
                              child: _pickedLogoBytes != null
                                  ? Image.memory(
                                      _pickedLogoBytes!,
                                      width: 96,
                                      height: 96,
                                      fit: BoxFit.cover,
                                    )
                                  : ShopAvatar(
                                      name: name.text.isEmpty ? '?' : name.text,
                                      logoUrl:
                                          logo.text.isEmpty ? null : logo.text,
                                      size: 96,
                                    ),
                            ),
                            CircleAvatar(
                              radius: 16,
                              child: _uploadingLogo
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2),
                                    )
                                  : const Icon(Icons.camera_alt_outlined,
                                      size: 16),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: AllGoTokens.space2),
                    Center(
                      child: Text(
                        'Logo de la boutique',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.outline,
                            ),
                      ),
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    Padding(
                      padding:
                          const EdgeInsets.only(bottom: AllGoTokens.space3),
                      child: TextFormField(
                        controller: name,
                        decoration: const InputDecoration(
                          labelText: 'Nom',
                          prefixIcon: FieldIcon(Icons.storefront_outlined),
                        ),
                        validator: (value) => (value ?? '').trim().isEmpty
                            ? 'Entrez le nom de la boutique.'
                            : null,
                      ),
                    ),
                    for (final field in <(String, TextEditingController)>[
                      ('Description', description),
                      ('Ville', city),
                      ('Adresse', address),
                      ('Téléphone', phone),
                      ('WhatsApp', whatsapp),
                      ('Bannière URL', banner),
                    ])
                      Padding(
                        padding:
                            const EdgeInsets.only(bottom: AllGoTokens.space3),
                        child: TextField(
                            controller: field.$2,
                            decoration: InputDecoration(labelText: field.$1)),
                      ),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: TextFormField(
                            controller: latitude,
                            decoration:
                                const InputDecoration(labelText: 'Latitude'),
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true, signed: true),
                            validator: (value) {
                              final text = (value ?? '').trim();
                              if (text.isEmpty) return null;
                              return double.tryParse(text) == null
                                  ? 'Latitude invalide.'
                                  : null;
                            },
                          ),
                        ),
                        const SizedBox(width: AllGoTokens.space3),
                        Expanded(
                          child: TextFormField(
                            controller: longitude,
                            decoration:
                                const InputDecoration(labelText: 'Longitude'),
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true, signed: true),
                            validator: (value) {
                              final text = (value ?? '').trim();
                              if (text.isEmpty) return null;
                              return double.tryParse(text) == null
                                  ? 'Longitude invalide.'
                                  : null;
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    SwitchListTile(
                        title: const Text('Livraison'),
                        value: delivery,
                        onChanged: (v) => setState(() => delivery = v)),
                    SwitchListTile(
                        title: const Text('Retrait en boutique'),
                        value: pickup,
                        onChanged: (v) => setState(() => pickup = v)),
                    const SizedBox(height: AllGoTokens.space4),
                    Text('Horaires d’ouverture',
                        style: Theme.of(context).textTheme.titleMedium),
                    for (final day in _weekdays.keys)
                      Padding(
                        padding: const EdgeInsets.only(top: AllGoTokens.space2),
                        child: Row(
                          children: <Widget>[
                            SizedBox(
                              width: 96,
                              child: CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                                title: Text(_weekdays[day]!),
                                value: _openDays[day],
                                onChanged: (v) =>
                                    setState(() => _openDays[day] = v ?? false),
                              ),
                            ),
                            if (_openDays[day] == true) ...<Widget>[
                              Expanded(
                                child: TextField(
                                  controller: _openTime[day],
                                  decoration: const InputDecoration(
                                      labelText: 'Ouverture'),
                                ),
                              ),
                              const SizedBox(width: AllGoTokens.space2),
                              Expanded(
                                child: TextField(
                                  controller: _closeTime[day],
                                  decoration: const InputDecoration(
                                      labelText: 'Fermeture'),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    const SizedBox(height: AllGoTokens.space6),
                    FilledButton(
                      onPressed: _saving ? null : _save,
                      child:
                          Text(_saving ? 'Enregistrement...' : 'Enregistrer'),
                    ),
                  ],
                ),
              ),
      );
}
