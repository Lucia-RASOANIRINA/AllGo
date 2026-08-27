# Plan d'installation de l'application AllGo sur l'émulateur

Ce plan détaille les étapes nécessaires pour compiler et installer le projet Flutter "AllGo" sur l'émulateur Android actif (`emulator-5554`).

## Recherches effectuées
- Le projet est un projet Flutter situé dans le répertoire `mobile/`.
- L'émulateur `emulator-5554` est actif et détecté par `adb`.
- Le SDK Flutter est situé à `C:\src\flutter`.
- Le SDK Android est situé à `C:\Users\D ELL\AppData\Local\Android\sdk`.
- Le projet utilise la génération de code (`freezed`, `drift`, `json_serializable`).

## Étapes proposées

### 1. Préparation de l'environnement
- Navigation vers le répertoire `mobile/`.
- Exécution de `flutter pub get` pour récupérer les dépendances.

### 2. Génération de code (Si nécessaire)
- Exécution de `dart run build_runner build --delete-conflicting-outputs` pour générer les fichiers nécessaires aux modèles de données (`freezed`) et à la base de données (`drift`).

### 3. Compilation
- Exécution de `flutter build apk --debug` pour générer un APK de débogage compatible avec l'émulateur.

### 4. Installation
- Installation de l'APK généré sur l'émulateur via `adb install`.

### 5. Lancement
- Une fois installé, l'utilisateur pourra lancer l'application depuis le menu des applications de l'émulateur ou via Android Studio.

## Questions ouvertes
- Existe-t-il des fichiers de configuration spécifiques (comme `google-services.json`) qui ne sont pas présents dans le dépôt et qui pourraient bloquer la compilation ?
- Souhaitez-vous que je tente également de lancer l'application automatiquement après l'installation ?

## Plan de vérification
- Vérification que `flutter build apk` se termine sans erreur.
- Vérification que `adb install` renvoie "Success".
