import 'package:allgo/app/theme.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';

/// Le SMS n'est pas encore branché à un vrai fournisseur (§12.2,
/// `SmsService.assertAvailable`) : dire honnêtement que la fonctionnalité
/// arrive plutôt que de tenter un appel voué à échouer et d'afficher une
/// erreur générique à la place — utilisé par l'écran de connexion par SMS et
/// par l'onglet « Par téléphone » de mot de passe oublié.
class SmsNotAvailableNotice extends StatelessWidget {
  const SmsNotAvailableNotice({this.detail, super.key});

  /// Texte secondaire, par exemple une alternative à suggérer.
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(Icons.construction_outlined, size: 48, color: theme.colorScheme.outline),
        const SizedBox(height: AllGoTokens.space4),
        Text(
          AppL10n.of(context).smsNotAvailable,
          style: theme.textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
        if (detail != null) ...<Widget>[
          const SizedBox(height: AllGoTokens.space2),
          Text(
            detail!,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}
