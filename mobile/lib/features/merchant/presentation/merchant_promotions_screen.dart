import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/field_icon.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

final merchantPromotionsProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final shops = await api.get<Map<String, dynamic>>('/me/shops');
  final list = shops.data?['data'];
  if (list is! List || list.isEmpty)
    throw StateError('Aucune boutique associée.');
  final shop = list.first as Map<String, dynamic>;
  final id = (shop['id'] ?? shop['_id']).toString();
  final response = await api.get<Map<String, dynamic>>('/shop/$id/promotions');
  final data = response.data?['data'];
  return data is List
      ? data.whereType<Map<String, dynamic>>().toList()
      : <Map<String, dynamic>>[];
});

class MerchantPromotionsScreen extends ConsumerWidget {
  const MerchantPromotionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final promotions = ref.watch(merchantPromotionsProvider);
    final dateFormat = DateFormat.yMMMd('fr');

    return Scaffold(
      appBar: AppBar(title: const Text('Promotions')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _create(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Créer'),
      ),
      body: AsyncView<List<Map<String, dynamic>>>(
        value: promotions,
        onRetry: () => ref.invalidate(merchantPromotionsProvider),
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucune promotion en cours',
        emptyMessage:
            'Créez-en une avec le bouton « Créer » pour attirer des clients.',
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(merchantPromotionsProvider),
          child: ListView.separated(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            itemCount: items.length,
            separatorBuilder: (_, __) =>
                const SizedBox(height: AllGoTokens.space2),
            itemBuilder: (context, index) {
              final promo = items[index];
              final type = promo['type']?.toString();
              final value = promo['value'];
              final label = switch (type) {
                'percent' => '-$value %',
                'fixed' => '-$value Ar',
                'price' => '$value Ar',
                _ => '$value',
              };
              final endsAt =
                  DateTime.tryParse(promo['endsAt']?.toString() ?? '');
              return Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AllGoTokens.brand.withValues(alpha: 0.12),
                    child: Icon(
                      promo['flash'] == true
                          ? Icons.flash_on
                          : Icons.local_offer_outlined,
                      color: AllGoTokens.brand,
                    ),
                  ),
                  title: Text(promo['name']?.toString() ?? 'Promotion'),
                  subtitle: Text(
                    <String>[
                      label,
                      if (promo['couponCode'] != null)
                        'Code : ${promo['couponCode']}',
                      if (endsAt != null)
                        'Jusqu’au ${dateFormat.format(endsAt)}',
                    ].join(' • '),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _PromotionFormSheet(),
    );
  }
}

class _PromotionFormSheet extends ConsumerStatefulWidget {
  const _PromotionFormSheet();

  @override
  ConsumerState<_PromotionFormSheet> createState() =>
      _PromotionFormSheetState();
}

class _PromotionFormSheetState extends ConsumerState<_PromotionFormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _value = TextEditingController();
  final _coupon = TextEditingController();
  String _type = 'percent';
  DateTime _startsAt = DateTime.now();
  DateTime _endsAt = DateTime.now().add(const Duration(days: 30));
  bool _flash = false;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _value.dispose();
    _coupon.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isStart ? _startsAt : _endsAt,
      firstDate: isStart
          ? DateTime.now().subtract(const Duration(days: 1))
          : _startsAt,
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startsAt = picked;
        if (_endsAt.isBefore(_startsAt))
          _endsAt = _startsAt.add(const Duration(days: 30));
      } else {
        _endsAt = picked;
      }
    });
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
      final shopId = (shop['id'] ?? shop['_id']).toString();

      await api.post<void>(
        '/shop/$shopId/promotions',
        data: <String, dynamic>{
          'name': _name.text.trim(),
          'type': _type,
          'value': double.parse(_value.text.trim()),
          'startsAt': _startsAt.toIso8601String(),
          'endsAt': _endsAt.toIso8601String(),
          'flash': _flash,
          if (_coupon.text.trim().isNotEmpty) 'couponCode': _coupon.text.trim(),
        },
      );
      ref.invalidate(merchantPromotionsProvider);
      if (mounted) Navigator.pop(context);
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
      messenger.showSnackBar(
          SnackBar(content: Text(message ?? 'Création impossible.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat.yMMMd('fr');

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
              Text('Nouvelle promotion',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: AllGoTokens.space4),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Nom',
                  prefixIcon: FieldIcon(Icons.local_offer_outlined),
                ),
                validator: (value) => (value ?? '').trim().isEmpty
                    ? 'Entrez un nom de promotion.'
                    : null,
              ),
              const SizedBox(height: AllGoTokens.space3),
              DropdownButtonFormField<String>(
                initialValue: _type,
                decoration: const InputDecoration(
                  labelText: 'Type',
                  prefixIcon: FieldIcon(Icons.percent_outlined),
                ),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem(
                      value: 'percent', child: Text('Réduction en %')),
                  DropdownMenuItem(
                      value: 'fixed', child: Text('Réduction fixe (Ar)')),
                  DropdownMenuItem(
                      value: 'price', child: Text('Prix promotionnel (Ar)')),
                ],
                onChanged: (value) =>
                    setState(() => _type = value ?? 'percent'),
              ),
              const SizedBox(height: AllGoTokens.space3),
              TextFormField(
                controller: _value,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: _type == 'percent' ? 'Valeur (%)' : 'Valeur (Ar)',
                  prefixIcon: const FieldIcon(Icons.numbers_outlined),
                ),
                validator: (value) {
                  final parsed = double.tryParse((value ?? '').trim());
                  if (parsed == null) return 'Valeur invalide.';
                  if (parsed <= 0) return 'Doit être supérieure à 0.';
                  if (_type == 'percent' && parsed > 100)
                    return 'Ne peut pas dépasser 100 %.';
                  return null;
                },
              ),
              const SizedBox(height: AllGoTokens.space3),
              TextFormField(
                controller: _coupon,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(
                  labelText: 'Code coupon (optionnel)',
                  prefixIcon: FieldIcon(Icons.confirmation_number_outlined),
                ),
              ),
              const SizedBox(height: AllGoTokens.space3),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pickDate(isStart: true),
                      icon: const Icon(Icons.event_outlined),
                      label: Text('Début : ${dateFormat.format(_startsAt)}'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AllGoTokens.space2),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pickDate(isStart: false),
                      icon: const Icon(Icons.event_busy_outlined),
                      label: Text('Fin : ${dateFormat.format(_endsAt)}'),
                    ),
                  ),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Promotion flash'),
                value: _flash,
                onChanged: (value) => setState(() => _flash = value),
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
                    : const Text('Créer'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
