import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'conversations', timestamps: true })
export class Conversation extends Document {
  @Prop({ type: [Object], required: true })
  participants!: Array<{
    userId: Types.ObjectId;
    name: string;
    avatar?: string;
    shopId?: Types.ObjectId;
  }>;

  /** Instantané du dernier message : la liste des conversations se rend sans jointure. */
  @Prop({ type: Object })
  lastMessage?: { content: string; senderId: Types.ObjectId; sentAt: Date };

  /** Compteur de non-lus par participant : `{ "<userId>": 3 }`. */
  @Prop({ type: Map, of: Number, default: {} })
  unread!: Map<string, number>;

  /**
   * Blocage — même motif que le reste de la modération (`reported` sur
   * `Review`/`Post`) : un drapeau, jamais une suppression. Le blocage est
   * porté par la conversation plutôt que par une relation `User`↔`User`
   * séparée, car c'est bien LE canal entre ces deux personnes qui se ferme,
   * pas leur compte l'un pour l'autre à l'échelle de toute l'application.
   */
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] }) blockedBy!: Types.ObjectId[];
  @Prop({ default: false, index: true }) reported!: boolean;
  @Prop() reportReason?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ConversationDocument = HydratedDocument<Conversation>;
export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ 'participants.userId': 1, updatedAt: -1 });

/**
 * Messages en collection séparée. Un tableau `messages[]` embarqué dans la
 * conversation est l'antipatron aggravé par le volume (§6.5).
 */
@Schema({ collection: 'messages', timestamps: { createdAt: true, updatedAt: false } })
export class Message extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Conversation', required: true })
  conversationId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) senderId!: Types.ObjectId;
  @Prop({ maxlength: 4000 }) content?: string;

  @Prop({ type: [Object], default: [] })
  attachments!: Array<{ url: string; type: string; name?: string; size?: number }>;

  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] }) readBy!: Types.ObjectId[];

  createdAt!: Date;
}

export type MessageDocument = HydratedDocument<Message>;
export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
