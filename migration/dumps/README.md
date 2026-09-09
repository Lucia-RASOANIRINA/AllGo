# Dumps phpMyAdmin

Déposer ici un fichier `.sql` par table exportée depuis phpMyAdmin (structure
+ données), par exemple `users.sql`, `roles.sql`, `shops.sql`. Au premier
démarrage du conteneur `mariadb` (`docker compose up mariadb`), MariaDB
importe automatiquement tous les fichiers `.sql` présents dans ce dossier,
dans l'ordre alphabétique.

**Ordre important** : les tables avec clé étrangère doivent s'importer après
la table qu'elles référencent (ex. `users.sql` référence `roles`, donc
`roles.sql` doit s'importer avant — préfixer les noms de fichier avec un
numéro si nécessaire : `01_roles.sql`, `02_users.sql`).

Ce dossier n'est jamais utilisé pour écrire vers la base en ligne — il
alimente uniquement le clone local.
