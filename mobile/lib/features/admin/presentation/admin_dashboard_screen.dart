import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const _sections = <String, String>{
  'users': 'Utilisateurs',
  'shops': 'Boutiques',
  'products': 'Produits',
  'orders': 'Commandes',
  'disputes': 'Litiges',
};

/// Espace admin — modération réelle, pas une simple liste. Chaque section
/// expose les actions déjà prêtes côté API (`AdministrationController`) :
/// avant cet écran, aucun bouton ne les déclenchait.
class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  ConsumerState<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen> {
  String section = 'users';
  List<dynamic> rows = const [];
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    final path = section == 'disputes' ? '/admin/disputes' : '/admin/$section';
    final response = await ref.read(apiClientProvider).get<dynamic>(path);
    if (!mounted) return;
    final data = response.data;
    setState(() {
      rows = data is Map && data['data'] is List
          ? data['data'] as List
          : data is List
              ? data
              : const [];
      loading = false;
    });
  }

  String _title(dynamic item) {
    if (section == 'users') return '${item['firstName'] ?? ''} ${item['lastName'] ?? ''}'.trim();
    if (section == 'disputes') return 'Litige — commande ${item['orderId'] ?? ''}';
    return item['name']?.toString() ?? item['orderNumber']?.toString() ?? 'Élément';
  }

  Future<void> _act(Future<void> Function() action, String successMessage) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      messenger.showSnackBar(SnackBar(content: Text(successMessage)));
      await _load();
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
      messenger.showSnackBar(SnackBar(content: Text(message ?? 'Action impossible.')));
    }
  }

  List<PopupMenuEntry<String>> _actionsFor(dynamic item) {
    final api = ref.read(apiClientProvider);
    switch (section) {
      case 'users':
        final status = item['status'] as String?;
        return <PopupMenuEntry<String>>[
          if (status != 'suspended')
            PopupMenuItem<String>(
              value: 'suspend',
              child: const Text('Suspendre'),
              onTap: () => _act(
                () => api.patch<void>('/admin/users/${item['id']}', data: <String, String>{'status': 'suspended'}),
                'Utilisateur suspendu.',
              ),
            ),
          if (status != 'active')
            PopupMenuItem<String>(
              value: 'activate',
              child: const Text('Réactiver'),
              onTap: () => _act(
                () => api.patch<void>('/admin/users/${item['id']}', data: <String, String>{'status': 'active'}),
                'Utilisateur réactivé.',
              ),
            ),
        ];
      case 'shops':
        return <PopupMenuEntry<String>>[
          for (final target in <String>['approved', 'rejected', 'suspended'])
            if (item['status'] != target)
              PopupMenuItem<String>(
                value: target,
                child: Text(_shopStatusLabel(target)),
                onTap: () => _act(
                  () => api.patch<void>('/admin/shops/${item['id']}/status', data: <String, String>{'status': target}),
                  'Boutique mise à jour.',
                ),
              ),
        ];
      case 'products':
        return <PopupMenuEntry<String>>[
          if (item['status'] != 'published')
            PopupMenuItem<String>(
              value: 'publish',
              child: const Text('Publier'),
              onTap: () => _act(
                () => api.patch<void>('/admin/products/${item['id']}/moderation', data: <String, dynamic>{'status': 'published', 'isHidden': false}),
                'Produit publié.',
              ),
            ),
          PopupMenuItem<String>(
            value: 'archive',
            child: const Text('Archiver et masquer'),
            onTap: () => _act(
              () => api.patch<void>('/admin/products/${item['id']}/delete'),
              'Produit archivé.',
            ),
          ),
        ];
      case 'orders':
        return <PopupMenuEntry<String>>[
          PopupMenuItem<String>(
            value: 'refund',
            child: const Text('Rembourser'),
            onTap: () => _act(
              () => api.patch<void>('/admin/orders/${item['id']}/refund'),
              'Commande remboursée.',
            ),
          ),
        ];
      case 'disputes':
        return <PopupMenuEntry<String>>[
          if (item['status'] == 'open') ...<PopupMenuEntry<String>>[
            PopupMenuItem<String>(
              value: 'resolve',
              child: const Text('Marquer résolu'),
              onTap: () => _act(
                () => api.patch<void>('/admin/disputes/${item['id']}', data: <String, String>{'status': 'resolved'}),
                'Litige résolu.',
              ),
            ),
            PopupMenuItem<String>(
              value: 'reject',
              child: const Text('Rejeter'),
              onTap: () => _act(
                () => api.patch<void>('/admin/disputes/${item['id']}', data: <String, String>{'status': 'rejected'}),
                'Litige rejeté.',
              ),
            ),
          ],
        ];
      default:
        return const <PopupMenuEntry<String>>[];
    }
  }

  String _shopStatusLabel(String value) => switch (value) {
        'approved' => 'Valider',
        'rejected' => 'Refuser',
        'suspended' => 'Suspendre',
        _ => value,
      };

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Administration AllGo')),
        body: Column(
          children: <Widget>[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.all(AllGoTokens.space2),
              child: Row(
                children: _sections.entries
                    .map(
                      (entry) => Padding(
                        padding: const EdgeInsets.only(right: AllGoTokens.space2),
                        child: ChoiceChip(
                          label: Text(entry.value),
                          selected: section == entry.key,
                          onSelected: (_) {
                            setState(() => section = entry.key);
                            _load();
                          },
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
            Expanded(
              child: loading
                  ? const Center(child: CircularProgressIndicator())
                  : rows.isEmpty
                      ? const Center(child: Text('Rien à traiter dans cette section.'))
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.builder(
                            itemCount: rows.length,
                            itemBuilder: (_, index) {
                              final item = rows[index] as Map;
                              final actions = _actionsFor(item);
                              return ListTile(
                                title: Text(_title(item)),
                                subtitle: Text('${item['status'] ?? ''} ${item['phone'] ?? item['reason'] ?? ''}'),
                                trailing: actions.isEmpty
                                    ? null
                                    : PopupMenuButton<String>(itemBuilder: (context) => actions),
                              );
                            },
                          ),
                        ),
            ),
          ],
        ),
      );
}
