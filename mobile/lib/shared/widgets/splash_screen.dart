import 'package:allgo/app/theme.dart';
import 'package:allgo/shared/widgets/allgo_logo.dart';
import 'package:flutter/material.dart';

/// Écran de démarrage — affiché tant que la session n'a pas fini de se
/// relire (`SessionState.isRestoring`), plutôt que de laisser transparaître
/// un instant l'écran d'accueil dans un état encore incertain (connecté ou
/// non) avant que le jeton stocké n'ait été vérifié.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with TickerProviderStateMixin {
  // Entrée : le logo apparaît en un seul geste (zoom + rebond léger), plutôt
  // que de surgir figé — c'est ce mouvement d'arrivée qui donne l'impression
  // d'une app qui démarre, pas d'une simple image statique.
  late final AnimationController _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..forward();

  late final Animation<double> _logoScale = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0, 0.7, curve: Curves.easeOutBack),
  );

  late final Animation<double> _logoOpacity = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0, 0.4, curve: Curves.easeOut),
  );

  // Le nom et l'indicateur arrivent juste après le logo, pas en même temps :
  // cette petite cascade lit comme une composition, pas comme un seul bloc
  // qui apparaît d'un coup.
  late final Animation<double> _wordmarkOpacity = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0.35, 0.75, curve: Curves.easeOut),
  );

  late final Animation<Offset> _wordmarkSlide = Tween<Offset>(
    begin: const Offset(0, 0.25),
    end: Offset.zero,
  ).animate(CurvedAnimation(
      parent: _entrance,
      curve: const Interval(0.35, 0.75, curve: Curves.easeOut)));

  late final Animation<double> _indicatorOpacity = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0.6, 1, curve: Curves.easeOut),
  );

  // Respiration continue, une fois l'entrée terminée : un halo qui pulse
  // doucement derrière le logo, pour que l'écran reste vivant tant que le
  // chargement se poursuit en arrière-plan.
  late final AnimationController _breath = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );

  late final Animation<double> _glow =
      Tween<double>(begin: 0.18, end: 0.38).animate(
    CurvedAnimation(parent: _breath, curve: Curves.easeInOut),
  );

  @override
  void initState() {
    super.initState();
    _entrance.addStatusListener((status) {
      if (status == AnimationStatus.completed) _breath.repeat(reverse: true);
    });
  }

  @override
  void dispose() {
    _entrance.dispose();
    _breath.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AllGoTokens.brand,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            AnimatedBuilder(
              animation: Listenable.merge(<Listenable>[_entrance, _breath]),
              builder: (context, child) => Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  boxShadow: <BoxShadow>[
                    BoxShadow(
                      color: Colors.white.withValues(alpha: _glow.value),
                      blurRadius: 48,
                      spreadRadius: 12,
                    ),
                  ],
                ),
                child: Opacity(
                  opacity: _logoOpacity.value,
                  child: Transform.scale(scale: _logoScale.value, child: child),
                ),
              ),
              child: const AllGoLogo(size: 96, showWordmark: false),
            ),
            const SizedBox(height: AllGoTokens.space4),
            SlideTransition(
              position: _wordmarkSlide,
              child: FadeTransition(
                opacity: _wordmarkOpacity,
                child: Text(
                  'AllGo',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.5,
                      ),
                ),
              ),
            ),
            const SizedBox(height: AllGoTokens.space8),
            FadeTransition(
              opacity: _indicatorOpacity,
              child: const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
