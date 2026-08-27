import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Logo AllGo — panier de marché dont l'anse dessine un « A ».
///
/// Rendu depuis un PNG plutôt que dessiné en Dart : la même source sert les
/// icônes de lanceur Android (`tool/generate_icons.js`), et deux tracés
/// distincts finiraient par diverger.
class AllGoLogo extends StatelessWidget {
  const AllGoLogo({this.size = 72, this.showWordmark = true, super.key});

  final double size;
  final bool showWordmark;

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
          semanticLabel: showWordmark ? null : 'AllGo',
          excludeFromSemantics: showWordmark,
        ),
        if (showWordmark) ...<Widget>[
          const SizedBox(height: AllGoTokens.space3),
          Text(
            'AllGo',
            style: theme.textTheme.displaySmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: AllGoTokens.brand,
              letterSpacing: -0.5,
            ),
          ),
        ],
      ],
    );
  }
}
