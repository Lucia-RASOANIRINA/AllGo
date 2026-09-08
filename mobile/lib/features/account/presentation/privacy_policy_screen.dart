import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Politique de confidentialité — texte embarqué dans l'application,
/// consultable hors ligne (§12.3) : jamais chargée depuis le réseau, pour
/// rester lisible même sans connexion.
class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Confidentialité')),
      body: ListView(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        children: <Widget>[
          Text(
            'Dernière mise à jour : 2026',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: AllGoTokens.space4),
          const _Section(
            title: 'Données que nous collectons',
            body:
                'Votre numéro de téléphone (identifiant de compte et connexion), '
                'votre nom et vos adresses de livraison, votre position '
                'approximative lors d’une commande avec livraison, ainsi que '
                'l’historique de vos commandes, favoris et conversations avec '
                'les boutiques.',
          ),
          const _Section(
            title: 'Pourquoi nous les utilisons',
            body:
                'Pour créer et sécuriser votre compte, traiter vos commandes '
                'et leur livraison, vous mettre en relation avec les '
                'boutiques via la messagerie, et vous montrer des produits '
                'et boutiques pertinents près de chez vous.',
          ),
          const _Section(
            title: 'Ce que nous ne faisons pas',
            body:
                'Nous ne vendons pas vos données personnelles. Une boutique ne '
                'voit que ce qui est nécessaire pour traiter votre commande '
                '(nom, adresse de livraison, contenu des messages échangés '
                'avec elle) — jamais votre historique sur les autres '
                'boutiques.',
          ),
          const _Section(
            title: 'Partage avec les livreurs',
            body:
                'Le livreur en charge d’une commande reçoit l’adresse de '
                'livraison et votre numéro de téléphone, uniquement le temps '
                'de l’acheminement.',
          ),
          const _Section(
            title: 'Conservation et suppression',
            body:
                'Vos données sont conservées tant que votre compte est actif. '
                'La suppression de compte anonymise votre profil : vos '
                'commandes passées restent visibles par les boutiques '
                'concernées, sans vos coordonnées.',
          ),
          const _Section(
            title: 'Vos droits',
            body:
                'Vous pouvez à tout moment consulter, corriger ou supprimer '
                'vos informations depuis l’écran Compte, ou nous écrire pour '
                'toute question relative à vos données.',
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AllGoTokens.space6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: AllGoTokens.space2),
          Text(body, style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
        ],
      ),
    );
  }
}
