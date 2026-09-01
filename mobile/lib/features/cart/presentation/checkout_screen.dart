import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/cart/presentation/cart_controller.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
  String _deliveryMethod = 'delivery';
  String _paymentMethod = 'cod';
  bool _submitting = false;

  static const List<_PaymentMethodOption> _paymentOptions =
      <_PaymentMethodOption>[
    _PaymentMethodOption('cod', 'Paiement à la livraison'),
    _PaymentMethodOption('mvola', 'MVola'),
    _PaymentMethodOption('orange_money', 'Orange Money'),
    _PaymentMethodOption('airtel_money', 'Airtel Money'),
  ];

  @override
  void dispose() {
    _addressController.dispose();
    _cityController.dispose();
    _phoneController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
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
      final orderList = orders is List<dynamic>
          ? orders.whereType<Map<String, dynamic>>().toList()
          : const <Map<String, dynamic>>[];

      if (_paymentMethod != 'cod') {
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
      }

      ref.invalidate(cartControllerProvider);
      if (!mounted) return;
      final count = orderList.length;
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: Text(_paymentMethod == 'cod'
              ? 'Commande confirmée'
              : 'Commande et paiement initiés'),
          content: Text(
            count > 1
                ? '$count commandes ont été créées, une par boutique.'
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
      if (mounted) context.go('/commandes');
    } on DioException catch (error) {
      if (!mounted) return;
      final message = error.response?.data is Map<String, dynamic>
          ? ((error.response!.data as Map<String, dynamic>)['message']
              as String?)
          : null;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(message ?? 'Impossible de confirmer la commande.')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartControllerProvider).valueOrNull;

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
            RadioGroup<String>(
              groupValue: _paymentMethod,
              onChanged: (value) {
                if (!_submitting) setState(() => _paymentMethod = value!);
              },
              child: Column(
                children: _paymentOptions
                    .map(
                      (option) => RadioListTile<String>(
                        value: option.key,
                        title: Text(option.label),
                      ),
                    )
                    .toList(),
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

class _PaymentMethodOption {
  const _PaymentMethodOption(this.key, this.label);

  final String key;
  final String label;
}
