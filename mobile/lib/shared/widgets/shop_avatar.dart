import 'package:allgo/app/theme.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Icône représentative par catégorie — une boutique de mode et une épicerie
/// ne doivent pas se ressembler juste parce qu'aucune des deux n'a encore de
/// logo. Les clés correspondent aux catégories du catalogue (§ seed) ; une
/// catégorie absente de cette liste retombe sur `storefront_outlined`, jamais
/// sur une erreur.
const Map<String, IconData> _categoryIcons = <String, IconData>{
  'alimentation': Icons.restaurant_outlined,
  'épicerie': Icons.shopping_basket_outlined,
  'epicerie': Icons.shopping_basket_outlined,
  'boissons': Icons.local_drink_outlined,
  'mode et vêtements': Icons.checkroom_outlined,
  'mode et vetements': Icons.checkroom_outlined,
  'vêtements': Icons.checkroom_outlined,
  'beauté': Icons.spa_outlined,
  'beaute': Icons.spa_outlined,
  'cosmétique': Icons.spa_outlined,
  'électronique': Icons.devices_outlined,
  'electronique': Icons.devices_outlined,
  'high-tech': Icons.devices_outlined,
  'maison': Icons.chair_outlined,
  'décoration': Icons.chair_outlined,
  'bricolage': Icons.handyman_outlined,
  'santé': Icons.medical_services_outlined,
  'pharmacie': Icons.medical_services_outlined,
  'restauration': Icons.restaurant_outlined,
  'services': Icons.build_outlined,
  'sport': Icons.sports_soccer_outlined,
  'enfants': Icons.child_care_outlined,
  'bébé': Icons.child_care_outlined,
  'librairie': Icons.menu_book_outlined,
  'papeterie': Icons.menu_book_outlined,
  'fleurs': Icons.local_florist_outlined,
  'auto': Icons.directions_car_filled_outlined,
  'moto': Icons.two_wheeler_outlined,
};

/// Palette de couleurs de secours — dérivée du nom de la boutique, donc
/// stable d'un affichage à l'autre, mais suffisamment variée pour que deux
/// boutiques sans logo restent visuellement distinguables dans une liste.
const List<Color> _palette = <Color>[
  AllGoTokens.brand,
  Color(0xFF6D4C41),
  Color(0xFF1E88E5),
  Color(0xFFD81B60),
  Color(0xFF8E24AA),
  Color(0xFFF4511E),
  Color(0xFF00897B),
  Color(0xFF546E7A),
];

/// Avatar de boutique — vraie photo si `logoUrl` est renseigné, sinon une
/// icône représentative de la catégorie sur un fond de couleur stable.
/// Jusqu'ici chaque écran affichait la même icône générique
/// (`storefront_outlined`), identique pour toutes les boutiques sans logo :
/// impossible de les distinguer d'un coup d'œil dans une liste ou une carte.
class ShopAvatar extends StatelessWidget {
  const ShopAvatar({
    required this.name,
    this.logoUrl,
    this.categoryName,
    this.size = 40,
    super.key,
  });

  final String name;
  final String? logoUrl;
  final String? categoryName;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (logoUrl != null && logoUrl!.isNotEmpty) {
      return ClipOval(
        child: CachedNetworkImage(
          imageUrl: logoUrl!,
          width: size,
          height: size,
          fit: BoxFit.cover,
          placeholder: (_, __) => _Generated(name: name, categoryName: categoryName, size: size),
          errorWidget: (_, __, ___) => _Generated(name: name, categoryName: categoryName, size: size),
        ),
      );
    }
    return _Generated(name: name, categoryName: categoryName, size: size);
  }
}

class _Generated extends StatelessWidget {
  const _Generated({required this.name, required this.categoryName, required this.size});

  final String name;
  final String? categoryName;
  final double size;

  @override
  Widget build(BuildContext context) {
    final seed = name.isEmpty ? 0 : name.codeUnits.reduce((a, b) => a + b);
    final color = _palette[seed % _palette.length];
    final icon = _categoryIcons[categoryName?.trim().toLowerCase()];

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), shape: BoxShape.circle),
      alignment: Alignment.center,
      child: icon != null
          ? Icon(icon, color: color, size: size * 0.55)
          : Text(
              name.isEmpty ? '?' : name[0].toUpperCase(),
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w700,
                fontSize: size * 0.42,
              ),
            ),
    );
  }
}
