import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Création de compte client — `POST /auth/register`.
///
/// Sans cet écran, l'application n'avait aucun chemin d'entrée : seuls les
/// comptes créés depuis le web ou le jeu de données pouvaient s'y connecter.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _submitting = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _phone.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_phone.text.trim().isEmpty && _email.text.trim().isEmpty) {
      setState(() => _error = 'Renseignez un email ou un numéro de téléphone.');
      return;
    }
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(sessionControllerProvider.notifier).register(
            phone: _phone.text.trim(),
            email: _email.text.trim(),
            password: _password.text,
            firstName: _firstName.text.trim(),
            lastName: _lastName.text.trim(),
          );
      if (mounted) context.go(Routes.home);
    } on DioException catch (error) {
      final failure = error.error;
      setState(() {
        _error = failure is Failure ? failure.displayMessage : 'Inscription impossible.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Créer un compte')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AllGoTokens.space6),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const AllGoLogo(size: 56),
                    const SizedBox(height: AllGoTokens.space4),
                    Text(
                      'Vendez et achetez à Mahajanga, même sans connexion.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AllGoTokens.space6),
                    TextFormField(
                      controller: _firstName,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(
                        labelText: 'Prénom',
                        prefixIcon: Icon(Icons.badge_outlined),
                      ),
                      validator: (value) =>
                          (value ?? '').trim().isEmpty ? 'Entrez votre prénom.' : null,
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    TextFormField(
                      controller: _lastName,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(
                        labelText: 'Nom',
                        prefixIcon: Icon(Icons.badge_outlined),
                      ),
                      validator: (value) =>
                          (value ?? '').trim().isEmpty ? 'Entrez votre nom.' : null,
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    TextFormField(
                      controller: _phone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(
                        labelText: 'Numéro de téléphone (facultatif)',
                        prefixIcon: Icon(Icons.phone_outlined),
                      ),
                      validator: (value) {
                        final phone = (value ?? '').replaceAll(RegExp(r'\s'), '');
                        if (phone.isEmpty) return null;
                        return malagasyPhone.hasMatch(phone)
                            ? null
                            : 'Entrez un numéro malgache valide.';
                      },
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const <String>[AutofillHints.email],
                      decoration: const InputDecoration(
                        labelText: 'Email (facultatif)',
                        prefixIcon: Icon(Icons.email_outlined),
                      ),
                      validator: (value) {
                        final email = (value ?? '').trim();
                        if (email.isEmpty) return null;
                        return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)
                            ? null
                            : 'Entrez une adresse email valide.';
                      },
                    ),
                    Text(
                      'Renseignez un email ou un numéro de téléphone.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      decoration: InputDecoration(
                        labelText: 'Mot de passe',
                        // La règle est annoncée AVANT la saisie, pas après le
                        // rejet : découvrir la contrainte par un message
                        // d'erreur est une mauvaise manière de la faire
                        // respecter (§12.1).
                        helperText: '10 caractères minimum, dont une lettre et un chiffre',
                        helperMaxLines: 2,
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                          tooltip: _obscure ? 'Afficher' : 'Masquer',
                        ),
                      ),
                      validator: (value) {
                        // Même règle que le DTO serveur : l'utilisateur ne doit
                        // pas faire un aller-retour réseau pour l'apprendre.
                        final rule = RegExp(r'^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).{10,128}$');
                        return rule.hasMatch(value ?? '')
                            ? null
                            : 'Au moins 10 caractères, une lettre et un chiffre.';
                      },
                    ),
                    if (_error != null) ...<Widget>[
                      const SizedBox(height: AllGoTokens.space4),
                      AuthErrorBanner(message: _error!),
                    ],
                    const SizedBox(height: AllGoTokens.space6),
                    FilledButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Créer mon compte'),
                    ),
                    const SizedBox(height: AllGoTokens.space4),
                    TextButton(
                      onPressed: _submitting ? null : () => context.go(Routes.login),
                      child: const Text('J’ai déjà un compte'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
