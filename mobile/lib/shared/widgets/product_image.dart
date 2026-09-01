import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

class ProductImage extends StatelessWidget {
  const ProductImage({
    required this.imageUrl,
    required this.productName,
    this.fit = BoxFit.cover,
    super.key,
  });

  final String? imageUrl;
  final String productName;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final fallback = _fallbackAsset(productName);
    if (imageUrl == null || imageUrl!.isEmpty) {
      return Image.asset(fallback, fit: fit);
    }
    return CachedNetworkImage(
      imageUrl: imageUrl!,
      fit: fit,
      placeholder: (_, __) => Image.asset(fallback, fit: fit),
      errorWidget: (_, __, ___) => Image.asset(fallback, fit: fit),
    );
  }

  String _fallbackAsset(String name) {
    final normalized = name.toLowerCase();
    if (normalized.contains('riz')) return 'assets/images/products/rice.jpg';
    if (normalized.contains('huile')) return 'assets/images/products/oil.jpg';
    return 'assets/images/products/sugar.jpg';
  }
}
