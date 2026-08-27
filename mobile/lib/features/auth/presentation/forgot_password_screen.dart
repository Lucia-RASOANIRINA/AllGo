import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Réinitialisation de mot de passe — §12.1.
///
/// Le document système relève que cette fonction n'est **pas implémentée** sur
/// le web : le lien existe, il ne mène nulle part. Ici elle l'est réellement,
/// jeton à usage unique valable 30 minutes.
///
/// La confirmation est **identique que le compte existe ou non** : l'écran ne
/// doit jamais servir à savoir quels numéros sont enregistrés.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phone = TextEditingController();

  bool _submitting = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref.read(sessionControllerProvider.notifier).forgotPassword(_phone.text.trim());
      if (mounted) setState(() => _sent = true);
    } on DioException catch (error) {
      final failure = error.error;
      setState(() {
        _error = failure is Failure ? failure.displayMessage : 'Demande impossible.';
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Mot de passe oublié')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AllGoTokens.space6),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _sent
                  ? _SentConfirmation(phone: _phone.text.trim())
                  : Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'Indiquez votre numéro : vous recevrez un SMS avec un lien '
                            'de réinitialisation, valable 30 minutes.',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: AllGoTokens.space6),
                          PhoneField(controller: _phone, onSubmitted: (_) => _submit()),
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
                                : const Text('Envoyer le lien'),
                          ),
                          const SizedBox(height: AllGoTokens.space3),
                          TextButton(
                            onPressed: _submitting ? null : () => context.go(Routes.login),
                            child: const Text('Retour à la connexion'),
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

class _SentConfirmation extends StatelessWidget {
  const _SentConfirmation({required this.phone});

  final String phone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Icon(Icons.mark_email_read_outlined, size: 56, color: theme.colorScheme.primary),
        const SizedBox(height: AllGoTokens.space4),
        Text(
          'Demande envoyée',
          style: theme.textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AllGoTokens.space2),
        Text(
          // Formulation volontairement conditionnelle : confirmer l'existence
          // du compte permettrait d'énumérer les numéros enregistrés.
          'Si un compte est associé au $phone, un SMS vient d’être envoyé. '
          'Le lien reste valable 30 minutes.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AllGoTokens.space8),
        FilledButton(
          onPressed: () => context.go(Routes.login),
          child: const Text('Retour à la connexion'),
        ),
      ],
    );
  }
}
