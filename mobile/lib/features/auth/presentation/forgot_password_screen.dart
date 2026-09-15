import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/shared/widgets/auth_form_fields.dart';
import 'package:allgo/shared/widgets/sms_not_available_notice.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Réinitialisation de mot de passe — §12.1.
///
/// Deux voies, comme sur le site web : par téléphone (SMS) ou par email.
/// Le SMS n'est pas encore branché (`SmsService.assertAvailable`) : cette
/// voie l'annonce honnêtement plutôt que de laisser l'utilisateur buter sur
/// un échec après coup. La voie email, elle, est réellement fonctionnelle —
/// elle envoie un mot de passe temporaire, valable 30 minutes, jusqu'à deux
/// fois par jour et par adresse.
///
/// La confirmation de la voie email est **identique que le compte existe ou
/// non** : l'écran ne doit jamais servir à savoir quelles adresses sont
/// enregistrées.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();

  bool _byEmail = true;
  bool _submitting = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref
          .read(sessionControllerProvider.notifier)
          .forgotPasswordByEmail(_email.text.trim());
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  SegmentedButton<bool>(
                    segments: const <ButtonSegment<bool>>[
                      ButtonSegment<bool>(
                        value: false,
                        label: Text('Par téléphone'),
                        icon: Icon(Icons.sms_outlined),
                      ),
                      ButtonSegment<bool>(
                        value: true,
                        label: Text('Par email'),
                        icon: Icon(Icons.email_outlined),
                      ),
                    ],
                    selected: <bool>{_byEmail},
                    onSelectionChanged: _submitting
                        ? null
                        : (selection) => setState(() {
                              _byEmail = selection.first;
                              _sent = false;
                              _error = null;
                            }),
                  ),
                  const SizedBox(height: AllGoTokens.space6),
                  if (!_byEmail)
                    const SmsNotAvailableNotice(
                      detail: 'En attendant, utilisez l’option « Par email » ci-dessus.',
                    )
                  else if (_sent)
                    _SentConfirmation(email: _email.text.trim())
                  else
                    Form(
                      key: _formKey,
                      autovalidateMode: AutovalidateMode.onUserInteraction,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'Indiquez votre adresse email : vous recevrez un mot de passe '
                            'temporaire, valable 30 minutes (2 demandes par jour maximum).',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: AllGoTokens.space6),
                          TextFormField(
                            controller: _email,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const <String>[AutofillHints.email],
                            decoration: const InputDecoration(
                              labelText: 'Adresse email',
                              prefixIcon: FieldIcon(Icons.email_outlined),
                            ),
                            onFieldSubmitted: (_) => _submit(),
                            validator: (value) {
                              final trimmed = (value ?? '').trim();
                              final rule = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
                              return rule.hasMatch(trimmed)
                                  ? null
                                  : 'Entrez une adresse email valide.';
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
                                : const Text('Envoyer un mot de passe temporaire'),
                          ),
                        ],
                      ),
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
    );
  }
}

class _SentConfirmation extends StatelessWidget {
  const _SentConfirmation({required this.email});

  final String email;

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
          // du compte permettrait d'énumérer les adresses enregistrées.
          'Si un compte est associé à $email, un mot de passe temporaire '
          'vient d’être envoyé par email. Il est valable 30 minutes et ne '
          'peut servir qu’une seule fois.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
