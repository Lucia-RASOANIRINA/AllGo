import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final _adminDashboardProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/admin/dashboard');
  return (response.data?['data'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
});

/// Dashboard global admin — §31. Une vue d'ensemble de la plateforme entière,
/// même esprit que le tableau de bord d'une boutique (`ShopsService.dashboard`)
/// mais à l'échelle d'AllGo : comptes, boutiques, produits, commandes,
/// livraisons, chiffre d'affaires, paiements, avis, publications, croissance,
/// produits populaires, zones actives, performance des livreurs.
class AdminStatsScreen extends ConsumerWidget {
  const AdminStatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(_adminDashboardProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Dashboard global AllGo')),
      body: AsyncView<Map<String, dynamic>>(
        value: dashboard,
        isEmpty: (data) => data.isEmpty,
        emptyTitle: 'Aucune donnée',
        onRetry: () => ref.invalidate(_adminDashboardProvider),
        data: (data) {
          final counts = data['counts'] as Map<String, dynamic>? ?? const <String, dynamic>{};
          final growth = data['growth'] as Map<String, dynamic>? ?? const <String, dynamic>{};
          final topProducts = (data['topProducts'] as List<dynamic>?) ?? const <dynamic>[];
          final topZones = (data['topZones'] as List<dynamic>?) ?? const <dynamic>[];
          final courierPerformance = (data['courierPerformance'] as List<dynamic>?) ?? const <dynamic>[];
          final userGrowth = (growth['users'] as List<dynamic>?) ?? const <dynamic>[];
          final shopGrowth = (growth['shops'] as List<dynamic>?) ?? const <dynamic>[];

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(_adminDashboardProvider),
            child: ListView(
              padding: const EdgeInsets.all(AllGoTokens.space4),
              children: <Widget>[
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  childAspectRatio: 1.8,
                  crossAxisSpacing: AllGoTokens.space2,
                  mainAxisSpacing: AllGoTokens.space2,
                  children: <Widget>[
                    _StatTile(icon: Icons.people_outline, label: 'Utilisateurs', value: '${counts['users'] ?? 0}'),
                    _StatTile(icon: Icons.storefront_outlined, label: 'Boutiques', value: '${counts['shops'] ?? 0}'),
                    _StatTile(icon: Icons.inventory_2_outlined, label: 'Produits', value: '${counts['products'] ?? 0}'),
                    _StatTile(icon: Icons.receipt_long_outlined, label: 'Commandes', value: '${counts['orders'] ?? 0}'),
                    _StatTile(icon: Icons.local_shipping_outlined, label: 'Livraisons', value: '${courierPerformance.length} livreurs actifs'),
                    _StatTile(icon: Icons.payments_outlined, label: 'CA', value: '${data['revenue'] ?? 0} Ar'),
                    _StatTile(icon: Icons.credit_card_outlined, label: 'Paiements', value: '${(data['paymentBreakdown'] as List?)?.length ?? 0} combinaisons'),
                    _StatTile(icon: Icons.star_border, label: 'Avis', value: '${counts['reviews'] ?? 0}'),
                    _StatTile(icon: Icons.dynamic_feed_outlined, label: 'Publications', value: '${counts['posts'] ?? 0}'),
                  ],
                ),
                const SizedBox(height: AllGoTokens.space6),
                _SectionHeader('Croissance — ${growth['periodDays'] ?? 30} derniers jours'),
                _GrowthRow(label: 'Nouveaux utilisateurs', points: userGrowth),
                _GrowthRow(label: 'Nouvelles boutiques', points: shopGrowth),

                const SizedBox(height: AllGoTokens.space6),
                _SectionHeader('Produits populaires'),
                if (topProducts.isEmpty) const Text('Aucune vente livrée pour le moment.'),
                for (final raw in topProducts.take(5))
                  Builder(builder: (context) {
                    final product = raw as Map<String, dynamic>;
                    final id = product['id'] as Map<String, dynamic>? ?? const <String, dynamic>{};
                    return ListTile(
                      leading: const Icon(Icons.trending_up),
                      title: Text(id['name'] as String? ?? 'Produit'),
                      subtitle: Text('${product['quantity']} vendus · ${product['revenue']} Ar'),
                    );
                  }),

                const SizedBox(height: AllGoTokens.space6),
                _SectionHeader('Zones les plus actives'),
                if (topZones.isEmpty) const Text('Aucune commande livrée avec une ville renseignée.'),
                for (final raw in topZones.take(5))
                  Builder(builder: (context) {
                    final zone = raw as Map<String, dynamic>;
                    return ListTile(
                      leading: const Icon(Icons.location_city_outlined),
                      title: Text(zone['id'] as String? ?? 'Zone inconnue'),
                      subtitle: Text('${zone['orders']} commandes'),
                    );
                  }),

                const SizedBox(height: AllGoTokens.space6),
                _SectionHeader('Performance des livreurs'),
                if (courierPerformance.isEmpty) const Text('Aucune livraison effectuée pour le moment.'),
                for (final raw in courierPerformance.take(5))
                  Builder(builder: (context) {
                    final courier = raw as Map<String, dynamic>;
                    final person = courier['courier'] as Map<String, dynamic>?;
                    final name = person == null
                        ? 'Livreur ${(courier['id'] as String? ?? '').toString().substring(0, 6)}'
                        : '${person['firstName'] ?? ''} ${person['lastName'] ?? ''}'.trim();
                    return ListTile(
                      leading: const Icon(Icons.two_wheeler_outlined),
                      title: Text(name.isEmpty ? 'Livreur' : name),
                      subtitle: Text(
                        '${courier['deliveries']} livraisons · ${courier['shippingRevenue']} Ar frais · ${courier['tips']} Ar pourboires',
                      ),
                    );
                  }),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(AllGoTokens.space3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(icon),
              const Spacer(),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
              Text(value, style: Theme.of(context).textTheme.titleMedium, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: AllGoTokens.space2),
        child: Text(title, style: Theme.of(context).textTheme.titleMedium),
      );
}

/// Représentation minimale d'une série journalière — une liste de jauges
/// plutôt qu'un graphique complet : chaque point reste lisible individuellement
/// (date + valeur), ce qu'un graphique compresserait sur un si petit écran.
class _GrowthRow extends StatelessWidget {
  const _GrowthRow({required this.label, required this.points});
  final String label;
  final List<dynamic> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AllGoTokens.space3),
        child: Text('$label : aucune donnée sur la période.'),
      );
    }
    final maxCount = points
        .map((p) => ((p as Map<String, dynamic>)['count'] as num?)?.toInt() ?? 0)
        .fold<int>(1, (a, b) => a > b ? a : b);

    return Padding(
      padding: const EdgeInsets.only(bottom: AllGoTokens.space4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AllGoTokens.space2),
          SizedBox(
            height: 60,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: points.length,
              separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space2),
              itemBuilder: (context, index) {
                final point = points[index] as Map<String, dynamic>;
                final count = (point['count'] as num?)?.toInt() ?? 0;
                final day = (point['id'] as String? ?? '').split('-').last;
                return Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: <Widget>[
                    Container(
                      width: 18,
                      height: 32 * (count / maxCount).clamp(0.1, 1.0),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primary,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(day, style: Theme.of(context).textTheme.labelSmall),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
