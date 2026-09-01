import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/features/merchant/presentation/merchant_team_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
              ListTile(
                leading: const Icon(Icons.storefront_outlined),
                title: const Text('Gérer ma boutique'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const MerchantShopScreen(),
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
      ('Panier moyen', '${analytics['averageBasket'] ?? 0} Ar',
          Icons.shopping_basket_outlined),
      ('Visiteurs', '${analytics['visitors'] ?? 0}', Icons.visibility_outlined),
      ('Abonnés', '${analytics['followers'] ?? 0}', Icons.people_alt_outlined),
      ('Engagement', '${engagement['likes'] ?? 0} j’aime',
          Icons.favorite_border),
      ('Revenus livraison', '${analytics['deliveryRevenue'] ?? 0} Ar',
          Icons.local_shipping_outlined),
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

class MerchantShopScreen extends ConsumerStatefulWidget {
  const MerchantShopScreen({super.key});
  @override
  ConsumerState<MerchantShopScreen> createState() => _MerchantShopScreenState();
}

class _MerchantShopScreenState extends ConsumerState<MerchantShopScreen> {
  final name = TextEditingController();
  final slug = TextEditingController();
  final description = TextEditingController();
  final city = TextEditingController();
  final address = TextEditingController();
  final phone = TextEditingController();
  final whatsapp = TextEditingController();
  final logo = TextEditingController();
  final banner = TextEditingController();
  bool delivery = true;
  bool pickup = true;

  @override
  void dispose() {
    for (final controller in <TextEditingController>[
      name,
      slug,
      description,
      city,
      address,
      phone,
      whatsapp,
      logo,
      banner,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Gestion de boutique')),
        body: ListView(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          children: <Widget>[
            for (final field in <(String, TextEditingController)>[
              ('Nom', name),
              ('Identifiant', slug),
              ('Description', description),
              ('Ville', city),
              ('Adresse', address),
              ('Téléphone', phone),
              ('WhatsApp', whatsapp),
              ('Logo URL', logo),
              ('Bannière URL', banner),
            ])
              Padding(
                padding: const EdgeInsets.only(bottom: AllGoTokens.space3),
                child: TextField(
                    controller: field.$2,
                    decoration: InputDecoration(labelText: field.$1)),
              ),
            SwitchListTile(
                title: const Text('Livraison'),
                value: delivery,
                onChanged: (v) => setState(() => delivery = v)),
            SwitchListTile(
                title: const Text('Retrait en boutique'),
                value: pickup,
                onChanged: (v) => setState(() => pickup = v)),
            FilledButton(
              onPressed: () async {
                await ref.read(apiClientProvider).post<void>('/shops', data: {
                  'name': name.text,
                  'slug': slug.text,
                  'description': description.text,
                  'city': city.text,
                  'address': address.text,
                  'phone': phone.text,
                  'whatsapp': whatsapp.text,
                  'logo': logo.text,
                  'banner': banner.text,
                  'deliveryAvailable': delivery,
                  'pickupAvailable': pickup,
                });
                if (mounted) Navigator.pop(context);
              },
              child: const Text('Créer la boutique'),
            ),
          ],
        ),
      );
}
