import 'package:allgo/core/utils/currency.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('fr');
  });

  group('Ariary.format', () {
    test('sépare les milliers par une espace insécable et suffixe le symbole', () {
      final formatted = Ariary.format(1250000);

      // Une espace ordinaire laisserait « 1 250\n000 Ar » se couper en fin de
      // ligne sur un écran de 320 dp.
      expect(formatted.contains(' '), isTrue);
      expect(formatted.replaceAll(' ', ' '), '1 250 000 Ar');
    });

    test('n’affiche aucune décimale', () {
      expect(Ariary.format(4999.6).replaceAll(' ', ' '), '5 000 Ar');
    });

    test('formate zéro sans cas particulier', () {
      expect(Ariary.format(0).replaceAll(' ', ' '), '0 Ar');
    });
  });

  group('Ariary.formatWithPromo', () {
    test('ignore une promotion supérieure ou égale au prix', () {
      final result = Ariary.formatWithPromo(10000, 12000);
      expect(result.original, isNull);
      expect(result.current.replaceAll(' ', ' '), '10 000 Ar');
    });

    test('affiche le prix promotionnel et barre le prix d’origine', () {
      final result = Ariary.formatWithPromo(10000, 7500);
      expect(result.current.replaceAll(' ', ' '), '7 500 Ar');
      expect(result.original?.replaceAll(' ', ' '), '10 000 Ar');
    });
  });

  group('Ariary.discountPercent', () {
    test('arrondit à l’entier le plus proche', () {
      expect(Ariary.discountPercent(10000, 7500), 25);
      expect(Ariary.discountPercent(3000, 2000), 33);
    });

    test('renvoie null sans promotion valable', () {
      expect(Ariary.discountPercent(10000, null), isNull);
      expect(Ariary.discountPercent(10000, 10000), isNull);
      expect(Ariary.discountPercent(0, 0), isNull);
    });
  });

  group('DistanceFormat', () {
    test('affiche des mètres sous 1 km', () {
      expect(DistanceFormat.format(450), '450 m');
    });

    test('affiche une décimale entre 1 et 10 km, virgule française', () {
      expect(DistanceFormat.format(2400), '2,4 km');
    });

    test('arrondit au-delà de 10 km', () {
      expect(DistanceFormat.format(23600), '24 km');
    });
  });
}
