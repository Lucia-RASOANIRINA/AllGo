import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
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
  // Résolus en texte affichable dans `build()` : `AppL10n.of(context)` n'est
  // pas fiable depuis `initState`, avant le premier montage complet de l'arbre.
  bool _verified = false;
  String? _serverMessage;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_verify());
  }

  Future<void> _verify() async {
    try {
      await ref.read(apiClientProvider).post<void>('/auth/email/verify', data: <String, String>{'token': widget.token});
      _verified = true;
    } on DioException catch (error) {
      _serverMessage = error.response?.data is Map<String, dynamic>
          ? (error.response!.data as Map<String, dynamic>)['message'] as String?
          : null;
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppL10n.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.emailVerificationTitle)),
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
                    Text(
                      _verified
                          ? l10n.emailVerifiedMessage
                          : _serverMessage ?? l10n.linkInvalidOrExpired,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: AllGoTokens.space6),
                    FilledButton(onPressed: () => context.go('/'), child: Text(l10n.actionContinue)),
                  ],
                ),
        ),
      ),
    );
  }
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
    final l10n = AppL10n.of(context);
    setState(() => _loading = true);
    try {
      await ref.read(apiClientProvider).post<void>('/auth/password/reset', data: <String, String>{'token': widget.token, 'password': _password.text});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.passwordChangedMessage)));
        context.go('/connexion');
      }
    } on DioException catch (error) {
      if (mounted) {
        final serverMessage = error.response?.data is Map<String, dynamic>
            ? (error.response!.data as Map<String, dynamic>)['message'] as String?
            : null;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(serverMessage ?? l10n.errorResetFailed)));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppL10n.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.resetPasswordTitle)),
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
                labelText: l10n.fieldNewPassword,
                helperText: l10n.passwordHelperText,
                helperMaxLines: 2,
                prefixIcon: const FieldIcon(Icons.lock_outline),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                  tooltip: _obscure ? l10n.actionShowPassword : l10n.actionHidePassword,
                ),
              ),
              validator: (value) => RegExp(r'^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).{10,128}$').hasMatch(value ?? '') ? null : l10n.validationPasswordRule,
            ),
            const SizedBox(height: AllGoTokens.space6),
            FilledButton(onPressed: _loading ? null : _submit, child: Text(_loading ? l10n.actionSaving : l10n.actionChangePassword)),
          ],
        ),
      ),
    );
  }
}
