import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Destination d'onglet. Le `route` doit être enregistré dans `routerProvider`.
class NavDestination {
  const NavDestination(this.label, this.icon, this.selectedIcon, this.route);

  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final String route;
}

/// Barre de navigation inférieure — 5 onglets, **adaptés au rôle actif** (§11.2).
///
///   CLIENT     : Accueil · Explorer · Panier · Commandes · Compte
///   COMMERÇANT : Bord    · Commandes · Produits · Messages · Compte
///   LIVREUR    : Tournée · Carte    · Messages · Compte
///
/// Les onglets commerçant et livreur pointent vers des écrans d'attente jusqu'aux
/// lots L5 et L6 : une destination visible mais non enregistrée ferait planter
/// la navigation.
abstract final class ShellDestinations {
  static List<NavDestination> client(AppL10n l10n) => <NavDestination>[
        NavDestination(l10n.navHome, Icons.home_outlined, Icons.home, Routes.home),
        NavDestination(l10n.navExplore, Icons.search_outlined, Icons.search, Routes.explore),
        NavDestination(
          l10n.navCart,
          Icons.shopping_cart_outlined,
          Icons.shopping_cart,
          Routes.cart,
        ),
        NavDestination(
          l10n.navOrders,
          Icons.receipt_long_outlined,
          Icons.receipt_long,
          Routes.orders,
        ),
        NavDestination(l10n.navAccount, Icons.person_outline, Icons.person, Routes.account),
      ];

  static List<NavDestination> merchant(AppL10n l10n) => <NavDestination>[
        NavDestination(l10n.navDashboard, Icons.dashboard_outlined, Icons.dashboard, Routes.dashboard),
        NavDestination(
          l10n.navOrders,
          Icons.receipt_long_outlined,
          Icons.receipt_long,
          Routes.shopOrders,
        ),
        NavDestination(
          l10n.navProducts,
          Icons.inventory_2_outlined,
          Icons.inventory_2,
          Routes.shopProducts,
        ),
        NavDestination(l10n.navMessages, Icons.chat_bubble_outline, Icons.chat_bubble, Routes.messages),
        NavDestination(l10n.navAccount, Icons.person_outline, Icons.person, Routes.account),
      ];

  static List<NavDestination> courier(AppL10n l10n) => <NavDestination>[
        NavDestination(
          l10n.navRound,
          Icons.local_shipping_outlined,
          Icons.local_shipping,
          Routes.round,
        ),
        NavDestination(l10n.navMap, Icons.map_outlined, Icons.map, Routes.courierMap),
        NavDestination(l10n.navMessages, Icons.chat_bubble_outline, Icons.chat_bubble, Routes.messages),
        NavDestination(l10n.navAccount, Icons.person_outline, Icons.person, Routes.account),
      ];

  static List<NavDestination> forProfile(ActiveProfile profile, AppL10n l10n) => switch (profile) {
        ActiveProfile.client => client(l10n),
        ActiveProfile.merchant => merchant(l10n),
        ActiveProfile.courier => courier(l10n),
      };
}

class ShellScaffold extends ConsumerWidget {
  const ShellScaffold({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(sessionControllerProvider).activeProfile;
    final cartCount = ref.watch(cartCountProvider);

    final destinations = ShellDestinations.forProfile(profile, AppL10n.of(context));
    final location = GoRouterState.of(context).matchedLocation;

    // Le chemin le plus long l'emporte : sans ce tri, `/bord` correspondrait
    // aussi à `/bord/commandes` et surlignerait le mauvais onglet.
    final index = destinations.indexWhere(
      (d) => location == d.route || location.startsWith('${d.route}/'),
    );

    return Scaffold(
      body: child,
      bottomNavigationBar: _FloatingNavBar(
        destinations: destinations,
        selectedIndex: index < 0 ? 0 : index,
        cartCount: cartCount,
        onSelected: (i) => context.go(destinations[i].route),
      ),
    );
  }
}

/// Barre flottante détachée du bord de l'écran — l'onglet actif se déploie en
/// pastille pleine (icône + libellé), les autres restent de simples icônes.
/// Bien plus lisible qu'une rangée de cinq libellés identiques en permanence
/// (référence design des captures e-commerce), et l'animation de largeur rend
/// le changement d'onglet visible même du coin de l'œil.
class _FloatingNavBar extends StatelessWidget {
  const _FloatingNavBar({
    required this.destinations,
    required this.selectedIndex,
    required this.onSelected,
    required this.cartCount,
  });

  final List<NavDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final int cartCount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(28),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: scheme.shadow.withValues(alpha: 0.18),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          // Pas de parts égales : un onglet non sélectionné (icône seule) et
          // l'onglet actif (icône + libellé) n'ont pas la même largeur
          // naturelle. Les forcer dans des `Expanded` identiques est
          // exactement ce qui faisait déborder la pastille active de 26 px.
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: <Widget>[
            for (var i = 0; i < destinations.length; i++)
              _NavItem(
                destination: destinations[i],
                selected: i == selectedIndex,
                badgeCount:
                    destinations[i].route == Routes.cart ? cartCount : 0,
                onTap: () => onSelected(i),
              ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.destination,
    required this.selected,
    required this.onTap,
    this.badgeCount = 0,
  });

  final NavDestination destination;
  final bool selected;
  final VoidCallback onTap;
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final icon = Icon(
      selected ? destination.selectedIcon : destination.icon,
      color: selected ? Colors.white : scheme.onSurfaceVariant,
      size: 22,
    );

    return Semantics(
      // Libellé sémantique sur chaque élément interactif (§11.4) : un
      // libellé masqué visuellement à l'état non sélectionné doit rester
      // annoncé par un lecteur d'écran.
      label: destination.label,
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeOutCubic,
          padding: EdgeInsets.symmetric(
              horizontal: selected ? 16 : 10, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? AllGoTokens.brand : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              badgeCount > 0
                  ? Badge.count(count: badgeCount, child: icon)
                  : icon,
              AnimatedSize(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                child: selected
                    ? Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Text(
                          destination.label,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                      )
                    : const SizedBox(height: 22),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
