import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final merchantTeamProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final shops = await api.get<Map<String, dynamic>>('/me/shops');
  final list = shops.data?['data'];
  if (list is! List || list.isEmpty)
    throw StateError('Aucune boutique associée.');
  final shop = list.first as Map<String, dynamic>;
  final response = await api
      .get<Map<String, dynamic>>('/shop/${shop['id'] ?? shop['_id']}/team');
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

String _roleLabel(String? role) =>
    const <String, String>{
      'shop_owner': 'Propriétaire',
      'shop_manager': 'Manager — commandes et produits',
      'shop_sales': 'Préparateur — commandes',
      'shop_cashier': 'Caissier — paiements',
      'shop_stock': 'Gestionnaire stock — inventaire',
      'shop_marketing': 'Community manager — publications',
    }[role] ??
    'Employé';

class MerchantTeamScreen extends ConsumerWidget {
  const MerchantTeamScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final team = ref.watch(merchantTeamProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Gestion de l’équipe')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _add(context, ref),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Ajouter'),
      ),
      body: AsyncView<List<Map<String, dynamic>>>(
        value: team,
        onRetry: () => ref.invalidate(merchantTeamProvider),
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucun employé pour l’instant',
        emptyMessage:
            'Ajoutez un membre de votre équipe avec le bouton « Ajouter ».',
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(merchantTeamProvider),
          child: ListView.separated(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: items.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AllGoTokens.space2),
            itemBuilder: (context, index) {
              final member = items[index];
              return Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AllGoTokens.brand.withValues(alpha: 0.12),
                    child: const Icon(Icons.person_outline,
                        color: AllGoTokens.brand),
                  ),
                  title: Text(member['name']?.toString() ?? 'Employé'),
                  subtitle: Text(_roleLabel(member['role']?.toString())),
                  trailing: member['role'] == 'shop_owner'
                      ? null
                      : PopupMenuButton<String>(
                          onSelected: (action) =>
                              _memberAction(ref, member, action),
                          itemBuilder: (_) => const [
                            PopupMenuItem(
                                value: 'manager', child: Text('Manager')),
                            PopupMenuItem(
                                value: 'cashier', child: Text('Caissier')),
                            PopupMenuItem(
                                value: 'stock',
                                child: Text('Gestionnaire stock')),
                            PopupMenuItem(
                                value: 'marketing',
                                child: Text('Community manager')),
                            PopupMenuItem(
                                value: 'remove', child: Text('Retirer')),
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

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _TeamMemberFormSheet(),
    );
  }

  Future<void> _memberAction(
      WidgetRef ref, Map<String, dynamic> member, String action) async {
    final api = ref.read(apiClientProvider);
    final shops = await api.get<Map<String, dynamic>>('/me/shops');
    final list = shops.data?['data'];
    if (list is! List || list.isEmpty) return;
    final shop = list.first as Map<String, dynamic>;
    final shopId = (shop['id'] ?? shop['_id']).toString();
    final rawUserId = member['userId'];
    final userId = rawUserId is Map
        ? (rawUserId['_id'] ?? rawUserId['id']).toString()
        : rawUserId.toString();

    if (action == 'remove') {
      await api.delete<void>('/shop/$shopId/team/$userId');
    } else {
      final role = const <String, String>{
        'manager': 'shop_manager',
        'cashier': 'shop_cashier',
        'stock': 'shop_stock',
        'marketing': 'shop_marketing',
      }[action]!;
      await api.patch<void>('/shop/$shopId/team/$userId',
          data: <String, dynamic>{'role': role});
    }
    ref.invalidate(merchantTeamProvider);
  }
}

class _TeamMemberFormSheet extends ConsumerStatefulWidget {
  const _TeamMemberFormSheet();

  @override
  ConsumerState<_TeamMemberFormSheet> createState() =>
      _TeamMemberFormSheetState();
}

class _TeamMemberFormSheetState extends ConsumerState<_TeamMemberFormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _phone = TextEditingController();
  String _role = 'shop_manager';
  bool _saving = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final api = ref.read(apiClientProvider);
      final shops = await api.get<Map<String, dynamic>>('/me/shops');
      final list = shops.data?['data'];
      if (list is! List || list.isEmpty)
        throw StateError('Aucune boutique associée.');
      final shop = list.first as Map<String, dynamic>;

      await api.post<void>(
        '/shop/${shop['id'] ?? shop['_id']}/team',
        data: <String, dynamic>{'phone': _phone.text.trim(), 'role': _role},
      );
      ref.invalidate(merchantTeamProvider);
      if (mounted) Navigator.pop(context);
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
      messenger.showSnackBar(
          SnackBar(content: Text(message ?? 'Ajout impossible.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
          16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text('Ajouter un employé',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: AllGoTokens.space4),
              PhoneField(controller: _phone, label: 'Téléphone de l’employé'),
              const SizedBox(height: AllGoTokens.space3),
              DropdownButtonFormField<String>(
                initialValue: _role,
                decoration: const InputDecoration(
                  labelText: 'Rôle',
                  prefixIcon: FieldIcon(Icons.badge_outlined),
                ),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem(
                      value: 'shop_manager', child: Text('Manager')),
                  DropdownMenuItem(
                      value: 'shop_sales', child: Text('Préparateur')),
                  DropdownMenuItem(
                      value: 'shop_cashier', child: Text('Caissier')),
                  DropdownMenuItem(
                      value: 'shop_stock', child: Text('Gestionnaire stock')),
                  DropdownMenuItem(
                      value: 'shop_marketing',
                      child: Text('Community manager')),
                ],
                onChanged: (value) =>
                    setState(() => _role = value ?? 'shop_manager'),
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
                    : const Text('Ajouter'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
