import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Client de la vraie base MySQL du site web (`arur4976_janga_market`).
 *
 * Distincte de Mongoose (source de vérité historique de ce backend) : les
 * fonctionnalités ajoutées directement sur les tables MySQL existantes
 * (KYC, favoris de publication, abonnement boutique, réactions de story,
 * journal admin, paramètres) passent par ce client, jamais par Mongoose.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connecté à MySQL (arur4976_janga_market).');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Résout l'identifiant entier MySQL correspondant à l'utilisateur
   * authentifié (dont le JWT porte un ObjectId Mongo).
   *
   * PONT TEMPORAIRE le temps de la transition Mongo → MySQL (§ décision du
   * 2026-09-09) : le numéro de téléphone est le seul identifiant commun aux
   * deux systèmes, unique dans chacun. Une fois l'authentification elle-même
   * migrée vers MySQL, cette résolution disparaît — `AuthenticatedUser.id`
   * portera alors directement l'entier.
   *
   * Comparaison par SUFFIXE, pas par égalité stricte : le backend Mongo
   * normalise tous les numéros en `+261XXXXXXXXX` (`auth.service.ts`), alors
   * que la base héritée du site web les a conservés tels que saisis à
   * l'origine (`0XXXXXXXXX`, sans indicatif). Les neuf derniers chiffres
   * restent identiques dans les deux cas — c'est la seule portion fiable à
   * comparer.
   */
  async resolveUserId(phone: string): Promise<number> {
    const localDigits = phone.replace(/\D/g, '').slice(-9);
    const user = await this.users.findFirst({
      where: { phone: { endsWith: localDigits } },
      select: { id: true },
    });
    if (!user) {
      throw new Error(`Aucun utilisateur MySQL dont le téléphone se termine par ${localDigits} — compte non migré ?`);
    }
    return user.id;
  }
}
