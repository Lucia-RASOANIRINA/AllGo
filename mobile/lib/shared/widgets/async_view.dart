import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Les **cinq états d'interface obligatoires** — §11.3.
///
/// « Chaque écran implémente cinq états, sans exception :
///   chargement · chargé · vide · erreur · hors ligne. »
///
/// Ce composant rend la règle structurelle plutôt que déclarative : un écran
/// qui affiche une liste passe par ici, et ne peut donc pas oublier l'état vide
/// ou l'état hors ligne — les deux systématiquement omis quand chaque écran
/// gère ses états à la main.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({
    required this.value,
    required this.data,
    required this.isEmpty,
    required this.emptyTitle,
    required this.onRetry,
    this.emptyMessage,
    this.emptyAction,
    this.skeleton,
    this.cachedData,
    super.key,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final bool Function(T data) isEmpty;

  final String emptyTitle;
  final String? emptyMessage;
  final Widget? emptyAction;

  /// Squelettes animés, jamais un cercle plein écran (§11.3).
  final Widget? skeleton;

  /// Données en cache à afficher malgré une erreur réseau : sur une connexion
  /// intermittente, montrer des données d'il y a dix minutes vaut infiniment
  /// mieux qu'un écran d'erreur.
  final T? cachedData;

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      loading: () => skeleton ?? const _SkeletonList(),
      data: (loaded) => isEmpty(loaded)
          ? _EmptyState(title: emptyTitle, message: emptyMessage, action: emptyAction)
          : data(loaded),
      error: (error, _) {
        final failure = error is Failure ? error : const Failure.unexpected();

        // Hors ligne AVEC cache : bandeau persistant + données en cache.
        if (failure.isOffline && cachedData != null) {
          return Column(
            children: <Widget>[
              const OfflineBanner(),
              Expanded(child: data(cachedData as T)),
            ],
          );
        }

        return _ErrorState(failure: failure, onRetry: onRetry);
      },
    );
  }
}

/// Bandeau persistant du mode hors ligne (§11.3).
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      width: double.infinity,
      color: scheme.tertiaryContainer,
      padding: const EdgeInsets.symmetric(
        horizontal: AllGoTokens.space4,
        vertical: AllGoTokens.space2,
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.cloud_off, size: 18, color: scheme.onTertiaryContainer),
          const SizedBox(width: AllGoTokens.space2),
          Expanded(
            child: Text(
              'Hors ligne — données enregistrées',
              style: TextStyle(color: scheme.onTertiaryContainer, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.title, this.message, this.action});

  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AllGoTokens.space8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(Icons.inbox_outlined, size: 56, color: theme.colorScheme.outline),
            const SizedBox(height: AllGoTokens.space4),
            Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            if (message != null) ...<Widget>[
              const SizedBox(height: AllGoTokens.space2),
              Text(
                message!,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            // Un état vide propose TOUJOURS une action : une impasse est un
            // défaut de conception, pas un état légitime.
            if (action != null) ...<Widget>[
              const SizedBox(height: AllGoTokens.space6),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// État d'erreur : cause, conséquence, bouton « Réessayer » (§11.3).
class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.failure, required this.onRetry});

  final Failure failure;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AllGoTokens.space8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(
              failure.isOffline ? Icons.cloud_off : Icons.error_outline,
              size: 56,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: AllGoTokens.space4),
            Text(
              failure.displayMessage,
              style: theme.textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AllGoTokens.space6),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Réessayer'),
            ),
            // Le `requestId` corrèle le rapport de l'utilisateur avec la trace
            // serveur — il rend un incident diagnosticable en une recherche.
            if (failure case ApiFailure(:final requestId?)) ...<Widget>[
              const SizedBox(height: AllGoTokens.space4),
              SelectableText(
                'Référence : $requestId',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.outline,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Squelettes animés — jamais un cercle de chargement plein écran (§11.3).
class _SkeletonList extends StatelessWidget {
  const _SkeletonList();

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;

    return ListView.separated(
      padding: const EdgeInsets.all(AllGoTokens.space4),
      itemCount: 6,
      separatorBuilder: (_, __) => const SizedBox(height: AllGoTokens.space3),
      itemBuilder: (_, __) => Container(
        height: 88,
        decoration: BoxDecoration(
          color: base,
          borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
        ),
      ),
    );
  }
}
