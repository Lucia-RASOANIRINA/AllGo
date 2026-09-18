import 'package:allgo/app/theme.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';

/// Logo AllGo — panier de marché dont l'anse dessine un « A ».
///
/// Rendu depuis un PNG plutôt que dessiné en Dart : la même source sert les
/// icônes de lanceur Android (`tool/generate_icons.js`), et deux tracés
/// distincts finiraient par diverger.
class AllGoLogo extends StatelessWidget {
  const AllGoLogo({
    this.size = 72,
    this.showWordmark = true,
    this.wordmarkColor,
    super.key,
  });

  final double size;
  final bool showWordmark;

  /// `null` retombe sur le vert de marque — visible seulement sur un fond
  /// clair. Un appelant qui pose le logo sur un fond de la même teinte
  /// (`AuthScaffold`, bandeau vert) doit fournir une couleur qui contraste,
  /// sinon le mot-symbole devient invisible (constaté en direct : le texte
  /// rendait bien, mais dans la même couleur que le fond derrière lui).
  final Color? wordmarkColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Image.asset(
          'assets/images/allgo_logo.png',
          width: size,
          height: size,
          // L'icône porte le nom de l'application : elle est décorative pour
          // un lecteur d'écran dès lors que « AllGo » est écrit juste dessous.
          semanticLabel: showWordmark ? null : AppL10n.of(context).appName,
          excludeFromSemantics: showWordmark,
        ),
        if (showWordmark) ...<Widget>[
          const SizedBox(height: AllGoTokens.space3),
          Text(
            AppL10n.of(context).appName,
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: wordmarkColor ?? AllGoTokens.brand,
              letterSpacing: -0.5,
            ),
          ),
        ],
      ],
    );
  }
}
