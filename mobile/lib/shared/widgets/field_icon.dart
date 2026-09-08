import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Icône de champ posée sur une pastille teintée plutôt qu'une icône nue —
/// c'est ce détail qui donne à un formulaire un air de fiche moderne au lieu
/// d'un simple formulaire administratif (référence design des captures
/// e-commerce). Partagé par tous les formulaires de l'application, pas
/// seulement ceux de connexion/inscription.
class FieldIcon extends StatelessWidget {
  const FieldIcon(this.icon, {super.key});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    const brand = AllGoTokens.brand;

    return Padding(
      padding: const EdgeInsets.all(10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: brand.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(icon, color: brand, size: 18),
        ),
      ),
    );
  }
}
