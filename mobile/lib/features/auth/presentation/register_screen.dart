import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
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
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(sessionControllerProvider.notifier).register(
            phone: _phone.text.trim(),
            password: _password.text,
            firstName: _firstName.text.trim(),
            lastName: _lastName.text.trim(),
            email: _email.text.trim().isEmpty ? null : _email.text.trim(),
          );
      if (mounted) context.go(Routes.home);
    } on DioException catch (error) {
      final failure = error.error;
      setState(() {
        _error =
            failure is Failure ? failure.displayMessage : AppL10n.of(context).errorSignUpFailed;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppL10n.of(context);

    return AuthScaffold(
      tagline: l10n.taglineRegister,
      logoSize: 56,
      child: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TextFormField(
              controller: _firstName,
              textCapitalization: TextCapitalization.words,
              autofillHints: const <String>[AutofillHints.givenName],
              decoration: InputDecoration(
                labelText: l10n.fieldFirstName,
                prefixIcon: const FieldIcon(Icons.person_outline),
              ),
              validator: (value) =>
                  (value ?? '').trim().isEmpty ? l10n.validationFirstNameRequired : null,
            ),
            const SizedBox(height: AllGoTokens.space4),
            TextFormField(
              controller: _lastName,
              textCapitalization: TextCapitalization.words,
              autofillHints: const <String>[AutofillHints.familyName],
              decoration: InputDecoration(
                labelText: l10n.fieldLastName,
                prefixIcon: const FieldIcon(Icons.person_outline),
              ),
              validator: (value) =>
                  (value ?? '').trim().isEmpty ? l10n.validationLastNameRequired : null,
            ),
            const SizedBox(height: AllGoTokens.space4),
            PhoneField(controller: _phone),
            const SizedBox(height: AllGoTokens.space4),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const <String>[AutofillHints.email],
              decoration: InputDecoration(
                labelText: l10n.fieldEmailOptional,
                prefixIcon: const FieldIcon(Icons.email_outlined),
              ),
              validator: (value) {
                final trimmed = (value ?? '').trim();
                if (trimmed.isEmpty) return null;
                final rule = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
                return rule.hasMatch(trimmed) ? null : l10n.validationEmailInvalid;
              },
            ),
            const SizedBox(height: AllGoTokens.space4),
            TextFormField(
              controller: _password,
              obscureText: _obscure,
              autofillHints: const <String>[AutofillHints.newPassword],
              decoration: InputDecoration(
                labelText: l10n.fieldPassword,
                // La règle est annoncée AVANT la saisie, pas après le
                // rejet : découvrir la contrainte par un message
                // d'erreur est une mauvaise manière de la faire
                // respecter (§12.1).
                helperText: l10n.passwordHelperText,
                helperMaxLines: 2,
                prefixIcon: const FieldIcon(Icons.lock_outline),
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
                return rule.hasMatch(value ?? '') ? null : l10n.validationPasswordRule;
              },
              onFieldSubmitted: (_) => _submit(),
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
                  : Text(l10n.actionCreateMyAccount),
            ),
            const SizedBox(height: AllGoTokens.space4),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Text(l10n.alreadyHaveAccount, style: theme.textTheme.bodyMedium),
                TextButton(
                  onPressed: _submitting ? null : () => context.go(Routes.login),
                  child: Text(l10n.actionSignIn),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
