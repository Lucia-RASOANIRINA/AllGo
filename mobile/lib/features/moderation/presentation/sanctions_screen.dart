import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

class _Sanction {
  const _Sanction({required this.type, required this.reason, required this.createdAt, this.expiresAt});

  final String type;
  final String reason;
  final DateTime createdAt;
  final DateTime? expiresAt;

  factory _Sanction.fromJson(Map<String, dynamic> json) => _Sanction(
        type: json['type'] as String? ?? 'warning',
        reason: json['reason'] as String? ?? '',
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
        expiresAt: json['expiresAt'] == null ? null : DateTime.tryParse(json['expiresAt'] as String),
      );
}

final _mySanctionsProvider = FutureProvider.autoDispose<List<_Sanction>>((ref) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/moderation/sanctions/me');
  final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return items.whereType<Map<String, dynamic>>().map(_Sanction.fromJson).toList();
});

/// Historique des sanctions (§29) — un compte réactivé après une suspension
/// reste consultable ici : c'est tout l'intérêt d'une trace distincte de
/// `User.status`, qui ne porte que l'état courant.
class SanctionsScreen extends ConsumerWidget {
  const SanctionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sanctions = ref.watch(_mySanctionsProvider);
    final dateFormat = DateFormat('d MMMM y', 'fr');

    return Scaffold(
      appBar: AppBar(title: const Text('Mes sanctions')),
      body: AsyncView<List<_Sanction>>(
        value: sanctions,
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucune sanction sur votre compte',
        emptyMessage: 'Votre compte est en règle avec les conditions d’utilisation d’AllGo.',
        onRetry: () => ref.invalidate(_mySanctionsProvider),
        data: (items) => ListView.separated(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(height: AllGoTokens.space3),
          itemBuilder: (context, index) {
            final sanction = items[index];
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Icon(_iconFor(sanction.type), color: Theme.of(context).colorScheme.error),
                        const SizedBox(width: AllGoTokens.space2),
                        Text(_labelFor(sanction.type), style: Theme.of(context).textTheme.titleMedium),
                      ],
                    ),
                    const SizedBox(height: AllGoTokens.space2),
                    Text(sanction.reason),
                    const SizedBox(height: AllGoTokens.space2),
                    Text(
                      sanction.expiresAt == null
                          ? 'Émise le ${dateFormat.format(sanction.createdAt)}'
                          : 'Émise le ${dateFormat.format(sanction.createdAt)} · '
                              'jusqu’au ${dateFormat.format(sanction.expiresAt!)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  IconData _iconFor(String type) => switch (type) {
        'ban' => Icons.block,
        'suspension' => Icons.pause_circle_outline,
        _ => Icons.warning_amber_outlined,
      };

  String _labelFor(String type) => switch (type) {
        'ban' => 'Exclusion définitive',
        'suspension' => 'Suspension temporaire',
        _ => 'Avertissement',
      };
}
