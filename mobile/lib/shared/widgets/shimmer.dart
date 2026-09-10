import 'package:allgo/app/theme.dart';
import 'package:flutter/material.dart';

/// Enveloppe tout squelette d'un balayage lumineux en boucle — la seule
/// différence entre un squelette qui a l'air « en cours de chargement » et un
/// squelette qui a juste l'air cassé (§11.3, « squelettes animés »).
class Shimmer extends StatefulWidget {
  const Shimmer({required this.child, super.key});

  final Widget child;

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.surfaceContainerHighest;
    final highlight = Theme.of(context).colorScheme.surface;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) => ShaderMask(
        blendMode: BlendMode.srcATop,
        shaderCallback: (bounds) => LinearGradient(
          colors: <Color>[base, highlight, base],
          stops: const <double>[0.35, 0.5, 0.65],
          transform: _SlidingGradientTransform(_controller.value),
        ).createShader(bounds),
        child: child,
      ),
      child: widget.child,
    );
  }
}

class _SlidingGradientTransform extends GradientTransform {
  const _SlidingGradientTransform(this.progress);

  /// 0 → 1, un aller simple ; le dégradé démarre hors cadre à gauche et sort
  /// hors cadre à droite, d'où la plage [-1, 1] plutôt que [0, 1].
  final double progress;

  @override
  Matrix4? transform(Rect bounds, {TextDirection? textDirection}) {
    return Matrix4.translationValues(bounds.width * (progress * 2 - 1), 0, 0);
  }
}

/// Un rectangle uni, à l'échelle du contexte (texte, avatar, image…) — brique
/// de base de tout squelette, toujours enveloppée dans un [Shimmer] par son
/// parent plutôt qu'individuellement, pour que le balayage traverse toute la
/// carte d'un même mouvement plutôt que bloc par bloc.
class SkeletonBox extends StatelessWidget {
  const SkeletonBox({
    required this.width,
    required this.height,
    this.borderRadius,
    this.shape = BoxShape.rectangle,
    super.key,
  });

  const SkeletonBox.circle(double size, {super.key})
      : width = size,
        height = size,
        borderRadius = null,
        shape = BoxShape.circle;

  final double width;
  final double height;
  final BorderRadius? borderRadius;
  final BoxShape shape;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        shape: shape,
        borderRadius: shape == BoxShape.rectangle
            ? (borderRadius ?? BorderRadius.circular(AllGoTokens.radiusCard))
            : null,
      ),
    );
  }
}

/// Squelette d'une ligne à avatar — boutique, contact, membre d'équipe :
/// partout où le contenu réel est « rond à gauche, deux lignes de texte à
/// droite ». `itemCount` lignes empilées, un seul balayage lumineux commun.
class AvatarLineSkeletonList extends StatelessWidget {
  const AvatarLineSkeletonList({this.itemCount = 6, this.padding, super.key});

  final int itemCount;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        padding: padding ?? const EdgeInsets.all(AllGoTokens.space4),
        itemCount: itemCount,
        separatorBuilder: (_, __) => const SizedBox(height: AllGoTokens.space3),
        itemBuilder: (_, __) => const _AvatarLineRow(),
      ),
    );
  }
}

class _AvatarLineRow extends StatelessWidget {
  const _AvatarLineRow();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AllGoTokens.space3),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
      ),
      child: Row(
        children: <Widget>[
          const SkeletonBox.circle(48),
          const SizedBox(width: AllGoTokens.space3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const SkeletonBox(width: double.infinity, height: 14),
                const SizedBox(height: AllGoTokens.space2),
                SkeletonBox(width: MediaQuery.sizeOf(context).width * 0.4, height: 12),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Squelette d'un rail horizontal de cartes — fil d'accueil, résultats
/// produits : image pleine largeur en haut, deux lignes de texte en bas.
class CardRailSkeleton extends StatelessWidget {
  const CardRailSkeleton({
    this.itemCount = 4,
    this.cardWidth = 160,
    this.height = 220,
    super.key,
  });

  final int itemCount;
  final double cardWidth;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: SizedBox(
        height: height,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
          itemCount: itemCount,
          separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
          itemBuilder: (_, __) => SizedBox(
            width: cardWidth,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(child: SkeletonBox(width: cardWidth, height: height)),
                const SizedBox(height: AllGoTokens.space2),
                SkeletonBox(width: cardWidth * 0.8, height: 12),
                const SizedBox(height: AllGoTokens.space1),
                SkeletonBox(width: cardWidth * 0.5, height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Squelette d'un rail horizontal à avatars ronds — boutiques populaires ou
/// proches, sur l'accueil comme sur la carte.
class CircleRailSkeleton extends StatelessWidget {
  const CircleRailSkeleton({this.itemCount = 5, this.height = 130, super.key});

  final int itemCount;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: SizedBox(
        height: height,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
          itemCount: itemCount,
          separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space3),
          itemBuilder: (_, __) => const SizedBox(
            width: 120,
            child: Column(
              children: <Widget>[
                SkeletonBox.circle(64),
                SizedBox(height: AllGoTokens.space2),
                SkeletonBox(width: 80, height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Squelette d'une grille de cartes — catalogue produit, résultats de
/// recherche. `maxCrossAxisExtent`/`childAspectRatio` doivent reprendre ceux
/// de la grille réelle pour que le nombre de colonnes ne saute pas à l'arrivée
/// des données.
class CardGridSkeleton extends StatelessWidget {
  const CardGridSkeleton({
    this.itemCount = 6,
    this.maxCrossAxisExtent = 220,
    this.childAspectRatio = 0.72,
    this.padding = const EdgeInsets.all(AllGoTokens.space4),
    super.key,
  });

  final int itemCount;
  final double maxCrossAxisExtent;
  final double childAspectRatio;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: GridView.builder(
        padding: padding,
        gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: maxCrossAxisExtent,
          mainAxisSpacing: AllGoTokens.space3,
          crossAxisSpacing: AllGoTokens.space3,
          childAspectRatio: childAspectRatio,
        ),
        itemCount: itemCount,
        itemBuilder: (_, __) => const SkeletonBox(width: double.infinity, height: double.infinity),
      ),
    );
  }
}

/// Squelette d'un fil de publications — auteur, puis bloc média, puis ligne
/// de texte, comme une vraie carte du fil social.
class FeedPostSkeletonList extends StatelessWidget {
  const FeedPostSkeletonList({this.itemCount = 3, super.key});

  final int itemCount;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        itemCount: itemCount,
        separatorBuilder: (_, __) => const SizedBox(height: AllGoTokens.space4),
        itemBuilder: (_, __) => const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                SkeletonBox.circle(40),
                SizedBox(width: AllGoTokens.space2),
                SkeletonBox(width: 120, height: 14),
              ],
            ),
            SizedBox(height: AllGoTokens.space3),
            SkeletonBox(width: double.infinity, height: 220),
            SizedBox(height: AllGoTokens.space2),
            SkeletonBox(width: double.infinity, height: 12),
          ],
        ),
      ),
    );
  }
}

/// Squelette d'un formulaire de profil — avatar centré puis champs empilés
/// (profil personnel, fiche boutique éditable…).
class FormSkeleton extends StatelessWidget {
  const FormSkeleton({this.fieldCount = 4, super.key});

  final int fieldCount;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView(
        padding: const EdgeInsets.all(AllGoTokens.space4),
        children: <Widget>[
          const Center(child: SkeletonBox.circle(96)),
          const SizedBox(height: AllGoTokens.space6),
          for (var i = 0; i < fieldCount; i++) ...<Widget>[
            const SkeletonBox(width: 100, height: 12),
            const SizedBox(height: AllGoTokens.space2),
            const SkeletonBox(width: double.infinity, height: 48),
            const SizedBox(height: AllGoTokens.space4),
          ],
        ],
      ),
    );
  }
}

/// Squelette d'une conversation — bulles alternées gauche/droite, largeur
/// variable pour ne pas avoir l'air d'une grille régulière.
class ChatBubbleSkeleton extends StatelessWidget {
  const ChatBubbleSkeleton({this.itemCount = 8, super.key});

  final int itemCount;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        reverse: true,
        padding: const EdgeInsets.all(AllGoTokens.space4),
        itemCount: itemCount,
        separatorBuilder: (_, __) => const SizedBox(height: AllGoTokens.space3),
        itemBuilder: (_, i) {
          final fromMe = i.isEven;
          final width = 120.0 + (i * 37) % 120;
          return Align(
            alignment: fromMe ? Alignment.centerRight : Alignment.centerLeft,
            child: SkeletonBox(
              width: width,
              height: 40,
              borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
            ),
          );
        },
      ),
    );
  }
}

/// Squelette d'un rail horizontal de puces (catégories, filtres rapides).
class ChipRailSkeleton extends StatelessWidget {
  const ChipRailSkeleton({this.itemCount = 5, super.key});

  final int itemCount;

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: SizedBox(
        height: 40,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
          itemCount: itemCount,
          separatorBuilder: (_, __) => const SizedBox(width: AllGoTokens.space2),
          itemBuilder: (_, __) => SkeletonBox(
            width: 90,
            height: 40,
            borderRadius: BorderRadius.circular(AllGoTokens.radiusPill),
          ),
        ),
      ),
    );
  }
}
