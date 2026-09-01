import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

/// Ligne d'un reçu — instantané, jamais recalculée : le reçu doit rester
/// exact même si le prix du produit change après coup (§6.1, même principe
/// que l'instantané contractuel d'une ligne de commande).
class ReceiptLine {
  const ReceiptLine({required this.name, required this.quantity, required this.subtotal});

  final String name;
  final int quantity;
  final int subtotal;
}

/// Génère le PDF d'un reçu de commande — utilisé côté client (mes commandes)
/// et côté commerçant (commandes reçues), à partir des mêmes données déjà
/// chargées par l'écran appelant. Pas de nouvel appel réseau : tout ce dont un
/// reçu a besoin est déjà dans la fiche de commande.
Future<void> printReceipt({
  required String orderNumber,
  required String shopName,
  required String customerName,
  required String customerPhone,
  required List<ReceiptLine> lines,
  required int subtotal,
  required int shippingFee,
  required int discount,
  required int tip,
  required int total,
  required String paymentMethod,
  required String status,
  required DateTime date,
}) async {
  final doc = pw.Document();

  String money(int amount) => '${amount.toStringAsFixed(0).replaceAllMapped(
        RegExp(r'\B(?=(\d{3})+(?!\d))'),
        (match) => ' ',
      )} Ar';

  String paymentLabel(String method) => switch (method) {
        'cod' => 'Paiement à la livraison',
        'mvola' => 'MVola',
        'orange_money' => 'Orange Money',
        'airtel_money' => 'Airtel Money',
        'card' => 'Carte bancaire',
        _ => method,
      };

  doc.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a5,
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: <pw.Widget>[
          pw.Text('AllGo', style: pw.TextStyle(fontSize: 22, fontWeight: pw.FontWeight.bold)),
          pw.Text(shopName, style: const pw.TextStyle(fontSize: 14)),
          pw.SizedBox(height: 12),
          pw.Text('Reçu - commande $orderNumber'),
          pw.Text('${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year} '
              '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}'),
          pw.SizedBox(height: 4),
          pw.Text('Client : $customerName'),
          if (customerPhone.isNotEmpty) pw.Text('Téléphone : $customerPhone'),
          pw.Divider(),
          pw.Table(
            columnWidths: const <int, pw.TableColumnWidth>{
              0: pw.FlexColumnWidth(3),
              1: pw.FlexColumnWidth(1),
              2: pw.FlexColumnWidth(2),
            },
            children: <pw.TableRow>[
              pw.TableRow(
                children: <pw.Widget>[
                  pw.Text('Article', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
                  pw.Text('Qté', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
                  pw.Text('Sous-total', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
                ],
              ),
              for (final line in lines)
                pw.TableRow(
                  children: <pw.Widget>[
                    pw.Text(line.name),
                    pw.Text('${line.quantity}'),
                    pw.Text(money(line.subtotal)),
                  ],
                ),
            ],
          ),
          pw.Divider(),
          _totalRow('Sous-total', money(subtotal)),
          if (shippingFee > 0) _totalRow('Livraison', money(shippingFee)),
          if (discount > 0) _totalRow('Réduction', '- ${money(discount)}'),
          if (tip > 0) _totalRow('Pourboire', money(tip)),
          pw.SizedBox(height: 4),
          _totalRow('Total', money(total), bold: true),
          pw.SizedBox(height: 12),
          pw.Text('Paiement : ${paymentLabel(paymentMethod)}'),
          pw.Text('Statut : $status'),
          pw.SizedBox(height: 16),
          pw.Center(child: pw.Text('Merci pour votre confiance - AllGo Mahajanga')),
        ],
      ),
    ),
  );

  await Printing.layoutPdf(onLayout: (format) => doc.save());
}

pw.Widget _totalRow(String label, String value, {bool bold = false}) => pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: <pw.Widget>[
        pw.Text(label, style: bold ? pw.TextStyle(fontWeight: pw.FontWeight.bold) : null),
        pw.Text(value, style: bold ? pw.TextStyle(fontWeight: pw.FontWeight.bold) : null),
      ],
    );
