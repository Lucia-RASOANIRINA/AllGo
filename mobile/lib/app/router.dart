import 'package:allgo/features/account/presentation/account_screen.dart';
import 'package:allgo/features/auth/presentation/forgot_password_screen.dart';
import 'package:allgo/features/auth/presentation/login_screen.dart';
import 'package:allgo/features/auth/presentation/otp_screen.dart';
import 'package:allgo/features/auth/presentation/register_screen.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_screen.dart';
import 'package:allgo/features/cart/presentation/checkout_screen.dart';
import 'package:allgo/features/catalog/presentation/explore_screen.dart';
import 'package:allgo/features/catalog/presentation/product_detail_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_products_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_orders_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_promotions_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_team_screen.dart';
import 'package:allgo/features/delivery/presentation/delivery_screen.dart';
import 'package:allgo/features/delivery/presentation/courier_dashboard_screen.dart';
import 'package:allgo/features/delivery/presentation/courier_earnings_screen.dart';
import 'package:allgo/features/admin/presentation/admin_dashboard_screen.dart';
import 'package:allgo/features/admin/presentation/admin_stats_screen.dart';
import 'package:allgo/features/admin/presentation/finance_admin_screen.dart';
import 'package:allgo/features/finance/presentation/merchant_withdrawals_screen.dart';
import 'package:allgo/features/favorites/presentation/favorites_screen.dart';
import 'package:allgo/features/geo/presentation/map_screen.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/features/home/presentation/shell_scaffold.dart';
import 'package:allgo/features/messaging/presentation/messages_list_screen.dart';
import 'package:allgo/features/messaging/presentation/chat_screen.dart';
import 'package:allgo/features/moderation/presentation/blocked_users_screen.dart';
import 'package:allgo/features/moderation/presentation/sanctions_screen.dart';
import 'package:allgo/features/merchant/presentation/merchant_dashboard_screen.dart';
import 'package:allgo/features/notifications/presentation/notifications_screen.dart';
import 'package:allgo/features/orders/presentation/order_detail_screen.dart';
import 'package:allgo/features/orders/presentation/orders_screen.dart';
import 'package:allgo/features/shops/presentation/shop_screen.dart';
import 'package:allgo/features/social/presentation/social_feed_screen.dart';
import 'package:allgo/features/stories/presentation/stories_screen.dart';
import 'package:allgo/shared/widgets/coming_soon_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Chemins de l'application.
///
/// **Invariant** : tout chemin nommé ici est enregistré dans `routerProvider`.
/// Une destination déclarée mais non enregistrée ne produit pas un écran vide —
/// elle fait planter la navigation. Le test `router_test.dart` vérifie que
/// chaque constante résout bien vers un écran.
///
/// Les liens profonds des notifications push s'appuient sur ces chemins
/// (§10.2) : chaque notification ouvre directement l'écran concerné.
abstract final class Routes {
  // --- Onglets client ---
  static const String home = '/';
  static const String explore = '/explorer';
  static const String cart = '/panier';
  static const String orders = '/commandes';
  static const String account = '/compte';

  // --- Écrans empilés ---
  static const String login = '/connexion';
  static const String register = '/inscription';
  static const String otp = '/connexion/sms';
  static const String forgotPassword = '/connexion/mot-de-passe-oublie';
  static const String product = '/produit/:id';
  static const String shop = '/boutique/:slug';
  static const String orderDetail = '/commandes/:id';
  static const String map = '/carte';
  static const String tracking = '/suivi';
  static const String checkout = '/panier/livraison';
  static const String favorites = '/compte/favoris';
  static const String sanctions = '/compte/sanctions';
  static const String blockedUsers = '/compte/comptes-bloques';
  static const String publish = '/publier';
  static const String stories = '/stories';
  static const String messages = '/messages';
  static const String message = '/messages/:id';
  static const String notifications = '/notifications';
  static const String privacy = '/confidentialite';

  // --- Onglets commerçant (lot L5) ---
  static const String dashboard = '/bord';
  static const String shopOrders = '/bord/commandes';
  static const String shopProducts = '/bord/produits';
  static const String shopPromotions = '/bord/promotions';
  static const String shopTeam = '/bord/equipe';

  // --- Onglets livreur (lot L6) ---
  static const String round = '/tournee';
  static const String courier = '/livreur';
  static const String courierEarnings = '/livreur/revenus';
  static const String admin = '/admin';
  static const String adminDashboard = '/admin/dashboard';
  static const String adminFinance = '/admin/finances';
  static const String merchantWithdrawals = '/bord/retraits';

  static String productPath(String id) => '/produit/$id';
  static String orderPath(String id) => '/commandes/$id';
  static String shopPath(String slug) => '/boutique/$slug';
  static String messagePath(String id) => '/messages/$id';

  /// Tous les chemins déclarés — vérifiés un à un par `router_test.dart`.
  ///
  /// Cette liste rend l'invariant testable : Dart n'offre aucune introspection
  /// des membres statiques à l'exécution, il faut donc l'énumérer. Ajouter une
  /// constante sans l'ajouter ici ferait passer le test à tort, mais oublier
  /// d'enregistrer une route présente ici le fait échouer — c'est le sens de
  /// l'échec qui compte.
  static const List<String> all = <String>[
    home,
    explore,
    cart,
    orders,
    account,
    login,
    register,
    otp,
    forgotPassword,
    product,
    shop,
    orderDetail,
    map,
    tracking,
    checkout,
    favorites,
    sanctions,
    blockedUsers,
    publish,
    stories,
    messages,
    message,
    notifications,
    privacy,
    dashboard,
    shopOrders,
    shopProducts,
    shopPromotions,
    shopTeam,
    round,
    courier,
    courierEarnings,
    admin,
    adminDashboard,
    adminFinance,
    merchantWithdrawals,
  ];
}

/// Chemins exigeant une session ouverte.
///
/// La découverte reste ouverte sans compte : exiger une inscription pour
/// consulter un catalogue ferait fuir l'essentiel des visiteurs. Seuls le
/// panier, les commandes, la messagerie et le compte sont protégés.
const _protectedPrefixes = <String>[
  Routes.cart,
  Routes.orders,
  Routes.tracking,
  Routes.account,
  Routes.favorites,
  Routes.publish,
  Routes.stories,
  Routes.messages,
  Routes.notifications,
  Routes.dashboard,
  Routes.round,
  Routes.courier,
  Routes.courierEarnings,
  Routes.admin,
];

final routerProvider = Provider<GoRouter>((ref) {
  final session = ref.watch(sessionControllerProvider);
  final rootKey = GlobalKey<NavigatorState>();
  final shellKey = GlobalKey<NavigatorState>();

  return GoRouter(
    navigatorKey: rootKey,
    initialLocation: Routes.home,
    redirect: (context, state) {
      // Tant que les jetons ne sont pas relus, on ne redirige pas : renvoyer un
      // utilisateur connecté vers l'écran de connexion au démarrage est le
      // défaut le plus visible d'une garde mal ordonnée.
      if (session.isRestoring) return null;

      final needsAuth =
          _protectedPrefixes.any(state.matchedLocation.startsWith);
      if (needsAuth && !session.isAuthenticated) {
        return '${Routes.login}?redirect=${Uri.encodeComponent(state.matchedLocation)}';
      }
      if (state.matchedLocation == Routes.login && session.isAuthenticated) {
        return Routes.home;
      }
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: Routes.login,
        builder: (context, state) =>
            LoginScreen(redirectTo: state.uri.queryParameters['redirect']),
      ),
      GoRoute(
          path: Routes.register,
          builder: (context, state) => const RegisterScreen()),
      GoRoute(
        path: Routes.otp,
        builder: (context, state) =>
            OtpScreen(redirectTo: state.uri.queryParameters['redirect']),
      ),
      GoRoute(
        path: Routes.forgotPassword,
        builder: (context, state) => const ForgotPasswordScreen(),
      ),

      // --- Écrans empilés, hors coquille : ils occupent tout l'écran et
      //     masquent la barre de navigation (carte, fiche produit, tunnel). ---
      GoRoute(
        path: Routes.product,
        parentNavigatorKey: rootKey,
        builder: (context, state) =>
            ProductDetailScreen(productId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: Routes.map,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const MapScreen(),
      ),
      GoRoute(
        path: Routes.tracking,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const DeliveryScreen(),
      ),
      GoRoute(
        path: Routes.checkout,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const CheckoutScreen(),
      ),
      GoRoute(
        path: Routes.favorites,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const FavoritesScreen(),
      ),
      GoRoute(
        path: Routes.sanctions,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const SanctionsScreen(),
      ),
      GoRoute(
        path: Routes.blockedUsers,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const BlockedUsersScreen(),
      ),
      GoRoute(
        path: Routes.shop,
        parentNavigatorKey: rootKey,
        builder: (context, state) =>
            ShopScreen(slug: state.pathParameters['slug']!),
      ),
      GoRoute(
        path: Routes.publish,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const SocialFeedScreen(),
      ),
      GoRoute(
        path: Routes.stories,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const StoriesScreen(),
      ),
      GoRoute(
        path: Routes.messages,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const MessagesListScreen(),
      ),
      GoRoute(
        path: Routes.message,
        parentNavigatorKey: rootKey,
        builder: (context, state) => ChatScreen(
          conversationId: state.pathParameters['id']!,
          title: state.extra as String?,
        ),
      ),
      GoRoute(
        path: Routes.notifications,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: Routes.privacy,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const ComingSoonScreen(
          title: 'Confidentialité',
          lot: 'L0 — Socle',
          detail: 'Texte embarqué dans l’application, consultable hors ligne.',
        ),
      ),
      GoRoute(
        path: Routes.merchantWithdrawals,
        parentNavigatorKey: rootKey,
        builder: (context, state) => MerchantWithdrawalsScreen(shopId: state.extra as String? ?? ''),
      ),

      // --- Coquille persistante : la barre de navigation ne se reconstruit pas
      //     d'un onglet à l'autre. ---
      ShellRoute(
        navigatorKey: shellKey,
        builder: (context, state, child) => ShellScaffold(child: child),
        routes: <RouteBase>[
          GoRoute(path: Routes.home, builder: (_, __) => const HomeScreen()),
          GoRoute(
              path: Routes.explore, builder: (_, __) => const ExploreScreen()),
          GoRoute(path: Routes.cart, builder: (_, __) => const CartScreen()),
          GoRoute(
            path: Routes.orders,
            builder: (_, __) => const OrdersScreen(),
            routes: <RouteBase>[
              GoRoute(
                path: ':id',
                parentNavigatorKey: rootKey,
                builder: (context, state) => OrderDetailScreen(
                  orderId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(
              path: Routes.account, builder: (_, __) => const AccountScreen()),

          // Onglets commerçant — lot L5.
          GoRoute(
            path: Routes.dashboard,
            builder: (_, __) => const MerchantDashboardScreen(),
          ),
          GoRoute(
            path: Routes.shopOrders,
            builder: (_, __) => const MerchantOrdersScreen(),
          ),
          GoRoute(
            path: Routes.shopProducts,
            builder: (_, __) => const MerchantProductsScreen(),
          ),
          GoRoute(
            path: Routes.shopPromotions,
            builder: (_, __) => const MerchantPromotionsScreen(),
          ),
          GoRoute(
            path: Routes.shopTeam,
            builder: (_, __) => const MerchantTeamScreen(),
          ),

          // Onglet livreur — lot L6.
          GoRoute(
            path: Routes.round,
            builder: (_, __) => const CourierDashboardScreen(),
          ),
          GoRoute(
            path: Routes.admin,
            builder: (context, state) => const AdminDashboardScreen(),
          ),
          GoRoute(
            path: Routes.adminDashboard,
            builder: (context, state) => const AdminStatsScreen(),
          ),
          GoRoute(
            path: Routes.adminFinance,
            builder: (context, state) => const FinanceAdminScreen(),
          ),
          GoRoute(
            path: Routes.courierEarnings,
            builder: (context, state) => const CourierEarningsScreen(),
          ),
          GoRoute(
            path: Routes.courier,
            builder: (_, __) => const CourierDashboardScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Icon(Icons.explore_off_outlined, size: 56),
              const SizedBox(height: 16),
              Text('Page introuvable : ${state.uri}',
                  textAlign: TextAlign.center),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => context.go(Routes.home),
                child: const Text('Retour à l’accueil'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
});
