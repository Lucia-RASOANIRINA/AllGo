import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/utils/currency.dart';
import 'package:allgo/features/account/presentation/addresses_providers.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geocoding/geocoding.dart' show Geocoding;
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

// --- Aperçu de commande — parsing de `POST /cart/preview` ---

class CartPreviewItem {
  const CartPreviewItem({
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.subtotal,
    required this.available,
    required this.priceChanged,
  });

  factory CartPreviewItem.fromJson(Map<String, dynamic> json) => CartPreviewItem(
        name: json['name'] as String? ?? '',
        quantity: json['quantity'] as int? ?? 1,
        unitPrice: moneyFromJson(json['unitPrice']),
        subtotal: moneyFromJson(json['subtotal']),
        available: json['available'] as bool? ?? true,
        priceChanged: json['priceChanged'] as bool? ?? false,
      );

  final String name;
  final int quantity;
  final int unitPrice;
  final int subtotal;
  final bool available;
  final bool priceChanged;
}

class CartPreviewCoupon {
  const CartPreviewCoupon({
    required this.code,
    required this.valid,
    required this.discountAmount,
    this.reason,
  });

  factory CartPreviewCoupon.fromJson(Map<String, dynamic> json) => CartPreviewCoupon(
        code: json['code'] as String? ?? '',
        valid: json['valid'] as bool? ?? false,
        reason: json['reason'] as String?,
        discountAmount: moneyFromJson(json['discountAmount']),
      );

  final String code;
  final bool valid;
  final String? reason;
  final int discountAmount;
}

class CartPreviewShop {
  const CartPreviewShop({
    required this.shopId,
    required this.shopName,
    required this.items,
    required this.subtotal,
    required this.shippingFee,
    required this.shippingEstimated,
    required this.discount,
    required this.total,
    this.coupon,
  });

  factory CartPreviewShop.fromJson(Map<String, dynamic> json) => CartPreviewShop(
        shopId: json['shopId'] as String? ?? '',
        shopName: json['shopName'] as String? ?? '',
        items: ((json['items'] as List<dynamic>?) ?? const <dynamic>[])
            .map((i) => CartPreviewItem.fromJson(i as Map<String, dynamic>))
            .toList(),
        subtotal: moneyFromJson(json['subtotal']),
        shippingFee: moneyFromJson(json['shippingFee']),
        shippingEstimated: json['shippingEstimated'] as bool? ?? false,
        discount: moneyFromJson(json['discount']),
        total: moneyFromJson(json['total']),
        coupon: json['coupon'] == null
            ? null
            : CartPreviewCoupon.fromJson(json['coupon'] as Map<String, dynamic>),
      );

  final String shopId;
  final String shopName;
  final List<CartPreviewItem> items;
  final int subtotal;
  final int shippingFee;
  final bool shippingEstimated;
  final int discount;
  final int total;
  final CartPreviewCoupon? coupon;

  bool get hasIssues => items.any((i) => !i.available || i.priceChanged);
}

class CartPreview {
  const CartPreview({required this.shops, required this.grandTotal});

  factory CartPreview.fromJson(Map<String, dynamic> json) => CartPreview(
        shops: ((json['shops'] as List<dynamic>?) ?? const <dynamic>[])
            .map((s) => CartPreviewShop.fromJson(s as Map<String, dynamic>))
            .toList(),
        grandTotal: moneyFromJson(json['grandTotal']),
      );

  final List<CartPreviewShop> shops;
  final int grandTotal;
}

// --- Créneaux — 3 jours × 3 plages fixes, sans moteur de capacité ---

class DeliverySlotOption {
  const DeliverySlotOption({required this.date, required this.window, required this.label});

  final DateTime date;
  final String window;
  final String label;
}

List<DeliverySlotOption> _buildSlotOptions() {
  const windows = <(String, String)>[
    ('morning', 'Matin · 8h–12h'),
    ('afternoon', 'Après-midi · 12h–17h'),
    ('evening', 'Soir · 17h–20h'),
  ];
  final today = DateTime.now();
  final options = <DeliverySlotOption>[];

  for (var d = 0; d < 3; d++) {
    final date = DateTime(today.year, today.month, today.day + d);
    final dayLabel = switch (d) {
      0 => 'Aujourd’hui',
      1 => 'Demain',
      _ => DateFormat.MMMEd('fr').format(date),
    };
    for (final (window, windowLabel) in windows) {
      options.add(DeliverySlotOption(date: date, window: window, label: '$dayLabel · $windowLabel'));
    }
  }
  return options;
}

class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  final _addressController = TextEditingController();
  final _cityController = TextEditingController(text: 'Mahajanga');
  final _phoneController = TextEditingController();
  final _noteController = TextEditingController();
  final _couponController = TextEditingController();
  final List<DeliverySlotOption> _slotOptions = _buildSlotOptions();

  String _deliveryMethod = 'delivery';
  String _paymentMethod = 'cod';
  bool _submitting = false;
  bool _previewing = false;

  SavedAddress? _selectedAddress;
  bool _useNewAddress = false;
  DeliverySlotOption? _selectedSlot;

  ({double latitude, double longitude})? _resolvedLocation;
  CartPreview? _preview;
  String? _previewError;

  @override
  void dispose() {
    _addressController.dispose();
    _cityController.dispose();
    _phoneController.dispose();
    _noteController.dispose();
    _couponController.dispose();
    super.dispose();
  }

  /// Toute modification des options après un aperçu l'invalide : confirmer un
  /// total qui ne correspond plus aux choix affichés induirait en erreur.
  void _invalidatePreview() {
    if (_preview == null && _previewError == null) return;
    setState(() {
      _preview = null;
      _previewError = null;
      _resolvedLocation = null;
    });
  }

  Future<void> _verify() async {
    if (!_formKey.currentState!.validate()) return;
    if (_deliveryMethod == 'delivery' && !_useNewAddress && _selectedAddress == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choisissez une adresse.')),
      );
      return;
    }

    setState(() {
      _previewing = true;
      _preview = null;
      _previewError = null;
    });

    ({double latitude, double longitude})? location;
    if (_deliveryMethod == 'delivery') {
      if (!_useNewAddress && _selectedAddress != null && _selectedAddress!.hasLocation) {
        location = (
          latitude: _selectedAddress!.latitude!,
          longitude: _selectedAddress!.longitude!,
        );
      } else {
        final address = _useNewAddress ? _addressController.text.trim() : _selectedAddress!.line;
        final city = _useNewAddress ? _cityController.text.trim() : _selectedAddress!.city;
        try {
          // Même appel que la recherche de zone sur la carte
          // (`map_screen.dart`) : pas d'appel à notre backend.
          final results = await Geocoding().locationFromAddress('$address, $city, Madagascar');
          if (results.isNotEmpty) {
            location = (latitude: results.first.latitude, longitude: results.first.longitude);
          }
        } on Exception {
          // Adresse non géolocalisable (informel, courant à Mahajanga) : le
          // serveur repliera sur une estimation forfaitaire, signalée dans
          // l'aperçu (`shippingEstimated`).
        }
      }
    }

    try {
      final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/cart/preview',
        data: <String, dynamic>{
          'delivery': <String, dynamic>{
            'method': _deliveryMethod,
            if (location != null)
              'location': <String, dynamic>{
                'type': 'Point',
                'coordinates': <double>[location.longitude, location.latitude],
              },
          },
          if (_couponController.text.trim().isNotEmpty)
            'couponCode': _couponController.text.trim(),
        },
      );
      if (!mounted) return;
      setState(() {
        _preview = CartPreview.fromJson(response.data!['data'] as Map<String, dynamic>);
        _resolvedLocation = location;
      });
    } on DioException catch (error) {
      if (!mounted) return;
      final failure = error.error;
      setState(
        () => _previewError =
            failure is Failure ? failure.displayMessage : 'Impossible de vérifier la commande. Réessayez.',
      );
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  Future<void> _submit() async {
    if (_preview == null) return;

    setState(() => _submitting = true);
    try {
      final address = _useNewAddress ? _addressController.text.trim() : _selectedAddress?.line;
      final city = _useNewAddress ? _cityController.text.trim() : _selectedAddress?.city;

      final delivery = <String, dynamic>{
        'method': _deliveryMethod,
        if (_deliveryMethod == 'delivery' && address != null && address.isNotEmpty)
          'address': address,
        if (_deliveryMethod == 'delivery' && city != null && city.isNotEmpty) 'city': city,
        if (_phoneController.text.trim().isNotEmpty) 'phone': _phoneController.text.trim(),
        if (_noteController.text.trim().isNotEmpty) 'note': _noteController.text.trim(),
        if (_resolvedLocation != null)
          'location': <String, dynamic>{
            'type': 'Point',
            'coordinates': <double>[_resolvedLocation!.longitude, _resolvedLocation!.latitude],
          },
        if (_selectedSlot != null)
          'slot': <String, String>{
            'date': DateFormat('yyyy-MM-dd').format(_selectedSlot!.date),
            'window': _selectedSlot!.window,
          },
      };
      final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/orders',
        data: <String, dynamic>{
          'delivery': delivery,
          'paymentMethod': _paymentMethod,
          if (_couponController.text.trim().isNotEmpty)
            'couponCode': _couponController.text.trim(),
        },
        options: Options(
          headers: <String, String>{
            'Idempotency-Key': 'mobile-${DateTime.now().microsecondsSinceEpoch}',
          },
        ),
      );

      ref.invalidate(cartControllerProvider);
      if (!mounted) return;
      final responseBody = response.data?['data'];
      final ordersJson = responseBody is Map<String, dynamic> ? responseBody['orders'] : null;
      final orders = ordersJson is List<dynamic> ? ordersJson : const <dynamic>[];
      final count = orders.isEmpty ? 1 : orders.length;

      // Le paiement mobile money n'a rien de dérivable de la création de la
      // commande : c'est un second appel, distinct, qui peut échouer sans que
      // la commande elle-même soit remise en cause (§ décisions de portée —
      // aucun fournisseur réel n'est branché, le message reste honnête plutôt
      // que de prétendre un succès).
      String? paymentNotice;
      if (_paymentMethod != 'cod' && orders.isNotEmpty) {
        final firstOrder = orders.first as Map<String, dynamic>;
        try {
          await ref.read(apiClientProvider).post<void>(
            '/payments/initiate',
            data: <String, String>{
              'orderId': idFromJson(firstOrder),
              'provider': _paymentMethod,
              'phone': _phoneController.text.trim(),
            },
            options: Options(
              headers: <String, String>{
                'Idempotency-Key': 'mobile-pay-${DateTime.now().microsecondsSinceEpoch}',
              },
            ),
          );
        } on DioException catch (error) {
          final failure = error.error;
          paymentNotice = failure is Failure
              ? failure.displayMessage
              : 'Paiement mobile indisponible pour le moment.';
        }
      }

      if (!mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('Commande confirmée'),
          content: Text(
            <String>[
              if (count > 1)
                '$count commandes ont été créées, une par boutique.'
              else
                'Votre commande a été enregistrée. Vous pouvez suivre son état dans Commandes.',
              if (paymentNotice != null) '$paymentNotice Réglez à la livraison, ou réessayez depuis le détail de la commande.',
            ].join('\n\n'),
          ),
          actions: <Widget>[
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Voir mes commandes'),
            ),
          ],
        ),
      );
      if (mounted) context.go(Routes.orders);
    } on DioException catch (error) {
      if (!mounted) return;
      final failure = error.error;
      final message = failure is Failure ? failure.displayMessage : 'Impossible de confirmer la commande.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      // L'échec peut venir d'un stock ou d'un coupon devenus invalides entre
      // l'aperçu et la confirmation : on force une nouvelle vérification
      // plutôt que de laisser confirmer un aperçu potentiellement périmé.
      _invalidatePreview();
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartControllerProvider).valueOrNull;
    final addresses = ref.watch(addressesProvider).valueOrNull ?? const <SavedAddress>[];
    final theme = Theme.of(context);

    if (cart == null || cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Livraison et paiement')),
        body: const Center(child: Text('Votre panier est vide.')),
      );
    }

    if (!_useNewAddress &&
        _selectedAddress == null &&
        addresses.isNotEmpty &&
        addresses.any((a) => a.isDefault)) {
      // Présélection silencieuse de l'adresse par défaut, une seule fois.
      _selectedAddress = addresses.firstWhere((a) => a.isDefault, orElse: () => addresses.first);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Livraison et paiement')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          children: <Widget>[
            Text('Mode de réception', style: theme.textTheme.titleMedium),
            RadioGroup<String>(
              groupValue: _deliveryMethod,
              onChanged: (value) {
                if (_submitting) return;
                setState(() => _deliveryMethod = value!);
                _invalidatePreview();
              },
              child: const Column(
                children: <Widget>[
                  RadioListTile<String>(value: 'delivery', title: Text('Livraison')),
                  RadioListTile<String>(value: 'pickup', title: Text('Retrait en boutique')),
                ],
              ),
            ),
            if (_deliveryMethod == 'delivery') ...<Widget>[
              const SizedBox(height: AllGoTokens.space2),
              Text('Adresse', style: theme.textTheme.titleSmall),
              const SizedBox(height: AllGoTokens.space2),
              Wrap(
                spacing: AllGoTokens.space2,
                runSpacing: AllGoTokens.space2,
                children: <Widget>[
                  for (final address in addresses)
                    ChoiceChip(
                      label: Text(address.label),
                      selected: !_useNewAddress && _selectedAddress?.id == address.id,
                      onSelected: (_) {
                        setState(() {
                          _useNewAddress = false;
                          _selectedAddress = address;
                        });
                        _invalidatePreview();
                      },
                    ),
                  ChoiceChip(
                    avatar: const Icon(Icons.add, size: 18),
                    label: const Text('Nouvelle adresse'),
                    selected: _useNewAddress,
                    onSelected: (_) {
                      setState(() {
                        _useNewAddress = true;
                        _selectedAddress = null;
                      });
                      _invalidatePreview();
                    },
                  ),
                ],
              ),
              const SizedBox(height: AllGoTokens.space3),
              if (_useNewAddress) ...<Widget>[
                TextFormField(
                  controller: _addressController,
                  decoration: const InputDecoration(labelText: 'Adresse de livraison'),
                  textInputAction: TextInputAction.next,
                  onChanged: (_) => _invalidatePreview(),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? 'Adresse requise' : null,
                ),
                const SizedBox(height: AllGoTokens.space3),
                TextFormField(
                  controller: _cityController,
                  decoration: const InputDecoration(labelText: 'Ville'),
                  onChanged: (_) => _invalidatePreview(),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? 'Ville requise' : null,
                ),
                const SizedBox(height: AllGoTokens.space3),
              ] else if (_selectedAddress != null) ...<Widget>[
                Card(
                  margin: EdgeInsets.zero,
                  child: ListTile(
                    leading: const Icon(Icons.location_on_outlined),
                    title: Text(_selectedAddress!.line),
                    subtitle: Text(_selectedAddress!.city),
                  ),
                ),
                const SizedBox(height: AllGoTokens.space3),
              ],
              Text('Créneau souhaité (facultatif)', style: theme.textTheme.titleSmall),
              const SizedBox(height: AllGoTokens.space2),
              Wrap(
                spacing: AllGoTokens.space2,
                runSpacing: AllGoTokens.space2,
                children: <Widget>[
                  for (final slot in _slotOptions)
                    ChoiceChip(
                      label: Text(slot.label),
                      selected: _selectedSlot?.date == slot.date && _selectedSlot?.window == slot.window,
                      onSelected: (selected) {
                        setState(() => _selectedSlot = selected ? slot : null);
                        _invalidatePreview();
                      },
                    ),
                ],
              ),
              const SizedBox(height: AllGoTokens.space3),
            ],
            TextFormField(
              controller: _phoneController,
              decoration: const InputDecoration(labelText: 'Téléphone de contact'),
              keyboardType: TextInputType.phone,
              validator: (value) => value == null || value.trim().isEmpty ? 'Téléphone requis' : null,
            ),
            const SizedBox(height: AllGoTokens.space3),
            TextFormField(
              controller: _noteController,
              decoration: const InputDecoration(labelText: 'Précision pour le livreur (facultatif)'),
              maxLines: 2,
            ),
            const SizedBox(height: AllGoTokens.space3),
            TextFormField(
              controller: _couponController,
              decoration: const InputDecoration(
                labelText: 'Code promotionnel (facultatif)',
                prefixIcon: Icon(Icons.local_offer_outlined),
              ),
              textCapitalization: TextCapitalization.characters,
              onChanged: (_) => _invalidatePreview(),
            ),
            const SizedBox(height: AllGoTokens.space6),
            Text('Paiement', style: theme.textTheme.titleMedium),
            RadioGroup<String>(
              groupValue: _paymentMethod,
              onChanged: (value) {
                if (!_submitting) setState(() => _paymentMethod = value!);
              },
              child: const Column(
                children: <Widget>[
                  RadioListTile<String>(value: 'cod', title: Text('Paiement à la livraison')),
                  RadioListTile<String>(value: 'mvola', title: Text('MVola')),
                ],
              ),
            ),
            const SizedBox(height: AllGoTokens.space6),

            if (_preview == null) ...<Widget>[
              FilledButton.icon(
                onPressed: _previewing ? null : _verify,
                icon: _previewing
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.fact_check_outlined),
                label: Text(_previewing ? 'Vérification...' : 'Vérifier ma commande'),
              ),
              if (_previewError != null) ...<Widget>[
                const SizedBox(height: AllGoTokens.space2),
                Text(_previewError!, style: TextStyle(color: theme.colorScheme.error)),
              ],
            ] else ...<Widget>[
              _PreviewSummary(preview: _preview!),
              const SizedBox(height: AllGoTokens.space4),
              OutlinedButton.icon(
                onPressed: _submitting ? null : () => setState(() => _preview = null),
                icon: const Icon(Icons.edit_outlined),
                label: const Text('Modifier'),
              ),
              const SizedBox(height: AllGoTokens.space3),
              FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                icon: _submitting
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check),
                label: Text(_submitting ? 'Confirmation...' : 'Confirmer la commande'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PreviewSummary extends StatelessWidget {
  const _PreviewSummary({required this.preview});

  final CartPreview preview;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('Récapitulatif', style: theme.textTheme.titleMedium),
        const SizedBox(height: AllGoTokens.space2),
        for (final shop in preview.shops) ...<Widget>[
          Card(
            margin: const EdgeInsets.only(bottom: AllGoTokens.space3),
            child: Padding(
              padding: const EdgeInsets.all(AllGoTokens.space3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(shop.shopName, style: theme.textTheme.titleSmall),
                  const SizedBox(height: AllGoTokens.space2),
                  for (final item in shop.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              '${item.name} × ${item.quantity}'
                              '${item.available ? '' : ' — indisponible'}'
                              '${item.priceChanged ? ' — prix modifié' : ''}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: item.available
                                    ? theme.colorScheme.onSurfaceVariant
                                    : theme.colorScheme.error,
                              ),
                            ),
                          ),
                          Text(Ariary.format(item.subtotal), style: theme.textTheme.bodySmall),
                        ],
                      ),
                    ),
                  const Divider(height: AllGoTokens.space4),
                  _AmountRow(label: 'Sous-total', value: shop.subtotal),
                  _AmountRow(
                    label: shop.shippingEstimated ? 'Livraison (estimation)' : 'Livraison',
                    value: shop.shippingFee,
                  ),
                  if (shop.discount > 0)
                    _AmountRow(label: 'Réduction', value: -shop.discount),
                  if (shop.coupon != null && !shop.coupon!.valid)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        _couponReasonLabel(shop.coupon!.reason),
                        style: TextStyle(color: theme.colorScheme.error, fontSize: 12),
                      ),
                    ),
                  const SizedBox(height: AllGoTokens.space1),
                  _AmountRow(label: 'Total', value: shop.total, emphasize: true),
                ],
              ),
            ),
          ),
        ],
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Text('Total général', style: theme.textTheme.titleMedium),
            Text(
              Ariary.format(preview.grandTotal),
              style: theme.textTheme.titleLarge?.copyWith(
                color: AllGoTokens.brand,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ],
    );
  }

  String _couponReasonLabel(String? reason) => switch (reason) {
        'EXPIRED' => 'Code promotionnel expiré.',
        'LIMIT_REACHED' => 'Code promotionnel épuisé.',
        'NOT_APPLICABLE' => 'Code non applicable à cette boutique.',
        'MIN_AMOUNT' => 'Montant minimum non atteint pour ce code.',
        _ => 'Code promotionnel introuvable.',
      };
}

class _AmountRow extends StatelessWidget {
  const _AmountRow({required this.label, required this.value, this.emphasize = false});

  final String label;
  final int value;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = emphasize
        ? theme.textTheme.titleSmall?.copyWith(color: AllGoTokens.brand, fontWeight: FontWeight.w700)
        : theme.textTheme.bodySmall;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Text(label, style: style),
          Text(Ariary.format(value), style: style),
        ],
      ),
    );
  }
}
