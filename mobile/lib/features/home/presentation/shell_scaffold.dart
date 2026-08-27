import 'package:allgo/app/router.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
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
  static const client = <NavDestination>[
    NavDestination('Accueil', Icons.home_outlined, Icons.home, Routes.home),
    NavDestination('Explorer', Icons.search_outlined, Icons.search, Routes.explore),
    NavDestination('Panier', Icons.shopping_cart_outlined, Icons.shopping_cart, Routes.cart),
    NavDestination('Commandes', Icons.receipt_long_outlined, Icons.receipt_long, Routes.orders),
    NavDestination('Compte', Icons.person_outline, Icons.person, Routes.account),
  ];

  static const merchant = <NavDestination>[
    NavDestination('Bord', Icons.dashboard_outlined, Icons.dashboard, Routes.dashboard),
    NavDestination('Commandes', Icons.receipt_long_outlined, Icons.receipt_long, Routes.shopOrders),
    NavDestination('Produits', Icons.inventory_2_outlined, Icons.inventory_2, Routes.shopProducts),
    NavDestination('Messages', Icons.chat_bubble_outline, Icons.chat_bubble, Routes.messages),
    NavDestination('Compte', Icons.person_outline, Icons.person, Routes.account),
  ];

  static const courier = <NavDestination>[
    NavDestination('Tournée', Icons.local_shipping_outlined, Icons.local_shipping, Routes.round),
    NavDestination('Carte', Icons.map_outlined, Icons.map, Routes.map),
    NavDestination('Messages', Icons.chat_bubble_outline, Icons.chat_bubble, Routes.messages),
    NavDestination('Compte', Icons.person_outline, Icons.person, Routes.account),
  ];

  static List<NavDestination> forProfile(ActiveProfile profile) => switch (profile) {
        ActiveProfile.client => client,
        ActiveProfile.merchant => merchant,
        ActiveProfile.courier => courier,
      };
}

class ShellScaffold extends ConsumerWidget {
  const ShellScaffold({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(sessionControllerProvider).activeProfile;
    final cartCount = ref.watch(cartCountProvider);

    final destinations = ShellDestinations.forProfile(profile);
    final location = GoRouterState.of(context).matchedLocation;

    // Le chemin le plus long l'emporte : sans ce tri, `/bord` correspondrait
    // aussi à `/bord/commandes` et surlignerait le mauvais onglet.
    final index = destinations.indexWhere(
      (d) => location == d.route || location.startsWith('${d.route}/'),
    );

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index < 0 ? 0 : index,
        onDestinationSelected: (i) => context.go(destinations[i].route),
        destinations: destinations.map((d) {
          final icon = Icon(d.icon);

          return NavigationDestination(
            icon: d.route == Routes.cart && cartCount > 0
                ? Badge.count(count: cartCount, child: icon)
                : icon,
            selectedIcon: Icon(d.selectedIcon),
            // Libellé sémantique sur chaque élément interactif (§11.4) : sans
            // lui, TalkBack annonce « bouton » et rien d'autre.
            label: d.label,
            tooltip: d.label,
          );
        }).toList(),
      ),
    );
  }
}
