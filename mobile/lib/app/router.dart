import 'package:allgo/features/account/presentation/account_screen.dart';
import 'package:allgo/features/account/presentation/addresses_screen.dart';
import 'package:allgo/features/account/presentation/profile_screen.dart';
import 'package:allgo/features/auth/presentation/forgot_password_screen.dart';
import 'package:allgo/features/auth/presentation/login_screen.dart';
import 'package:allgo/features/auth/presentation/otp_screen.dart';
import 'package:allgo/features/auth/presentation/register_screen.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/auth/presentation/token_action_screen.dart';
import 'package:allgo/features/cart/presentation/cart_screen.dart';
import 'package:allgo/features/cart/presentation/checkout_screen.dart';
import 'package:allgo/features/catalog/presentation/explore_screen.dart';
import 'package:allgo/features/catalog/presentation/product_detail_screen.dart';
import 'package:allgo/features/geo/presentation/map_screen.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/features/home/presentation/shell_scaffold.dart';
import 'package:allgo/features/messaging/presentation/chat_screen.dart';
import 'package:allgo/features/messaging/presentation/messages_list_screen.dart';
import 'package:allgo/features/orders/presentation/order_detail_screen.dart';
import 'package:allgo/features/orders/presentation/orders_screen.dart';
import 'package:allgo/features/shops/presentation/shop_screen.dart';
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
  static const String checkout = '/panier/livraison';
  static const String publish = '/publier';
  static const String messages = '/messages';
  static const String messageDetail = '/messages/:conversationId';
  static const String privacy = '/confidentialite';

  // --- Onglets commerçant (lot L5) ---
  static const String dashboard = '/bord';
  static const String shopOrders = '/bord/commandes';
  static const String shopProducts = '/bord/produits';

  // --- Onglets livreur (lot L6) ---
  static const String round = '/tournee';

  static String productPath(String id) => '/produit/$id';
  static String orderPath(String id) => '/commandes/$id';
  static String shopPath(String slug) => '/boutique/$slug';
  static String messagePath(String conversationId) => '/messages/$conversationId';

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
    checkout,
    publish,
    messages,
    messageDetail,
    privacy,
    dashboard,
    shopOrders,
    shopProducts,
    round,
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
  Routes.account,
  Routes.messages,
  Routes.dashboard,
  Routes.round,
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

      final needsAuth = _protectedPrefixes.any(state.matchedLocation.startsWith);
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
        builder: (context, state) => LoginScreen(redirectTo: state.uri.queryParameters['redirect']),
      ),
      GoRoute(path: Routes.register, builder: (context, state) => const RegisterScreen()),
      GoRoute(
        path: Routes.otp,
        builder: (context, state) => OtpScreen(redirectTo: state.uri.queryParameters['redirect']),
      ),
      GoRoute(
        path: Routes.forgotPassword,
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: '/verification-email',
        builder: (context, state) => EmailVerificationScreen(
          token: state.uri.queryParameters['token'] ?? '',
        ),
      ),
      GoRoute(
        path: '/reinitialisation-mot-de-passe',
        builder: (context, state) => ResetPasswordScreen(
          token: state.uri.queryParameters['token'] ?? '',
        ),
      ),

      // --- Écrans empilés, hors coquille : ils occupent tout l'écran et
      //     masquent la barre de navigation (carte, fiche produit, tunnel). ---
      GoRoute(
        path: Routes.product,
        parentNavigatorKey: rootKey,
        builder: (context, state) => ProductDetailScreen(productId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: Routes.map,
        parentNavigatorKey: rootKey,
        builder: (context, state) =>
            MapScreen(focus: state.extra as ({double latitude, double longitude})?),
      ),
      GoRoute(
        path: Routes.checkout,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const CheckoutScreen(),
      ),
      GoRoute(
        path: Routes.shop,
        parentNavigatorKey: rootKey,
        builder: (context, state) => ShopScreen(slug: state.pathParameters['slug']!),
      ),
      GoRoute(
        path: Routes.publish,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const ComingSoonScreen(
          title: 'Publier',
          lot: 'L3 — Social',
          detail: 'Publication depuis l’appareil photo, avec compression avant envoi.',
        ),
      ),
      GoRoute(
        path: Routes.messages,
        parentNavigatorKey: rootKey,
        builder: (context, state) => const MessagesListScreen(),
      ),
      GoRoute(
        path: Routes.messageDetail,
        parentNavigatorKey: rootKey,
        builder: (context, state) => ChatScreen(
          conversationId: state.pathParameters['conversationId']!,
          title: state.extra as String?,
        ),
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

      // --- Coquille persistante : la barre de navigation ne se reconstruit pas
      //     d'un onglet à l'autre. ---
      ShellRoute(
        navigatorKey: shellKey,
        builder: (context, state, child) => ShellScaffold(child: child),
        routes: <RouteBase>[
          GoRoute(path: Routes.home, builder: (_, __) => const HomeScreen()),
          GoRoute(path: Routes.explore, builder: (_, __) => const ExploreScreen()),
          GoRoute(path: Routes.cart, builder: (_, __) => const CartScreen()),
          GoRoute(
            path: Routes.orders,
            builder: (_, __) => const OrdersScreen(),
            routes: <RouteBase>[
              GoRoute(
                path: ':id',
                builder: (context, state) => OrderDetailScreen(
                  orderId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(path: Routes.account, builder: (_, __) => const AccountScreen()),
          GoRoute(
            path: '/compte/profil',
            builder: (_, __) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/compte/adresses',
            builder: (_, __) => const AddressesScreen(),
          ),

          // Onglets commerçant — lot L5.
          GoRoute(
            path: Routes.dashboard,
            builder: (_, __) => const ComingSoonScreen(
              title: 'Tableau de bord',
              lot: 'L5 — Commerçant',
            ),
          ),
          GoRoute(
            path: Routes.shopOrders,
            builder: (_, __) => const ComingSoonScreen(
              title: 'Commandes à traiter',
              lot: 'L5 — Commerçant',
            ),
          ),
          GoRoute(
            path: Routes.shopProducts,
            builder: (_, __) => const ComingSoonScreen(
              title: 'Produits et stock',
              lot: 'L5 — Commerçant',
              detail: 'Mouvements de stock avec scan de code-barres, alertes de seuil.',
            ),
          ),

          // Onglet livreur — lot L6.
          GoRoute(
            path: Routes.round,
            builder: (_, __) => const ComingSoonScreen(
              title: 'Tournée du jour',
              lot: 'L6 — Livreur',
              detail: 'Navigation GPS, suivi en direct, preuve de livraison photo.',
            ),
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
              Text('Page introuvable : ${state.uri}', textAlign: TextAlign.center),
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
