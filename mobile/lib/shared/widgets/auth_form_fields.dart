import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:allgo/shared/widgets/field_icon.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

export 'package:allgo/shared/widgets/field_icon.dart';

/// Numéro malgache : `+261XXXXXXXXX` ou `0XXXXXXXXX`, opérateurs 3x et 2x.
/// Même expression que le DTO serveur — la règle doit être identique des deux
/// côtés, sinon l'un des deux ment à l'utilisateur.
final RegExp malagasyPhone = RegExp(r'^(\+261|0)[23]\d{8}$');

/// Champ de saisie du numéro de téléphone, partagé par tous les écrans d'accès.
///
/// Le numéro est l'identifiant principal de la plateforme : à Mahajanga il est
/// plus fiable qu'une adresse email (§12.2). Il mérite donc une saisie unique
/// et cohérente, pas trois variantes recopiées.
class PhoneField extends StatelessWidget {
  const PhoneField({
    required this.controller,
    this.label = 'Numéro de téléphone',
    this.onSubmitted,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    // `ListenableBuilder` plutôt qu'un `StatefulWidget` : le seul état à
    // suivre est déjà dans le contrôleur (fourni par l'appelant), inutile
    // d'en dupliquer un second ici pour afficher/masquer le bouton d'effacement.
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => TextFormField(
        controller: controller,
        keyboardType: TextInputType.phone,
        autofillHints: const <String>[AutofillHints.telephoneNumber],
        inputFormatters: <TextInputFormatter>[
          FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s]')),
        ],
        decoration: InputDecoration(
          labelText: label,
          hintText: '034 12 345 67',
          prefixIcon: const FieldIcon(Icons.phone_outlined),
          suffixIcon: controller.text.isEmpty
              ? null
              : IconButton(
                  onPressed: controller.clear,
                  icon: const Icon(Icons.clear),
                  tooltip: 'Effacer',
                ),
        ),
        validator: (value) {
          final digits = (value ?? '').replaceAll(RegExp(r'\s'), '');
          return malagasyPhone.hasMatch(digits) ? null : 'Entrez un numéro malgache valide.';
        },
        onFieldSubmitted: onSubmitted,
      ),
    );
  }
}

/// Coquille commune des écrans d'accès (connexion, inscription) : bandeau de
/// marque avec logo et bouton retour, puis fiche blanche arrondie portant le
/// formulaire — plutôt qu'un formulaire centré sur fond uni, qui donnait à ces
/// deux écrans un air de brouillon face au reste de l'application.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    required this.tagline,
    required this.child,
    this.logoSize = 72,
    super.key,
  });

  final String tagline;
  final double logoSize;

  /// Contenu du formulaire — sans son propre `Scaffold`/`SafeArea` : la
  /// coquille les porte déjà.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      // Le vert de marque n'occupe que l'en-tête : la fiche qui porte le
      // formulaire reste sur `surface`, pour un contraste de lecture constant
      // quel que soit le thème (clair/sombre).
      backgroundColor: AllGoTokens.brand,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AllGoTokens.space4,
                AllGoTokens.space2,
                AllGoTokens.space4,
                AllGoTokens.space6,
              ),
              child: Column(
                children: <Widget>[
                  // Toujours affiché : même lorsqu'il n'y a rien à dépiler
                  // (accès direct), quitter doit rester possible — on retombe
                  // alors sur l'accueil, consultable sans compte.
                  Align(
                    alignment: Alignment.topLeft,
                    child: _AuthHeaderBackButton(
                      onPressed: () => Navigator.of(context).canPop()
                          ? Navigator.of(context).pop()
                          : context.go(Routes.home),
                    ),
                  ),
                  const SizedBox(height: AllGoTokens.space4),
                  AllGoLogo(size: logoSize),
                  const SizedBox(height: AllGoTokens.space2),
                  Text(
                    tagline,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: Colors.white.withValues(alpha: 0.92),
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
            Expanded(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: theme.colorScheme.surface,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(AllGoTokens.radiusSheet),
                  ),
                ),
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(
                      AllGoTokens.space6,
                      AllGoTokens.space8,
                      AllGoTokens.space6,
                      AllGoTokens.space6,
                    ),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: child,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Bouton retour circulaire semi-transparent sur le bandeau de marque —
/// le même que celui déjà utilisé en surimpression d'image (fiche produit,
/// boutique), plutôt qu'un `BackButton` blanc nu qui se fondrait dans le vert.
class _AuthHeaderBackButton extends StatelessWidget {
  const _AuthHeaderBackButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white.withValues(alpha: 0.18),
        shape: const CircleBorder(),
        child: IconButton(
          onPressed: onPressed,
          icon: const Icon(Icons.arrow_back, color: Colors.white),
        ),
      );
}

/// Bandeau d'erreur des écrans d'accès.
///
/// Le message vient du serveur, déjà localisé (§7.2) : ce composant ne fait que
/// le présenter, il n'en compose jamais.
class AuthErrorBanner extends StatelessWidget {
  const AuthErrorBanner({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(AllGoTokens.space3),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.error_outline, size: 20, color: scheme.onErrorContainer),
          const SizedBox(width: AllGoTokens.space2),
          Expanded(
            child: Text(message, style: TextStyle(color: scheme.onErrorContainer)),
          ),
        ],
      ),
    );
  }
}
