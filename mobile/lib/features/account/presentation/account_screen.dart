import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/sync/sync_providers.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/settings/presentation/settings_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final settings = ref.watch(settingsControllerProvider);
    final pending = ref.watch(pendingActionCountProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Compte')),
      body: ListView(
        children: <Widget>[
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person_outline)),
            title: Text(session.displayName ?? 'Utilisateur'),
            subtitle: const Text('Voir et modifier mon profil'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/compte/profil'),
          ),

          // Sélecteur de profil — un commerçant reste un client sur AllGo (§11.2).
          if (session.canSwitchProfile) ...<Widget>[
            const Divider(),
            const _SectionTitle('Changer de profil'),
            _ProfileSwitcher(
                active: session.activeProfile, roles: session.roles),
          ],

          const Divider(),
          const _SectionTitle('Mes achats'),
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: const Text('Commandes'),
            onTap: () => context.push('/commandes'),
          ),
          ListTile(
            leading: const Icon(Icons.location_on_outlined),
            title: const Text('Adresses de livraison'),
            onTap: () => context.push('/compte/adresses'),
          ),
          ListTile(
            leading: const Icon(Icons.favorite_border),
            title: const Text('Favoris'),
            onTap: () => context.push('/compte/favoris'),
          ),
          ListTile(
            leading: const Icon(Icons.groups_outlined),
            title: const Text('Réseau social'),
            subtitle: const Text('Publications, stories et communauté AllGo'),
            onTap: () => context.push(Routes.publish),
          ),
          ListTile(
            leading: const Icon(Icons.chat_bubble_outline),
            title: const Text('Messages'),
            onTap: () => context.push(Routes.messages),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: const Text('Notifications'),
            onTap: () => context.push(Routes.notifications),
          ),

          const Divider(),
          const _SectionTitle('Application'),

          // Le mode économie de données est en évidence, pas enfoui dans un
          // sous-menu : c'est la mesure de maîtrise du risque R7 (§20), et elle
          // ne sert à rien si personne ne la trouve.
          SwitchListTile(
            secondary: const Icon(Icons.data_saver_on),
            title: const Text('Économie de données'),
            subtitle:
                const Text('Images en basse résolution, aucun préchargement'),
            value: settings.dataSaver,
            onChanged: (value) => ref
                .read(settingsControllerProvider.notifier)
                .setDataSaver(enabled: value),
          ),

          const Divider(),
          const _SectionTitle('Notifications'),
          SwitchListTile(
            secondary: const Icon(Icons.notifications_outlined),
            title: const Text('Activer les notifications'),
            value: settings.pushEnabled,
            onChanged: (value) => ref
                .read(settingsControllerProvider.notifier)
                .setPushEnabled(enabled: value),
          ),
          for (final entry in const <(String, String)>[
            ('orders', 'Notifications commandes'),
            ('promotions', 'Notifications promotions'),
            ('social', 'Notifications sociales'),
            ('messages', 'Notifications messages'),
            ('delivery', 'Notifications livraison'),
          ])
            SwitchListTile(
              title: Text(entry.$2),
              contentPadding: const EdgeInsets.only(left: 56, right: 16),
              value: settings.notificationCategories[entry.$1] ?? true,
              onChanged: settings.pushEnabled
                  ? (value) => ref
                      .read(settingsControllerProvider.notifier)
                      .setNotificationCategory(entry.$1, enabled: value)
                  : null,
            ),

          ListTile(
            leading: const Icon(Icons.language),
            title: const Text('Langue'),
            subtitle: Text(
                settings.locale.languageCode == 'mg' ? 'Malagasy' : 'Français'),
            onTap: () => _chooseLocale(context, ref),
          ),

          ListTile(
            leading: const Icon(Icons.brightness_6_outlined),
            title: const Text('Thème'),
            subtitle: Text(
              switch (settings.themeMode) {
                ThemeMode.light => 'Clair',
                ThemeMode.dark => 'Sombre',
                ThemeMode.system => 'Selon le système',
              },
            ),
            onTap: () => _chooseTheme(context, ref),
          ),

          if (pending > 0)
            ListTile(
              leading: Icon(Icons.sync_problem,
                  color: Theme.of(context).colorScheme.tertiary),
              title: Text(
                  '$pending action${pending > 1 ? 's' : ''} en attente d’envoi'),
              subtitle:
                  const Text('Envoi automatique au retour de la connexion'),
            ),

          const Divider(),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('Politique de confidentialité'),
            // Accessible hors ligne (§12.3) : embarquée dans l'application,
            // jamais chargée depuis le réseau.
            onTap: () => context.push('/confidentialite'),
          ),

          const SizedBox(height: AllGoTokens.space4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
            child: OutlinedButton.icon(
              onPressed: () => _confirmSignOut(context, ref),
              icon: const Icon(Icons.logout),
              label: const Text('Se déconnecter'),
            ),
          ),
          const SizedBox(height: AllGoTokens.space3),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
            child: OutlinedButton.icon(
              onPressed: () => _confirmDeleteAccount(context, ref),
              style: OutlinedButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
                side: BorderSide(color: Theme.of(context).colorScheme.error),
              ),
              icon: const Icon(Icons.delete_forever_outlined),
              label: const Text('Supprimer mon compte'),
            ),
          ),
          const SizedBox(height: AllGoTokens.space8),
        ],
      ),
    );
  }

  Future<void> _chooseLocale(BuildContext context, WidgetRef ref) async {
    final locale = await showModalBottomSheet<Locale>(
      context: context,
      showDragHandle: true,
      builder: (context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          ListTile(
            title: const Text('Français'),
            onTap: () => Navigator.pop(context, const Locale('fr')),
          ),
          ListTile(
            title: const Text('Malagasy'),
            onTap: () => Navigator.pop(context, const Locale('mg')),
          ),
          const SizedBox(height: AllGoTokens.space4),
        ],
      ),
    );
    if (locale != null)
      ref.read(settingsControllerProvider.notifier).setLocale(locale);
  }

  Future<void> _chooseTheme(BuildContext context, WidgetRef ref) async {
    final mode = await showModalBottomSheet<ThemeMode>(
      context: context,
      showDragHandle: true,
      builder: (context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (final entry in const <(ThemeMode, String)>[
            (ThemeMode.system, 'Selon le système'),
            (ThemeMode.light, 'Clair'),
            (ThemeMode.dark, 'Sombre'),
          ])
            ListTile(
              title: Text(entry.$2),
              onTap: () => Navigator.pop(context, entry.$1),
            ),
          const SizedBox(height: AllGoTokens.space4),
        ],
      ),
    );
    if (mode != null)
      ref.read(settingsControllerProvider.notifier).setThemeMode(mode);
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref) async {
    final pending = ref.read(pendingActionCountProvider);

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Se déconnecter ?'),
        content: Text(
          pending > 0
              // La déconnexion purge le cache et les jetons (§12.2) : les
              // actions en attente seraient perdues. L'utilisateur doit le
              // savoir avant, pas le découvrir après.
              ? '$pending action${pending > 1 ? 's' : ''} n’a pas encore été envoyée '
                  'et sera définitivement perdue.'
              : 'Vos données enregistrées sur cet appareil seront effacées.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Se déconnecter'),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await ref.read(sessionControllerProvider.notifier).signOut();
      if (context.mounted) context.go('/');
    }
  }

  Future<void> _confirmDeleteAccount(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Supprimer mon compte ?'),
        content: const Text(
          'Cette action est irréversible. Votre profil sera anonymisé et vous '
          'serez déconnecté de tous vos appareils. Vos commandes passées restent '
          'visibles par les boutiques concernées, sans vos coordonnées.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Supprimer définitivement'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).delete<void>('/me');
      await ref.read(sessionControllerProvider.notifier).signOut();
      if (context.mounted) context.go('/');
    } on DioException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Impossible de supprimer le compte. Réessayez.')),
      );
    }
  }
}

class _ProfileSwitcher extends ConsumerWidget {
  const _ProfileSwitcher({required this.active, required this.roles});

  final ActiveProfile active;
  final List<String> roles;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final available = <ActiveProfile>[
      ActiveProfile.client,
      if (roles.any((r) => r.startsWith('shop_') && r != 'shop_courier'))
        ActiveProfile.merchant,
      if (roles.contains('shop_courier')) ActiveProfile.courier,
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
      child: SegmentedButton<ActiveProfile>(
        segments: available
            .map(
              (profile) => ButtonSegment<ActiveProfile>(
                value: profile,
                label: Text(
                  switch (profile) {
                    ActiveProfile.client => 'Client',
                    ActiveProfile.merchant => 'Commerçant',
                    ActiveProfile.courier => 'Livreur',
                  },
                ),
              ),
            )
            .toList(),
        selected: <ActiveProfile>{active},
        onSelectionChanged: (selection) => ref
            .read(sessionControllerProvider.notifier)
            .switchProfile(selection.first),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AllGoTokens.space4,
        AllGoTokens.space4,
        AllGoTokens.space4,
        AllGoTokens.space2,
      ),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
            ),
      ),
    );
  }
}
