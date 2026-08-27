import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Écran d'attente pour une fonction planifiée mais non encore livrée.
///
/// Il existe pour une raison précise : les onglets commerçant et livreur sont
/// visibles dès le lot L0 (le sélecteur de profil en dépend), alors que leurs
/// écrans arrivent aux lots L5 et L6. Sans destination enregistrée,
/// `go_router` lèverait une erreur de navigation — un plantage plutôt qu'un
/// écran honnête.
///
/// Il annonce le lot concerné : « bientôt disponible » sans échéance n'informe
/// personne.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({
    required this.title,
    required this.lot,
    this.detail,
    super.key,
  });

  final String title;

  /// Lot de livraison prévu, par exemple « L5 — Espace commerçant ».
  final String lot;

  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AllGoTokens.space8),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(Icons.construction_outlined, size: 56, color: theme.colorScheme.outline),
              const SizedBox(height: AllGoTokens.space4),
              Text(
                'Cette fonction arrive au lot $lot.',
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              if (detail != null) ...<Widget>[
                const SizedBox(height: AllGoTokens.space2),
                Text(
                  detail!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
