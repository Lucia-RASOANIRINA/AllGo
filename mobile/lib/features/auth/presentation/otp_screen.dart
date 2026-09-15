import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/shared/widgets/sms_not_available_notice.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Connexion par code SMS — §12.2.
///
/// Le SMS n'est pas encore branché à un vrai fournisseur
/// (`SmsService.assertAvailable`) : plutôt que de laisser l'utilisateur
/// tenter une demande de code vouée à échouer avec une erreur générique,
/// l'écran annonce honnêtement l'indisponibilité et renvoie vers la
/// connexion par mot de passe.
class OtpScreen extends StatelessWidget {
  const OtpScreen({this.redirectTo, super.key});

  final String? redirectTo;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connexion par SMS')),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AllGoTokens.space6),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const SmsNotAvailableNotice(
                    detail: 'En attendant, connectez-vous avec votre mot de passe.',
                  ),
                  const SizedBox(height: AllGoTokens.space6),
                  FilledButton(
                    onPressed: () => context.go(
                      redirectTo == null
                          ? Routes.login
                          : '${Routes.login}?redirect=${Uri.encodeComponent(redirectTo!)}',
                    ),
                    child: const Text('Se connecter avec mon mot de passe'),
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
