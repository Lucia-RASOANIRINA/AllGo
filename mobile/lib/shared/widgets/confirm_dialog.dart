import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Boîte de confirmation générique — icône badgée, titre, message, deux
/// actions en pilules pleine largeur. Remplace l'`AlertDialog` par défaut,
/// trop nu pour une action qui mérite d'être remarquée (déconnexion,
/// suppression de compte...).
class ConfirmDialog extends StatelessWidget {
  const ConfirmDialog({
    required this.icon,
    required this.title,
    required this.message,
    required this.confirmLabel,
    this.cancelLabel = 'Annuler',
    this.isDestructive = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;
  final String confirmLabel;
  final String cancelLabel;
  final bool isDestructive;

  static Future<bool?> show(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String message,
    required String confirmLabel,
    String cancelLabel = 'Annuler',
    bool isDestructive = false,
  }) {
    return showDialog<bool>(
      context: context,
      builder: (_) => ConfirmDialog(
        icon: icon,
        title: title,
        message: message,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        isDestructive: isDestructive,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final accent = isDestructive ? scheme.error : AllGoTokens.brand;

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
      child: Container(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          // Teinte unie et pré-mélangée sur un fond opaque — pas de dégradé :
          // combiné au fond transparent du `Dialog` ci-dessus, un dégradé vers
          // une couleur semi-transparente laissait le contenu de l'écran
          // derrière (notifications, libellés) transparaître à travers la carte.
          color: Color.alphaBlend(accent.withValues(alpha: 0.08), scheme.surface),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: scheme.shadow.withValues(alpha: 0.18),
              blurRadius: 32,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: accent.withValues(alpha: 0.4)),
                  ),
                  child: Icon(icon, color: accent, size: 20),
                ),
                const SizedBox(width: AllGoTokens.space3),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AllGoTokens.space4),
            Text(message, style: theme.textTheme.bodyMedium?.copyWith(height: 1.4)),
            const SizedBox(height: AllGoTokens.space6),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      shape: const StadiumBorder(),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      foregroundColor: accent,
                      side: BorderSide(color: scheme.outlineVariant),
                    ),
                    onPressed: () => Navigator.pop(context, false),
                    child: Text(cancelLabel),
                  ),
                ),
                const SizedBox(width: AllGoTokens.space3),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      shape: const StadiumBorder(),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      backgroundColor: accent,
                    ),
                    onPressed: () => Navigator.pop(context, true),
                    child: Text(confirmLabel),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
