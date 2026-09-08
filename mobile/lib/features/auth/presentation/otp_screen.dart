import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Connexion par code SMS — §12.2.
///
/// Deux étapes dans un seul écran : demander le code, puis le saisir. Les
/// séparer en deux routes obligerait à retransporter le numéro et rendrait le
/// retour en arrière déroutant.
///
/// Le code vaut 5 minutes et tolère 3 tentatives, plafond appliqué côté serveur.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({this.redirectTo, super.key});

  final String? redirectTo;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _code = TextEditingController();

  bool _codeSent = false;
  bool _submitting = false;
  String? _error;

  /// Secondes restantes avant de pouvoir redemander un code.
  ///
  /// Sans ce délai, un utilisateur impatient épuiserait la limitation de débit
  /// du serveur (10 req/min) et se bloquerait lui-même.
  int _resendIn = 0;
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  void _startResendCountdown() {
    _ticker?.cancel();
    setState(() => _resendIn = 60);
    _ticker = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || _resendIn <= 1) {
        timer.cancel();
        if (mounted) setState(() => _resendIn = 0);
        return;
      }
      setState(() => _resendIn -= 1);
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await action();
    } on DioException catch (error) {
      final failure = error.error;
      setState(() {
        _error = failure is Failure ? failure.displayMessage : 'Opération impossible.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _sendCode() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    await _run(() async {
      await ref.read(sessionControllerProvider.notifier).sendOtp(_phone.text.trim());
      if (mounted) {
        setState(() => _codeSent = true);
        _startResendCountdown();
      }
    });
  }

  Future<void> _verify() async {
    if (_code.text.length != 6) {
      setState(() => _error = 'Entrez les 6 chiffres du code.');
      return;
    }

    await _run(() async {
      await ref
          .read(sessionControllerProvider.notifier)
          .verifyOtp(phone: _phone.text.trim(), code: _code.text);
      if (mounted) context.go(widget.redirectTo ?? Routes.home);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Connexion par SMS')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AllGoTokens.space6),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      _codeSent
                          ? 'Un code à 6 chiffres a été envoyé au ${_phone.text}. '
                              'Il est valable 5 minutes.'
                          : 'Recevez un code par SMS, sans mot de passe à retenir.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AllGoTokens.space6),
                    PhoneField(
                      controller: _phone,
                      onSubmitted: (_) => _codeSent ? null : _sendCode(),
                    ),
                    if (_codeSent) ...<Widget>[
                      const SizedBox(height: AllGoTokens.space4),
                      TextFormField(
                        controller: _code,
                        keyboardType: TextInputType.number,
                        autofocus: true,
                        maxLength: 6,
                        // Le code arrive par SMS : le remplissage automatique
                        // évite une recopie manuelle chiffre par chiffre.
                        autofillHints: const <String>[AutofillHints.oneTimeCode],
                        inputFormatters: <TextInputFormatter>[
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                        style: theme.textTheme.headlineSmall?.copyWith(letterSpacing: 8),
                        textAlign: TextAlign.center,
                        decoration: const InputDecoration(
                          labelText: 'Code reçu',
                          counterText: '',
                        ),
                        onChanged: (value) {
                          // Validation dès le sixième chiffre : demander en
                          // plus d'appuyer sur un bouton n'apporte rien.
                          if (value.length == 6 && !_submitting) unawaited(_verify());
                        },
                      ),
                    ],
                    if (_error != null) ...<Widget>[
                      const SizedBox(height: AllGoTokens.space4),
                      AuthErrorBanner(message: _error!),
                    ],
                    const SizedBox(height: AllGoTokens.space6),
                    FilledButton(
                      onPressed: _submitting ? null : (_codeSent ? _verify : _sendCode),
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(_codeSent ? 'Valider le code' : 'Recevoir le code'),
                    ),
                    if (_codeSent) ...<Widget>[
                      const SizedBox(height: AllGoTokens.space3),
                      TextButton(
                        onPressed: _resendIn > 0 || _submitting ? null : _sendCode,
                        child: Text(
                          _resendIn > 0 ? 'Renvoyer le code dans $_resendIn s' : 'Renvoyer le code',
                        ),
                      ),
                    ],
                    const SizedBox(height: AllGoTokens.space2),
                    TextButton(
                      onPressed: _submitting ? null : () => context.go(Routes.login),
                      child: const Text('Utiliser mon mot de passe'),
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
