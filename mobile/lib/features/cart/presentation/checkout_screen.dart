import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/account/presentation/addresses_providers.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:collection/collection.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Moyens de paiement réellement proposés par le serveur (`GET
/// /payments/methods`) — jamais une liste devinée côté client. MVola/Orange
/// Money/Airtel Money sont des ossatures pas encore branchées à un vrai
/// fournisseur (§ `payments/providers/*.provider.ts`) : les proposer comme
/// s'ils fonctionnaient laissait l'utilisateur passer commande avant de
/// découvrir l'échec, une fois la commande déjà créée.
final paymentMethodsProvider =
    FutureProvider.autoDispose<List<PaymentMethodOption>>((ref) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/payments/methods');
  final items = (response.data?['data'] as List<dynamic>? ?? const <dynamic>[])
      .whereType<Map<String, dynamic>>();
  return items
      .map((json) => PaymentMethodOption(
            key: json['key'] as String,
            label: json['label'] as String,
            available: json['available'] as bool? ?? false,
            message: json['message'] as String?,
          ))
      .toList();
});

class PaymentMethodOption {
  const PaymentMethodOption({
    required this.key,
    required this.label,
    required this.available,
    this.message,
  });

  final String key;
  final String label;
  final bool available;
  final String? message;
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
  final _tipController = TextEditingController();
  String _deliveryMethod = 'delivery';
  String _paymentMethod = 'cod';
  bool _submitting = false;
  bool _checkingCoupon = false;
  String? _couponMessage;
  bool _couponValid = false;

  // Le formulaire se pré-remplit une seule fois, dès que les données
  // sont disponibles : sans ce garde, chaque reconstruction (frappe dans
  // un autre champ, minuteur du coupon...) écraserait une modification
  // que le client vient de faire.
  bool _addressPrefilled = false;
  bool _phonePrefilled = false;

  void _prefillFromSession() {
    if (_phonePrefilled) return;
    final phone = ref.read(sessionControllerProvider).phone;
    if (phone == null || phone.isEmpty) return;
    _phoneController.text = phone;
    _phonePrefilled = true;
  }

  void _prefillFromAddresses(List<SavedAddress> addresses) {
    if (_addressPrefilled || addresses.isEmpty) return;
    final address = addresses.firstWhere(
      (a) => a.isDefault,
      orElse: () => addresses.first,
    );
    _addressController.text = address.line;
    _cityController.text = address.city.isEmpty ? _cityController.text : address.city;
    _addressPrefilled = true;
  }

  @override
  void dispose() {
    _addressController.dispose();
    _cityController.dispose();
    _phoneController.dispose();
    _noteController.dispose();
    _couponController.dispose();
    _tipController.dispose();
    super.dispose();
  }

  Future<void> _checkCoupon() async {
    final code = _couponController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      _checkingCoupon = true;
      _couponMessage = null;
    });
    try {
      final response =
          await ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/cart/coupon',
        queryParameters: <String, dynamic>{'code': code},
      );
      final data = response.data?['data'] as Map<String, dynamic>?;
      final totalDiscount = data?['totalDiscount'] as num? ?? 0;
      final shops = (data?['shops'] as List<dynamic>?) ?? const <dynamic>[];
      final anyValid =
          shops.any((s) => (s as Map<String, dynamic>)['valid'] == true);
      setState(() {
        _couponValid = anyValid && totalDiscount > 0;
        _couponMessage = _couponValid
            ? 'Réduction de ${totalDiscount.round()} Ar appliquée.'
            : 'Ce code ne s’applique à aucun article de votre panier.';
      });
    } on DioException catch (error) {
      final message = error.response?.data is Map<String, dynamic>
          ? ((error.response!.data as Map<String, dynamic>)['message']
              as String?)
          : null;
      setState(() {
        _couponValid = false;
        _couponMessage = message ?? 'Code promo invalide.';
      });
    } finally {
      if (mounted) setState(() => _checkingCoupon = false);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    // Un moyen de paiement non disponible ne doit jamais atteindre le
    // serveur : la liste peut avoir fini de charger entre le moment où
    // l'utilisateur l'a choisi et celui où il confirme.
    final methods = ref.read(paymentMethodsProvider).valueOrNull;
    final selected = methods?.firstWhereOrNull((m) => m.key == _paymentMethod);
    if (selected != null && !selected.available) {
      setState(() => _paymentMethod = 'cod');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(selected.message ?? 'Ce moyen de paiement n’est plus disponible.')),
      );
      return;
    }

    setState(() => _submitting = true);

    List<Map<String, dynamic>> orderList;
    try {
      final delivery = <String, dynamic>{
        'method': _deliveryMethod,
        if (_addressController.text.trim().isNotEmpty)
          'address': _addressController.text.trim(),
        if (_cityController.text.trim().isNotEmpty)
          'city': _cityController.text.trim(),
        if (_phoneController.text.trim().isNotEmpty)
          'phone': _phoneController.text.trim(),
        if (_noteController.text.trim().isNotEmpty)
          'note': _noteController.text.trim(),
      };
      final position = _deliveryMethod == 'delivery'
          ? ref.read(currentPositionProvider).valueOrNull
          : null;
      if (position != null) {
        delivery['location'] = <String, dynamic>{
          'type': 'Point',
          'coordinates': <double>[position.longitude, position.latitude],
        };
      }
      final response =
          await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                '/orders',
                data: <String, dynamic>{
                  'delivery': delivery,
                  'paymentMethod': _paymentMethod,
                  'shippingFee': _deliveryMethod == 'pickup' ? 0 : 0,
                  if (_couponValid && _couponController.text.trim().isNotEmpty)
                    'couponCode': _couponController.text.trim(),
                  if (_deliveryMethod == 'delivery' &&
                      _tipController.text.trim().isNotEmpty)
                    'tip': int.tryParse(_tipController.text.trim()) ?? 0,
                },
                options: Options(
                  headers: <String, String>{
                    'Idempotency-Key':
                        'mobile-${DateTime.now().microsecondsSinceEpoch}',
                  },
                ),
              );

      final responseBody = response.data?['data'];
      final orders =
          responseBody is Map<String, dynamic> ? responseBody['orders'] : null;
      orderList = orders is List<dynamic>
          ? orders.whereType<Map<String, dynamic>>().toList()
          : const <Map<String, dynamic>>[];
    } on DioException catch (error) {
      // Échec AVANT toute création : rien n'existe côté serveur, le message
      // générique reste correct ici.
      if (mounted) {
        final message = error.response?.data is Map<String, dynamic>
            ? ((error.response!.data as Map<String, dynamic>)['message']
                as String?)
            : null;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message ?? 'Impossible de confirmer la commande.')),
        );
        setState(() => _submitting = false);
      }
      return;
    }

    // La ou les commandes existent désormais côté serveur : un échec à partir
    // d'ici ne doit plus jamais être présenté comme si rien ne s'était passé.
    ref.invalidate(cartControllerProvider);

    String? paymentError;
    if (_paymentMethod != 'cod') {
      try {
        for (var index = 0; index < orderList.length; index++) {
          final orderId = orderList[index]['_id'] ?? orderList[index]['id'];
          if (orderId is! String || orderId.isEmpty) {
            throw const FormatException(
                'La commande créée ne possède pas d’identifiant.');
          }

          await ref.read(apiClientProvider).post<Map<String, dynamic>>(
                '/payments/initiate',
                data: <String, dynamic>{
                  'orderId': orderId,
                  'provider': _paymentMethod,
                  'phone': _phoneController.text.trim(),
                },
                options: Options(
                  headers: <String, String>{
                    'Idempotency-Key':
                        'payment-$orderId-${DateTime.now().microsecondsSinceEpoch}',
                  },
                ),
              );
        }
      } on DioException catch (error) {
        paymentError = error.response?.data is Map<String, dynamic>
            ? ((error.response!.data as Map<String, dynamic>)['message'] as String?)
            : null;
        paymentError ??= 'Le paiement n’a pas pu être déclenché.';
      } catch (_) {
        paymentError = 'Le paiement n’a pas pu être déclenché.';
      }
    }

    if (!mounted) {
      _submitting = false;
      return;
    }
    final count = orderList.length;
    final countPrefix = count > 1 ? '$count commandes ont été créées, une par boutique. ' : '';
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(
          paymentError != null
              ? 'Commande enregistrée, paiement à réessayer'
              : _paymentMethod == 'cod'
                  ? 'Commande confirmée'
                  : 'Commande et paiement initiés',
        ),
        content: Text(
          paymentError != null
              ? '${countPrefix}Votre commande a bien été enregistrée, mais le paiement '
                  'n’a pas pu être déclenché : $paymentError Vous pouvez réessayer '
                  'depuis Mes commandes.'
              : count > 1
                  ? '${countPrefix}Vous pouvez suivre leur état dans Commandes.'
                  : _paymentMethod == 'cod'
                      ? 'Votre commande a été enregistrée. Vous pouvez suivre son état dans Commandes.'
                      : 'Votre commande a bien été enregistrée et le paiement a été déclenché. Vérifiez votre téléphone pour confirmer la transaction.',
        ),
        actions: <Widget>[
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Voir mes commandes'),
          ),
        ],
      ),
    );
    setState(() => _submitting = false);
    if (mounted) context.go('/commandes');
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartControllerProvider).valueOrNull;
    final paymentMethods = ref.watch(paymentMethodsProvider);

    // Le client a déjà donné son numéro et ses adresses ailleurs dans
    // l'application : les redemander à chaque commande est une friction
    // évitable. Pré-rempli, mais jamais verrouillé (§ demande explicite).
    ref.watch(sessionControllerProvider);
    _prefillFromSession();
    ref.watch(addressesProvider).whenData(_prefillFromAddresses);

    if (cart == null || cart.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Livraison et paiement')),
        body: const Center(child: Text('Votre panier est vide.')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Livraison et paiement')),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: ListView(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          children: <Widget>[
            Text('Mode de réception',
                style: Theme.of(context).textTheme.titleMedium),
            RadioGroup<String>(
              groupValue: _deliveryMethod,
              onChanged: (value) {
                if (!_submitting) setState(() => _deliveryMethod = value!);
              },
              child: const Column(
                children: <Widget>[
                  RadioListTile<String>(
                      value: 'delivery', title: Text('Livraison')),
                  RadioListTile<String>(
                      value: 'pickup', title: Text('Retrait en boutique')),
                ],
              ),
            ),
            if (_deliveryMethod == 'delivery') ...<Widget>[
              TextFormField(
                controller: _addressController,
                decoration:
                    const InputDecoration(labelText: 'Adresse de livraison'),
                textInputAction: TextInputAction.next,
                validator: (value) => value == null || value.trim().isEmpty
                    ? 'Adresse requise'
                    : null,
              ),
              const SizedBox(height: AllGoTokens.space3),
              TextFormField(
                controller: _cityController,
                decoration: const InputDecoration(labelText: 'Ville'),
                validator: (value) => value == null || value.trim().isEmpty
                    ? 'Ville requise'
                    : null,
              ),
              const SizedBox(height: AllGoTokens.space3),
            ],
            TextFormField(
              controller: _phoneController,
              decoration:
                  const InputDecoration(labelText: 'Téléphone de contact'),
              keyboardType: TextInputType.phone,
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Téléphone requis'
                  : null,
            ),
            const SizedBox(height: AllGoTokens.space3),
            TextFormField(
              controller: _noteController,
              decoration: const InputDecoration(
                  labelText: 'Précision pour le livreur (facultatif)'),
              maxLines: 2,
            ),
            const SizedBox(height: AllGoTokens.space6),
            Text('Paiement', style: Theme.of(context).textTheme.titleMedium),
            paymentMethods.when(
              data: (methods) => RadioGroup<String>(
                groupValue: _paymentMethod,
                onChanged: (value) {
                  if (_submitting || value == null) return;
                  final option = methods.firstWhereOrNull((m) => m.key == value);
                  if (option != null && !option.available) return;
                  setState(() => _paymentMethod = value);
                },
                child: Column(
                  children: methods
                      .map(
                        (option) => RadioListTile<String>(
                          value: option.key,
                          enabled: option.available,
                          title: Text(option.label),
                          subtitle: option.available
                              ? null
                              : Text(
                                  option.message ?? 'Bientôt disponible.',
                                  style: TextStyle(
                                    color: Theme.of(context).colorScheme.error,
                                  ),
                                ),
                        ),
                      )
                      .toList(),
                ),
              ),
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: AllGoTokens.space4),
                child: Center(
                  child: SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
              // Hors ligne ou erreur serveur : seul le paiement à la
              // livraison ne dépend d'aucun appel réseau supplémentaire,
              // c'est le seul qu'on peut proposer sans confirmation serveur.
              error: (_, __) => RadioGroup<String>(
                groupValue: 'cod',
                onChanged: (_) {},
                child: const Column(
                  children: <Widget>[
                    RadioListTile<String>(
                      value: 'cod',
                      title: Text('Paiement à la livraison'),
                    ),
                  ],
                ),
              ),
            ),
            if (_deliveryMethod == 'delivery') ...<Widget>[
              const SizedBox(height: AllGoTokens.space6),
              Text('Pourboire livreur (facultatif)',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AllGoTokens.space2),
              TextFormField(
                controller: _tipController,
                decoration: const InputDecoration(
                  labelText: 'Montant en Ariary',
                  prefixIcon: Icon(Icons.volunteer_activism_outlined),
                ),
                keyboardType: TextInputType.number,
              ),
            ],
            const SizedBox(height: AllGoTokens.space6),
            Text('Code promotionnel',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AllGoTokens.space2),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: TextFormField(
                    controller: _couponController,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'Code'),
                    onChanged: (_) => setState(() {
                      _couponValid = false;
                      _couponMessage = null;
                    }),
                  ),
                ),
                const SizedBox(width: AllGoTokens.space2),
                Padding(
                  padding: const EdgeInsets.only(top: AllGoTokens.space1),
                  child: OutlinedButton(
                    onPressed: _checkingCoupon ? null : _checkCoupon,
                    child: _checkingCoupon
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Appliquer'),
                  ),
                ),
              ],
            ),
            if (_couponMessage != null)
              Padding(
                padding: const EdgeInsets.only(top: AllGoTokens.space1),
                child: Text(
                  _couponMessage!,
                  style: TextStyle(
                    color: _couponValid
                        ? Colors.green
                        : Theme.of(context).colorScheme.error,
                  ),
                ),
              ),
            const SizedBox(height: AllGoTokens.space6),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.check),
              label: Text(
                  _submitting ? 'Confirmation...' : 'Confirmer la commande'),
            ),
          ],
        ),
      ),
    );
  }
}
