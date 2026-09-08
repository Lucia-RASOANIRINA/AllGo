import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class EmailVerificationScreen extends ConsumerStatefulWidget {
  const EmailVerificationScreen({required this.token, super.key});
  final String token;

  @override
  ConsumerState<EmailVerificationScreen> createState() => _EmailVerificationScreenState();
}

class _EmailVerificationScreenState extends ConsumerState<EmailVerificationScreen> {
  String? _message;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_verify());
  }

  Future<void> _verify() async {
    try {
      await ref.read(apiClientProvider).post<void>('/auth/email/verify', data: <String, String>{'token': widget.token});
      _message = 'Votre adresse email est vérifiée.';
    } on DioException catch (error) {
      _message = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : 'Ce lien est invalide ou expiré.';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Vérification email')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(AllGoTokens.space6),
            child: _loading
                ? const CircularProgressIndicator()
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Icon(Icons.mark_email_read_outlined, size: 56, color: Theme.of(context).colorScheme.primary),
                      const SizedBox(height: AllGoTokens.space4),
                      Text(_message ?? 'Vérification terminée.', textAlign: TextAlign.center),
                      const SizedBox(height: AllGoTokens.space6),
                      FilledButton(onPressed: () => context.go('/'), child: const Text('Continuer')),
                    ],
                  ),
          ),
        ),
      );
}

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({required this.token, super.key});
  final String token;

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _password = TextEditingController();
  bool _loading = false;
  bool _obscure = true;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ref.read(apiClientProvider).post<void>('/auth/password/reset', data: <String, String>{'token': widget.token, 'password': _password.text});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Mot de passe modifié.')));
        context.go('/connexion');
      }
    } on DioException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.response?.data is Map<String, dynamic> ? ((error.response!.data as Map<String, dynamic>)['message'] as String? ?? 'Réinitialisation impossible.') : 'Réinitialisation impossible.')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Nouveau mot de passe')),
        body: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: ListView(
            padding: const EdgeInsets.all(AllGoTokens.space6),
            children: <Widget>[
              TextFormField(
                controller: _password,
                obscureText: _obscure,
                autofillHints: const <String>[AutofillHints.newPassword],
                decoration: InputDecoration(
                  labelText: 'Nouveau mot de passe',
                  helperText: '10 caractères minimum, dont une lettre et un chiffre',
                  helperMaxLines: 2,
                  prefixIcon: const FieldIcon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => _obscure = !_obscure),
                    icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                    tooltip: _obscure ? 'Afficher' : 'Masquer',
                  ),
                ),
                validator: (value) => RegExp(r'^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).{10,128}$').hasMatch(value ?? '') ? null : '10 caractères minimum, avec une lettre et un chiffre.',
              ),
              const SizedBox(height: AllGoTokens.space6),
              FilledButton(onPressed: _loading ? null : _submit, child: Text(_loading ? 'Enregistrement...' : 'Modifier le mot de passe')),
            ],
          ),
        ),
      );
}
