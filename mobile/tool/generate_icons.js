#!/usr/bin/env node
/**
 * Génération des icônes Android depuis `assets/images/allgo_logo.svg`.
 *
 *   node tool/generate_icons.js
 *
 * Un script plutôt qu'un jeu de PNG versionnés : le logo reste modifiable en
 * un seul endroit, et les dix déclinaisons ne peuvent pas diverger de la
 * source. `sharp` est déjà une dépendance du backend (§5.1), on la réutilise
 * au lieu d'en ajouter une.
 */

const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const sharp = require(resolve(__dirname, '../../backend/node_modules/sharp'));

const ROOT = resolve(__dirname, '..');
const SVG = readFileSync(join(ROOT, 'assets/images/allgo_logo.svg'));
const RES = join(ROOT, 'android/app/src/main/res');

/** Densités Android et taille de l'icône de lanceur correspondante. */
const LAUNCHER_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

/**
 * Icône adaptative : le système recadre selon la forme choisie par le
 * constructeur (cercle, écusson…). Le dessin doit donc tenir dans les 66 %
 * centraux, sinon le panier se fait rogner sur la moitié des téléphones.
 */
const FOREGROUND_SIZES = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

const SAFE_RATIO = 0.66;

async function main() {
  for (const [folder, size] of Object.entries(LAUNCHER_SIZES)) {
    mkdirSync(join(RES, folder), { recursive: true });

    // Icône classique, pleine.
    await sharp(SVG, { density: 512 })
      .resize(size, size)
      .png()
      .toFile(join(RES, folder, 'ic_launcher.png'));

    // Calque avant de l'icône adaptative : logo réduit, centré sur du vide.
    const canvas = FOREGROUND_SIZES[folder];
    const inner = Math.round(canvas * SAFE_RATIO);
    const pad = Math.round((canvas - inner) / 2);

    const logo = await sharp(SVG, { density: 512 }).resize(inner, inner).png().toBuffer();

    await sharp({
      create: {
        width: canvas,
        height: canvas,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: logo, top: pad, left: pad }])
      .png()
      .toFile(join(RES, folder, 'ic_launcher_foreground.png'));
  }

  // Déclaration de l'icône adaptative, et sa couleur de fond.
  mkdirSync(join(RES, 'mipmap-anydpi-v26'), { recursive: true });
  writeFileSync(
    join(RES, 'mipmap-anydpi-v26/ic_launcher.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`,
  );

  mkdirSync(join(RES, 'values'), { recursive: true });
  writeFileSync(
    join(RES, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Vert AllGo, repris de l'identité web (§11.1). -->
    <color name="ic_launcher_background">#198754</color>
</resources>
`,
  );

  // Version PNG du logo, utilisée dans l'application (écrans d'accès).
  await sharp(SVG, { density: 512 })
    .resize(512, 512)
    .png()
    .toFile(join(ROOT, 'assets/images/allgo_logo.png'));

  process.stdout.write('Icônes générées pour 5 densités, plus le logo applicatif.\n');
}

void main().catch((error) => {
  process.stderr.write(`Échec : ${String(error)}\n`);
  process.exit(1);
});
