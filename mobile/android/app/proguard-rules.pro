# Règles d'obscurcissement — §12.2.
#
# R8 supprime le code inatteignable. Les greffons Flutter atteints par
# réflexion depuis le moteur en font partie du point de vue de l'analyse
# statique : sans ces règles, ils disparaissent de la version release et
# l'application plante à l'usage — jamais en debug, donc tardivement.

-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.embedding.** { *; }

# mobile_scanner s'appuie sur ML Kit, dont les classes sont chargées par nom.
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# SQLCipher / sqlite3 : bibliothèques natives liées par JNI.
-keep class net.sqlcipher.** { *; }
-keep class org.sqlite.** { *; }

# flutter_local_notifications sérialise ses charges utiles via Gson.
-keep class com.dexterous.** { *; }

# Les traces d'erreur doivent rester exploitables une fois remontées à Sentry.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
