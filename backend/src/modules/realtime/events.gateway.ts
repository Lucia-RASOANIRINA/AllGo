import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/** Catalogue des événements temps réel — §7.5. */
export const RealtimeEvent = {
  MessageNew: 'message:new',
  OrderStatus: 'order:status',
  OrderNew: 'order:new',
  DeliveryPosition: 'delivery:position',
  NotificationNew: 'notification:new',
  StockAlert: 'stock:alert',
  PresenceUpdate: 'presence:update',
} as const;

/**
 * Passerelle Socket.IO.
 *
 * **Remplace intégralement le sondage HTTP toutes les 5 secondes du web**, qui
 * génère aujourd'hui 720 requêtes par heure et par onglet ouvert (§7.5).
 *
 * Le repli en interrogation longue (`polling`) est conservé : les WebSockets
 * sont fréquemment bloquées sur les réseaux mobiles malgaches, et une
 * connexion dégradée reste préférable à pas de connexion du tout.
 */
@WebSocketGateway({
  cors: { origin: true },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * L'autorisation est vérifiée **à la connexion**, jamais à l'émission.
   *
   * Un client rejoint uniquement les salons de sa propre portée : sa salle
   * personnelle, et celles des boutiques où il détient un rôle. Il ne peut donc
   * pas s'abonner aux commandes d'une boutique qui ne le concerne pas.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const raw =
        (client.handshake.auth?.token as string | undefined) ??
        client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!raw) throw new Error('jeton absent');

      const claims = await this.jwt.verifyAsync<AuthenticatedUser & { sub: string }>(raw, {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      });

      client.data.user = claims;
      await client.join(`user:${claims.sub}`);

      for (const assignment of claims.roles) {
        if (assignment.shopId) await client.join(`shop:${assignment.shopId}`);
      }
    } catch {
      // Aucune raison n'est communiquée : un message d'erreur détaillé
      // renseignerait un attaquant sur la validité de son jeton.
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug({ socketId: client.id }, 'Client déconnecté');
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  emitToShop(shopId: string, event: string, payload: unknown): void {
    this.server.to(`shop:${shopId}`).emit(event, payload);
  }
}
