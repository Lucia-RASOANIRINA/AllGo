/// Lecture des types du contrat d'API — voir `backend/src/common/http/serialisation.ts`.
///
/// L'API normalise ses réponses à la frontière HTTP : tout identifiant est
/// exposé sous `id`, jamais `_id`, et tout montant `Decimal128` est sérialisé
/// en **chaîne**, jamais en `{"$numberDecimal":"5200"}` ni en flottant.
///
/// Ces fonctions sont le seul endroit du client qui connaît ces conventions.
/// Les répandre dans chaque analyseur garantirait qu'un changement de contrat
/// soit corrigé à quinze endroits et oublié au seizième.
library;

/// Montant en Ariary.
///
/// L'Ariary n'a pas de subdivision en usage courant : le montant est ramené à
/// l'entier. La partie décimale éventuelle est **tronquée, pas arrondie** —
/// arrondir au supérieur ferait payer un franc de plus, ce qu'aucun affichage
/// ne doit décider seul.
///
/// Le passage par `double` est délibérément évité : sur un total de plusieurs
/// millions d'Ariary, un flottant introduit une dérive au dernier chiffre.
int moneyFromJson(Object? value, {int fallback = 0}) {
  if (value == null) return fallback;
  if (value is int) return value;

  final text = value is String ? value : value.toString();
  final integerPart = text.split('.').first.trim();

  return int.tryParse(integerPart) ?? fallback;
}

/// Identifiant de document.
///
/// Tolère encore `_id` : l'API le normalise, mais les documents mis en cache
/// par une version antérieure de l'application peuvent en contenir, et une
/// migration de schéma local ne doit pas rendre le cache illisible.
String idFromJson(Map<String, dynamic> json) {
  final id = json['id'] ?? json['_id'];
  if (id == null) {
    throw const FormatException('Document sans identifiant : contrat d’API rompu.');
  }
  return id.toString();
}

/// Nombre à virgule non monétaire — note moyenne, distance, coordonnée.
///
/// Un `double` est ici légitime : personne ne facture une note de boutique.
double doubleFromJson(Object? value, {double fallback = 0}) {
  if (value == null) return fallback;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString()) ?? fallback;
}
