import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
        _error = failure is Failure ? failure.displayMessage : 'Connexion impossible. Réessayez.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AllGoTokens.space6),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const AllGoLogo(),
                    const SizedBox(height: AllGoTokens.space2),
                    Text(
                      'Le marché de Mahajanga, dans votre poche.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AllGoTokens.space8),

                    TextFormField(
                      controller: _phone,
                      keyboardType: TextInputType.phone,
                      autofillHints: const <String>[AutofillHints.telephoneNumber],
                      inputFormatters: <TextInputFormatter>[
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s]')),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Numéro de téléphone',
                        hintText: '034 12 345 67',
                        prefixIcon: Icon(Icons.phone_outlined),
                      ),
                      validator: (value) {
                        final digits = (value ?? '').replaceAll(RegExp(r'\s'), '');
                        // Le numéro est l'identifiant principal : plus fiable
                        // qu'une adresse email dans ce contexte (§12.2).
                        return RegExp(r'^(\+261|0)[23]\d{8}$').hasMatch(digits)
                            ? null
                            : 'Entrez un numéro malgache valide.';
                      },
                    ),
                    const SizedBox(height: AllGoTokens.space4),

                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      autofillHints: const <String>[AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: 'Mot de passe',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                          tooltip: _obscure ? 'Afficher' : 'Masquer',
                        ),
                      ),
                      validator: (value) =>
                          (value ?? '').isEmpty ? 'Entrez votre mot de passe.' : null,
                      onFieldSubmitted: (_) => _submit(),
                    ),

                    if (_error != null) ...<Widget>[
                      const SizedBox(height: AllGoTokens.space4),
                      Container(
                        padding: const EdgeInsets.all(AllGoTokens.space3),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(AllGoTokens.radiusField),
                        ),
                        child: Row(
                          children: <Widget>[
                            Icon(
                              Icons.error_outline,
                              size: 20,
                              color: theme.colorScheme.onErrorContainer,
                            ),
                            const SizedBox(width: AllGoTokens.space2),
                            Expanded(
                              child: Text(
                                _error!,
                                style: TextStyle(color: theme.colorScheme.onErrorContainer),
                              ),
                            ),
                          ],
                        ),
                      ),
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
                          : const Text('Se connecter'),
                    ),

                    const SizedBox(height: AllGoTokens.space3),
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
                      label: const Text('Recevoir un code par SMS'),
                    ),

                    const SizedBox(height: AllGoTokens.space4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: <Widget>[
                        TextButton(
                          onPressed: _submitting ? null : () => context.push(Routes.forgotPassword),
                          child: const Text('Mot de passe oublié ?'),
                        ),
                        TextButton(
                          onPressed: _submitting ? null : () => context.push(Routes.register),
                          child: const Text('Créer un compte'),
                        ),
                      ],
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
