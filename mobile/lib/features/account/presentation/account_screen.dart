import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/sync/sync_providers.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/settings/presentation/settings_controller.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:allgo/shared/widgets/confirm_dialog.dart';
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
    final l10n = AppL10n.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.navAccount)),
      body: ListView(
        children: <Widget>[
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person_outline)),
            title: Text(session.displayName ?? 'Utilisateur'),
            subtitle: Text(l10n.accountViewProfile),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(Routes.profile),
          ),

          // Sélecteur de profil — un commerçant reste un client sur AllGo (§11.2).
          if (session.canSwitchProfile) ...<Widget>[
            const Divider(),
            _SectionTitle(l10n.accountSwitchProfile),
            _ProfileSwitcher(
                active: session.activeProfile, roles: session.roles),
          ],

          const Divider(),
          _SectionTitle(l10n.sectionMyPurchases),
          ListTile(
            leading: const Icon(Icons.receipt_long_outlined),
            title: Text(l10n.navOrders),
            onTap: () => context.push('/commandes'),
          ),
          ListTile(
            leading: const Icon(Icons.location_on_outlined),
            title: Text(l10n.menuAddresses),
            onTap: () => context.push(Routes.addresses),
          ),
          ListTile(
            leading: const Icon(Icons.favorite_border),
            title: Text(l10n.menuFavorites),
            onTap: () => context.push(Routes.favorites),
          ),
          ListTile(
            leading: const Icon(Icons.block_outlined),
            title: Text(l10n.menuBlockedAccounts),
            onTap: () => context.push(Routes.blockedUsers),
          ),
          ListTile(
            leading: const Icon(Icons.gavel_outlined),
            title: Text(l10n.menuMySanctions),
            onTap: () => context.push(Routes.sanctions),
          ),
          ListTile(
            leading: const Icon(Icons.groups_outlined),
            title: Text(l10n.menuSocialNetwork),
            subtitle: Text(l10n.menuSocialNetworkSubtitle),
            onTap: () => context.push(Routes.publish),
          ),
          ListTile(
            leading: const Icon(Icons.chat_bubble_outline),
            title: Text(l10n.navMessages),
            onTap: () => context.push(Routes.messages),
          ),
          ListTile(
            leading: const Icon(Icons.notifications_outlined),
            title: Text(l10n.menuNotifications),
            onTap: () => context.push(Routes.notifications),
          ),

          // Modération plateforme — réservée au rôle `platform_admin` (§29).
          // Sans ce filtre, l'entrée serait visible de tout le monde alors que
          // chaque route de `/admin` exige déjà `platform:moderate` côté API :
          // l'inviter à taper dessus pour se voir refuser l'accès est pire que
          // de ne pas la montrer.
          if (session.roles.contains('platform_admin')) ...<Widget>[
            const Divider(),
            const _SectionTitle('Modération plateforme'),
            ListTile(
              leading: const Icon(Icons.shield_outlined),
              title: const Text('Administration'),
              subtitle: const Text('Utilisateurs, boutiques, produits, signalements'),
              onTap: () => context.push(Routes.admin),
            ),
            ListTile(
              leading: const Icon(Icons.dashboard_outlined),
              title: const Text('Dashboard global'),
              subtitle: const Text('Statistiques, croissance, performance'),
              onTap: () => context.push(Routes.adminDashboard),
            ),
            ListTile(
              leading: const Icon(Icons.account_balance_outlined),
              title: const Text('Administration financière'),
              subtitle: const Text('Transactions, commissions, retraits, factures'),
              onTap: () => context.push(Routes.adminFinance),
            ),
          ],

          const Divider(),
          _SectionTitle(l10n.sectionApplication),

          // Le mode économie de données est en évidence, pas enfoui dans un
          // sous-menu : c'est la mesure de maîtrise du risque R7 (§20), et elle
          // ne sert à rien si personne ne la trouve.
          SwitchListTile(
            secondary: const Icon(Icons.data_saver_on),
            title: Text(l10n.dataSaverTitle),
            subtitle: Text(l10n.dataSaverSubtitle),
            value: settings.dataSaver,
            onChanged: (value) => ref
                .read(settingsControllerProvider.notifier)
                .setDataSaver(enabled: value),
          ),

          const Divider(),
          _SectionTitle(l10n.sectionNotifications),
          SwitchListTile(
            secondary: const Icon(Icons.notifications_outlined),
            title: Text(l10n.toggleEnableNotifications),
            value: settings.pushEnabled,
            onChanged: (value) => ref
                .read(settingsControllerProvider.notifier)
                .setPushEnabled(enabled: value),
          ),
          for (final entry in <(String, String)>[
            ('orders', l10n.toggleOrderNotifications),
            ('promotions', l10n.togglePromoNotifications),
            ('social', l10n.toggleSocialNotifications),
            ('messages', l10n.toggleMessageNotifications),
            ('delivery', l10n.toggleDeliveryNotifications),
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
            title: Text(l10n.fieldLanguage),
            subtitle: Text(
                settings.locale.languageCode == 'mg' ? 'Malagasy' : 'Français'),
            onTap: () => _chooseLocale(context, ref),
          ),

          ListTile(
            leading: const Icon(Icons.brightness_6_outlined),
            title: Text(l10n.fieldTheme),
            subtitle: Text(
              switch (settings.themeMode) {
                ThemeMode.light => l10n.themeLight,
                ThemeMode.dark => l10n.themeDark,
                ThemeMode.system => l10n.themeSystem,
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
            title: Text(l10n.menuPrivacyPolicy),
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
              label: Text(l10n.actionSignOut),
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
              label: Text(l10n.actionDeleteAccount),
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
    final l10n = AppL10n.of(context);
    final mode = await showModalBottomSheet<ThemeMode>(
      context: context,
      showDragHandle: true,
      builder: (context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (final entry in <(ThemeMode, String)>[
            (ThemeMode.system, l10n.themeSystem),
            (ThemeMode.light, l10n.themeLight),
            (ThemeMode.dark, l10n.themeDark),
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

    final confirmed = await ConfirmDialog.show(
      context,
      icon: Icons.logout,
      title: 'Se déconnecter ?',
      message: pending > 0
          // La déconnexion purge le cache et les jetons (§12.2) : les
          // actions en attente seraient perdues. L'utilisateur doit le
          // savoir avant, pas le découvrir après.
          ? '$pending action${pending > 1 ? 's' : ''} n’a pas encore été envoyée '
              'et sera définitivement perdue.'
          : 'Vos données enregistrées sur cet appareil seront effacées.',
      confirmLabel: 'Se déconnecter',
    );

    if (confirmed ?? false) {
      await ref.read(sessionControllerProvider.notifier).signOut();
      if (context.mounted) context.go('/');
    }
  }

  Future<void> _confirmDeleteAccount(BuildContext context, WidgetRef ref) async {
    final confirmed = await ConfirmDialog.show(
      context,
      icon: Icons.delete_forever_outlined,
      title: 'Supprimer mon compte ?',
      message: 'Cette action est irréversible. Votre profil sera anonymisé et vous '
          'serez déconnecté de tous vos appareils. Vos commandes passées restent '
          'visibles par les boutiques concernées, sans vos coordonnées.',
      confirmLabel: 'Supprimer définitivement',
      isDestructive: true,
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
