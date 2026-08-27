import 'package:allgo/core/network/json_parsing.dart';
import 'package:flutter_test/flutter_test.dart';

/// Ces règles reflètent le contrat réellement produit par l'API
/// (`backend/src/common/http/serialisation.ts`), vérifié en exécution.
void main() {
  group('moneyFromJson', () {
    test('lit un montant sérialisé en chaîne', () {
      expect(moneyFromJson('5200'), 5200);
    });

    test('lit un entier tel quel', () {
      expect(moneyFromJson(19500), 19500);
    });

    test('tronque la partie décimale au lieu d’arrondir', () {
      // Arrondir au supérieur ferait payer un Ariary de plus. Ce n'est pas à
      // un analyseur JSON d'en décider.
      expect(moneyFromJson('5200.99'), 5200);
      expect(moneyFromJson('5200.00'), 5200);
    });

    test('conserve la précision sur un gros montant', () {
      // Un `double` dériverait au dernier chiffre sur ce genre de total.
      expect(moneyFromJson('19999999'), 19999999);
    });

    test('retombe sur la valeur de repli quand le champ est absent', () {
      expect(moneyFromJson(null), 0);
      expect(moneyFromJson(null, fallback: -1), -1);
    });

    test('ne lève pas sur une valeur illisible', () {
      // Une réponse inattendue ne doit pas faire planter un écran de liste.
      expect(moneyFromJson('indisponible'), 0);
      expect(moneyFromJson(<String, dynamic>{}), 0);
    });
  });

  group('idFromJson', () {
    test('lit `id`, la forme normalisée du contrat', () {
      expect(idFromJson(<String, dynamic>{'id': 'abc123'}), 'abc123');
    });

    test('tolère `_id` pour les documents mis en cache par une version antérieure', () {
      expect(idFromJson(<String, dynamic>{'_id': 'abc123'}), 'abc123');
    });

    test('privilégie `id` si les deux sont présents', () {
      expect(idFromJson(<String, dynamic>{'id': 'neuf', '_id': 'ancien'}), 'neuf');
    });

    test('signale un contrat rompu plutôt que de renvoyer une chaîne vide', () {
      // Un identifiant vide se propagerait silencieusement jusqu'à une requête
      // `/produit/` qui renverrait la liste entière — le défaut constaté en
      // exécution avant la normalisation côté API.
      expect(
        () => idFromJson(<String, dynamic>{'name': 'Riz'}),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('doubleFromJson', () {
    test('lit un nombre et une chaîne', () {
      expect(doubleFromJson(4.5), 4.5);
      expect(doubleFromJson('4.5'), 4.5);
      expect(doubleFromJson(4), 4.0);
    });

    test('retombe sur la valeur de repli', () {
      expect(doubleFromJson(null), 0);
      expect(doubleFromJson('n/a', fallback: -1), -1);
    });
  });
}
