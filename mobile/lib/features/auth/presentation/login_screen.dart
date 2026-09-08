import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({this.redirectTo, super.key});

  final String? redirectTo;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _password = TextEditingController();

  bool _submitting = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
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
      await ref.read(sessionControllerProvider.notifier).signIn(
            phone: _phone.text.trim(),
            password: _password.text,
          );
      if (mounted) context.go(widget.redirectTo ?? '/');
    } on DioException catch (error) {
      // Le message vient du serveur, déjà localisé (§7.2) : l'application ne
      // réinvente pas « Numéro ou mot de passe incorrect ».
      final failure = error.error;
      setState(() {
        _error = failure is Failure
            ? failure.displayMessage
            : AppL10n.of(context).errorSignInFailed;
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
      tagline: l10n.tagline,
      child: Form(
        key: _formKey,
        // Le message d'erreur apparaît/disparaît dès que l'utilisateur
        // modifie le champ, pas seulement au moment de soumettre : corriger
        // une faute de frappe se voit tout de suite, pas après un rejet.
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PhoneField(controller: _phone),
            const SizedBox(height: AllGoTokens.space4),

            TextFormField(
              controller: _password,
              obscureText: _obscure,
              autofillHints: const <String>[AutofillHints.password],
              decoration: InputDecoration(
                labelText: l10n.fieldPassword,
                prefixIcon: const FieldIcon(Icons.lock_outline),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                  tooltip: _obscure ? 'Afficher' : 'Masquer',
                ),
              ),
              validator: (value) =>
                  (value ?? '').isEmpty ? l10n.validationPasswordRequired : null,
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
                  : Text(l10n.actionSignIn),
            ),
            if (kDebugMode)
              Center(
                child: TextButton(
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: theme.colorScheme.outline,
                  ),
                  onPressed: _submitting
                      ? null
                      : () => setState(() {
                            _phone.text = '+261340000001';
                            _password.text = 'MotDePasse2026';
                          }),
                  child: const Text(
                    'Préremplir le compte commerçant de test',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
              ),

            const SizedBox(height: AllGoTokens.space4),
            Row(
              children: <Widget>[
                Expanded(child: Divider(color: theme.colorScheme.outlineVariant)),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
                  child: Text(
                    l10n.or,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.outline,
                    ),
                  ),
                ),
                Expanded(child: Divider(color: theme.colorScheme.outlineVariant)),
              ],
            ),
            const SizedBox(height: AllGoTokens.space4),

            // Connexion par SMS : adaptée à une population où le numéro
            // de téléphone est plus fiable que l'email (§12.2).
            OutlinedButton.icon(
              onPressed: _submitting
                  ? null
                  : () => context.push(
                        widget.redirectTo == null
                            ? Routes.otp
                            : '${Routes.otp}?redirect='
                                '${Uri.encodeComponent(widget.redirectTo!)}',
                      ),
              icon: const Icon(Icons.sms_outlined),
              label: Text(l10n.actionOtpLogin),
            ),

            const SizedBox(height: AllGoTokens.space6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                TextButton(
                  onPressed: _submitting ? null : () => context.push(Routes.forgotPassword),
                  child: Text(l10n.actionForgotPassword),
                ),
                TextButton(
                  onPressed: _submitting ? null : () => context.push(Routes.register),
                  child: Text(l10n.actionCreateAccount),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
