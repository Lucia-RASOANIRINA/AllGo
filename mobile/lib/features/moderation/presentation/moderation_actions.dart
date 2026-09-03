import 'package:allgo/core/network/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Motifs proposés — mêmes codes que `REPORT_REASON_CODES` côté API
/// (`backend/src/modules/moderation/schemas/report.schema.ts`). Le texte
/// libre reste possible : ces motifs qualifient le signalement, ils ne le
/// remplacent pas.
const Map<String, String> reportReasonLabels = <String, String>{
  'spam': 'Spam ou publicité non sollicitée',
  'abuse': 'Propos injurieux ou harcèlement',
  'nudity': 'Contenu inapproprié',
  'scam': 'Arnaque ou tentative de fraude',
  'counterfeit': 'Contrefaçon',
  'other': 'Autre motif',
};

/// Boîte de dialogue partagée par tous les signalements (publication,
/// commentaire, utilisateur, boutique, produit) — un seul motif qualifié et
/// un texte libre optionnel, jamais un formulaire par type de cible.
Future<({String reasonCode, String? reason})?> showReportDialog(
  BuildContext context, {
  required String title,
}) {
  String selected = 'other';
  final controller = TextEditingController();

  return showDialog<({String reasonCode, String? reason})>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setState) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            for (final entry in reportReasonLabels.entries)
              RadioListTile<String>(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text(entry.value),
                value: entry.key,
                groupValue: selected,
                onChanged: (value) => setState(() => selected = value!),
              ),
            TextField(
              controller: controller,
              maxLength: 500,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Détails (facultatif)',
              ),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(
              dialogContext,
              (reasonCode: selected, reason: controller.text.trim().isEmpty ? null : controller.text.trim()),
            ),
            child: const Text('Signaler'),
          ),
        ],
      ),
    ),
  );
}

/// Envoie un signalement vers `path` (ex. `/social/posts/$id/report`,
/// `/moderation/users/$id/report`…) — tous les points d'entrée de
/// signalement acceptent le même corps `{reason, reasonCode}` (§29).
Future<void> reportViaDialog(
  BuildContext context,
  WidgetRef ref, {
  required String path,
  required String dialogTitle,
  String successMessage = 'Signalement envoyé à la modération.',
}) async {
  final choice = await showReportDialog(context, title: dialogTitle);
  if (choice == null || !context.mounted) return;

  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(apiClientProvider).post<void>(
      path,
      data: <String, String?>{'reasonCode': choice.reasonCode, 'reason': choice.reason},
    );
    messenger.showSnackBar(SnackBar(content: Text(successMessage)));
  } on DioException catch (error) {
    // 401/403 renvoient un message technique anglais du garde d'authentification
    // ("Unauthorized"), jamais pré-localisé comme le sont les erreurs métier
    // (§ `Failure` — seuls les échecs techniques se formulent côté client).
    final status = error.response?.statusCode;
    String? message = status == 401
        ? 'Votre session a expiré. Reconnectez-vous.'
        : status == 403
            ? 'Vous n’êtes pas autorisé à effectuer cette action.'
            : null;
    if (message == null) {
      final response = error.response?.data;
      if (response is Map<String, dynamic>) {
        final body = response['error'];
        if (body is Map<String, dynamic>) message = body['message'] as String?;
      }
    }
    messenger.showSnackBar(SnackBar(content: Text(message ?? 'Impossible d’envoyer ce signalement.')));
  }
}

/// Blocage générique compte-à-compte (§29) — distinct du blocage d'une seule
/// conversation : ferme la messagerie avec ce compte et masque ses
/// publications de mon fil, où qu'elles apparaissent.
Future<bool> blockUserAccount(BuildContext context, WidgetRef ref, String userId) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(apiClientProvider).post<void>('/moderation/users/$userId/block');
    messenger.showSnackBar(const SnackBar(content: Text('Compte bloqué.')));
    return true;
  } on DioException {
    messenger.showSnackBar(const SnackBar(content: Text('Impossible de bloquer ce compte.')));
    return false;
  }
}

Future<bool> unblockUserAccount(BuildContext context, WidgetRef ref, String userId) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(apiClientProvider).delete<void>('/moderation/users/$userId/block');
    messenger.showSnackBar(const SnackBar(content: Text('Compte débloqué.')));
    return true;
  } on DioException {
    messenger.showSnackBar(const SnackBar(content: Text('Impossible de débloquer ce compte.')));
    return false;
  }
}

Future<bool?> confirmBlockUser(BuildContext context, String name) {
  return showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Bloquer ce compte ?'),
      content: Text(
        '$name ne pourra plus vous envoyer de messages et ses publications '
        'n’apparaîtront plus dans votre fil. Vous pourrez le débloquer à tout moment.',
      ),
      actions: <Widget>[
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Annuler')),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Bloquer')),
      ],
    ),
  );
}
