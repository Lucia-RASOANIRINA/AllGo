import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const _sections = <String, String>{
  'users': 'Utilisateurs',
  'shops': 'Boutiques',
  'products': 'Produits',
  'orders': 'Commandes',
  'disputes': 'Litiges',
  'reports': 'Signalements',
  'blacklist': 'Liste noire',
  'banned-words': 'Mots interdits',
};

final adminSectionRowsProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>((ref, section) async {
  final path = switch (section) {
    'disputes' => '/admin/disputes',
    'reports' => '/moderation/reports?status=pending',
    'blacklist' => '/moderation/blacklist',
    'banned-words' => '/moderation/banned-words',
    _ => '/admin/$section',
  };
  final response = await ref.watch(apiClientProvider).get<dynamic>(path);
  final data = response.data;
  return data is Map && data['data'] is List
      ? data['data'] as List
      : data is List
          ? data
          : const <dynamic>[];
});

/// Espace admin — modération réelle, pas une simple liste. Chaque section
/// expose les actions déjà prêtes côté API (`AdministrationController`) :
/// avant cet écran, aucun bouton ne les déclenchait.
class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  ConsumerState<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen> {
  String section = 'users';

  void _load() => ref.invalidate(adminSectionRowsProvider(section));

  String _title(dynamic item) {
    if (section == 'users' || section == 'blacklist') {
      return '${item['firstName'] ?? ''} ${item['lastName'] ?? ''}'.trim();
    }
    if (section == 'disputes')
      return 'Litige — commande ${item['orderId'] ?? ''}';
    if (section == 'reports')
      return _reportTargetLabel(item['targetType'] as String?);
    if (section == 'banned-words') return item['word']?.toString() ?? '';
    return item['name']?.toString() ??
        item['orderNumber']?.toString() ??
        'Élément';
  }

  String _subtitle(dynamic item) {
    if (section == 'reports')
      return '${item['reasonCode'] ?? ''} — ${item['reason'] ?? ''}';
    if (section == 'banned-words')
      return 'Filtré automatiquement de toute publication ou commentaire';
    return '${item['status'] ?? ''} ${item['phone'] ?? item['reason'] ?? ''}';
  }

  String _reportTargetLabel(String? targetType) => switch (targetType) {
        'post' => 'Publication signalée',
        'comment' => 'Commentaire signalé',
        'user' => 'Compte signalé',
        'shop' => 'Boutique signalée',
        'product' => 'Produit signalé',
        _ => 'Signalement',
      };

  Future<void> _act(
      Future<void> Function() action, String successMessage) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await action();
      messenger.showSnackBar(SnackBar(content: Text(successMessage)));
      _load();
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
      messenger.showSnackBar(
          SnackBar(content: Text(message ?? 'Action impossible.')));
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
                () => api.patch<void>('/admin/users/${item['id']}',
                    data: <String, String>{'status': 'suspended'}),
                'Utilisateur suspendu.',
              ),
            ),
          if (status != 'active')
            PopupMenuItem<String>(
              value: 'activate',
              child: const Text('Réactiver'),
              onTap: () => _act(
                () => api.patch<void>('/admin/users/${item['id']}',
                    data: <String, String>{'status': 'active'}),
                'Utilisateur réactivé.',
              ),
            ),
          PopupMenuItem<String>(
            value: 'sanctions',
            child: const Text('Voir les sanctions'),
            onTap: () => _showSanctions(item['id'].toString()),
          ),
        ];
      case 'blacklist':
        return <PopupMenuEntry<String>>[
          PopupMenuItem<String>(
            value: 'activate',
            child: const Text('Réactiver le compte'),
            onTap: () => _act(
              () => api.patch<void>('/admin/users/${item['id']}',
                  data: <String, String>{'status': 'active'}),
              'Compte réactivé.',
            ),
          ),
          PopupMenuItem<String>(
            value: 'sanctions',
            child: const Text('Voir les sanctions'),
            onTap: () => _showSanctions(item['id'].toString()),
          ),
        ];
      case 'reports':
        final targetType = item['targetType'] as String?;
        return <PopupMenuEntry<String>>[
          PopupMenuItem<String>(
            value: 'dismiss',
            child: const Text('Classer sans suite'),
            onTap: () => _act(
              () => api.patch<void>('/moderation/reports/${item['id']}',
                  data: <String, String>{'status': 'dismissed'}),
              'Signalement classé sans suite.',
            ),
          ),
          PopupMenuItem<String>(
            value: 'remove',
            child: const Text('Agir sur le contenu'),
            onTap: () => _act(
              () => api.patch<void>(
                '/moderation/reports/${item['id']}',
                data: <String, String>{
                  'status': 'actioned',
                  'action': 'content_removed'
                },
              ),
              'Contenu traité.',
            ),
          ),
          if (targetType == 'user') ...<PopupMenuEntry<String>>[
            PopupMenuItem<String>(
              value: 'warn',
              child: const Text('Avertir le compte'),
              onTap: () => _resolveWithSanction(item, 'warning'),
            ),
            PopupMenuItem<String>(
              value: 'suspend7',
              child: const Text('Suspendre 7 jours'),
              onTap: () =>
                  _resolveWithSanction(item, 'suspension', suspensionDays: 7),
            ),
            PopupMenuItem<String>(
              value: 'ban',
              child: const Text('Bannir définitivement'),
              onTap: () => _resolveWithSanction(item, 'ban'),
            ),
          ],
        ];
      case 'banned-words':
        return <PopupMenuEntry<String>>[
          PopupMenuItem<String>(
            value: 'delete',
            child: const Text('Retirer de la liste'),
            onTap: () => _act(
              () => api.delete<void>('/moderation/banned-words/${item['id']}'),
              'Mot retiré de la liste.',
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
                  () => api.patch<void>('/admin/shops/${item['id']}/status',
                      data: <String, String>{'status': target}),
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
                () => api.patch<void>(
                    '/admin/products/${item['id']}/moderation',
                    data: <String, dynamic>{
                      'status': 'published',
                      'isHidden': false
                    }),
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
                () => api.patch<void>('/admin/disputes/${item['id']}',
                    data: <String, String>{'status': 'resolved'}),
                'Litige résolu.',
              ),
            ),
            PopupMenuItem<String>(
              value: 'reject',
              child: const Text('Rejeter'),
              onTap: () => _act(
                () => api.patch<void>('/admin/disputes/${item['id']}',
                    data: <String, String>{'status': 'rejected'}),
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

  /// Résout un signalement de compte en une sanction (§29) — `targetId` du
  /// signalement EST le compte visé, donc `sanctionUserId` en découle
  /// directement sans autre saisie.
  Future<void> _resolveWithSanction(dynamic report, String action,
          {int? suspensionDays}) =>
      _act(
        () => ref.read(apiClientProvider).patch<void>(
          '/moderation/reports/${report['id']}',
          data: <String, dynamic>{
            'status': 'actioned',
            'action': action,
            'sanctionUserId': report['targetId'],
            if (suspensionDays != null) 'suspensionDays': suspensionDays,
          },
        ),
        'Sanction appliquée.',
      );

  Future<void> _showSanctions(String userId) async {
    final response =
        await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/moderation/sanctions',
      queryParameters: <String, String>{'userId': userId},
    );
    final items =
        (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
    if (!mounted) return;
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Historique des sanctions'),
        content: SizedBox(
          width: double.maxFinite,
          child: items.isEmpty
              ? const Text('Aucune sanction enregistrée pour ce compte.')
              : ListView.builder(
                  shrinkWrap: true,
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final sanction = items[index] as Map;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('${sanction['type']}'),
                      subtitle: Text('${sanction['reason']}'),
                    );
                  },
                ),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Fermer')),
        ],
      ),
    );
  }

  Future<void> _addBannedWord() async {
    final controller = TextEditingController();
    final word = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Ajouter un mot interdit'),
        content: TextField(controller: controller, autofocus: true),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Annuler')),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Ajouter'),
          ),
        ],
      ),
    );
    if (word == null || word.isEmpty) return;
    await _act(
      () => ref.read(apiClientProvider).post<void>('/moderation/banned-words',
          data: <String, String>{'word': word}),
      'Mot ajouté à la liste.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = ref.watch(adminSectionRowsProvider(section));

    return Scaffold(
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
                        onSelected: (_) => setState(() => section = entry.key),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
          Expanded(
            child: AsyncView<List<dynamic>>(
              value: rows,
              onRetry: _load,
              isEmpty: (items) => items.isEmpty,
              emptyTitle: 'Rien à traiter dans cette section',
              data: (items) => RefreshIndicator(
                onRefresh: () async => _load(),
                child: ListView.builder(
                  itemCount: items.length,
                  itemBuilder: (_, index) {
                    final item = items[index] as Map;
                    final actions = _actionsFor(item);
                    return ListTile(
                      title: Text(_title(item)),
                      subtitle: Text(_subtitle(item)),
                      trailing: actions.isEmpty
                          ? null
                          : PopupMenuButton<String>(
                              itemBuilder: (context) => actions),
                    );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: section == 'banned-words'
          ? FloatingActionButton(
              onPressed: _addBannedWord,
              child: const Icon(Icons.add),
            )
          : null,
    );
  }
}
