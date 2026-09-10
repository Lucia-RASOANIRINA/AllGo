import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

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
  // Chemin déplacé sous `/v1/` : c'est le seul segment que le `.htaccess` du
  // site PHP historique laisse passer vers Passenger (même contrainte que
  // Swagger, cf. `useGlobalPrefix` dans `main.ts`) — le chemin par défaut
  // `/socket.io/` tombe sur le site PHP (404) avant même d'atteindre Node.
  path: '/v1/socket.io/',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

  @SubscribeMessage('delivery:subscribe')
  async subscribeDelivery(client: Socket, @MessageBody() body: { orderId: string }) {
    const user = client.data.user as AuthenticatedUser;
    const orderId = Number(body.orderId);
    if (!Number.isInteger(orderId)) return { ok: false };
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, OR: [{ user_id: user.mysqlId }, { courier_id: user.mysqlId }] },
      select: { id: true },
    });
    if (!order) return { ok: false };
    await client.join(`delivery:${body.orderId}`);
    return { ok: true };
  }

  @SubscribeMessage('delivery:position')
  async updateDeliveryPosition(
    client: Socket,
    @MessageBody() body: { orderId: string; latitude: number; longitude: number; remainingDistance?: number; etaMinutes?: number },
  ) {
    const user = client.data.user as AuthenticatedUser;
    const orderId = Number(body.orderId);
    if (!Number.isInteger(orderId) ||
        !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) ||
        body.latitude < -90 || body.latitude > 90 || body.longitude < -180 || body.longitude > 180) {
      return { ok: false };
    }
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId, courier_id: user.mysqlId },
      select: { user_id: true },
    });
    if (!order) return { ok: false };
    const payload = { ...body, updatedAt: new Date().toISOString() };
    await this.prisma.orders.updateMany({
      where: { id: orderId, courier_id: user.mysqlId },
      data: {
        courier_latitude: body.latitude,
        courier_longitude: body.longitude,
        courier_location_updated_at: new Date(),
      },
    });
    this.server.to(`delivery:${body.orderId}`).emit(RealtimeEvent.DeliveryPosition, payload);
    this.emitToUser(String(order.user_id), RealtimeEvent.DeliveryPosition, payload);
    return { ok: true };
  }
}
