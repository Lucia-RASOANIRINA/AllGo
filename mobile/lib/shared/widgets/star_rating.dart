import 'package:flutter/material.dart';

/// Rangée de 5 étoiles — lecture seule (avis affiché) ou saisie
/// (`onChanged` non nul, feuille « Laisser un avis »). Partagé entre les avis
/// boutique et les avis produit : même motif visuel, deux contextes.
class StarRow extends StatelessWidget {
  const StarRow({required this.rating, this.onChanged, super.key});

  final int rating;
  final ValueChanged<int>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List<Widget>.generate(5, (i) {
        final filled = i < rating;
        final icon = Icon(
          filled ? Icons.star : Icons.star_border,
          size: onChanged == null ? 16 : 28,
          color: Colors.amber,
        );
        if (onChanged == null) return icon;
        return IconButton(
          onPressed: () => onChanged!(i + 1),
          icon: icon,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(),
          visualDensity: VisualDensity.compact,
        );
      }),
    );
  }
}
