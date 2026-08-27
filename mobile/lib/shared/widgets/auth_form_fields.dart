import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
    return TextFormField(
      controller: controller,
      keyboardType: TextInputType.phone,
      autofillHints: const <String>[AutofillHints.telephoneNumber],
      inputFormatters: <TextInputFormatter>[
        FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s]')),
      ],
      decoration: InputDecoration(
        labelText: label,
        hintText: '034 12 345 67',
        prefixIcon: const Icon(Icons.phone_outlined),
      ),
      validator: (value) {
        final digits = (value ?? '').replaceAll(RegExp(r'\s'), '');
        return malagasyPhone.hasMatch(digits) ? null : 'Entrez un numéro malgache valide.';
      },
      onFieldSubmitted: onSubmitted,
    );
  }
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
