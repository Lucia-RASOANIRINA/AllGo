plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "mg.allgo.allgo"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = "mg.allgo.allgo"

        // Android 8.0 (API 26) couvre plus de 95 % du parc malgache (§13.2).
        // `flutter_secure_storage` exige au minimum l'API 23 pour le Keystore
        // matériel ; descendre en dessous reviendrait à stocker les jetons en
        // clair sur les terminaux concernés.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    dependencies {
        coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    }

    buildTypes {
        release {
            // TODO: signature de production — clé hors dépôt, injectée par la CI
            // (§17.1). Les clés de debug ne servent qu'à faire fonctionner
            // `flutter run --release` en local.
            signingConfig = signingConfigs.getByName("debug")

            // Obscurcissement en production (§12.2). Les symboles Dart sont
            // transmis séparément à Sentry pour garder les rapports lisibles.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    // Le découpage par ABI (budget de 25 Mo, §13.1) est piloté par
    // `flutter build apk --split-per-abi`, comme le fait la CI. Le déclarer
    // aussi dans un bloc `splits` entre en conflit avec les `abiFilters` que
    // Flutter pose lui-même via `--target-platform` :
    //
    //   Conflicting configuration : 'armeabi-v7a,arm64-v8a,x86_64' in ndk
    //   abiFilters cannot be present when splits abi filters are set
    //
    // Une seule autorité sur les ABI : l'outil Flutter.
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
