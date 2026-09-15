import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { AppError } from '../../common/http/app-error';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerification(to: string, token: string): Promise<void> {
    const verificationUrl = this.config.getOrThrow<string>('smtp.verificationUrl');
    const transporter = await this.getTransporter(
      () => this.logger.debug(`Lien de vérification email pour ${to}: ${verificationUrl}?token=${token}`),
    );
    if (!transporter) return;

    await transporter.sendMail({
      from: this.config.getOrThrow<string>('smtp.from'),
      to,
      subject: 'Vérifiez votre adresse email AllGo',
      text: `Vérifiez votre adresse email en ouvrant ce lien : ${verificationUrl}?token=${token}`,
      html: `<p>Bienvenue sur AllGo.</p><p><a href="${verificationUrl}?token=${token}">Vérifier mon adresse email</a></p><p>Ce lien expire dans 30 minutes.</p>`,
    });
  }

  /**
   * Mot de passe temporaire — voie « mot de passe oublié » par email (le SMS
   * n'est pas encore branché, §12.2). Valable 30 minutes côté `AuthService`,
   * limité à 2 demandes par jour et par adresse.
   */
  async sendTemporaryPassword(to: string, tempPassword: string): Promise<void> {
    const transporter = await this.getTransporter(
      () => this.logger.debug(`Mot de passe temporaire pour ${to} : ${tempPassword}`),
    );
    if (!transporter) return;

    await transporter.sendMail({
      from: this.config.getOrThrow<string>('smtp.from'),
      to,
      subject: 'Votre mot de passe temporaire AllGo',
      text: `Votre mot de passe temporaire : ${tempPassword} (valable 30 minutes).`,
      html:
        '<p>Voici votre mot de passe temporaire AllGo :</p>' +
        `<p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${tempPassword}</p>` +
        '<p>Il est valable 30 minutes et vous permet de vous connecter. ' +
        'Nous vous recommandons de définir un nouveau mot de passe une fois connecté.</p>',
    });
  }

  /**
   * `null` en développement sans SMTP configuré : l'appelant journalise via
   * `onDebugFallback` et s'arrête là. En production sans SMTP, l'envoi doit
   * échouer bruyamment plutôt que de prétendre avoir réussi.
   */
  private async getTransporter(onDebugFallback: () => void): Promise<nodemailer.Transporter | null> {
    const host = this.config.get<string>('smtp.host');
    const user = this.config.get<string>('smtp.user');
    const password = this.config.get<string>('smtp.password');

    if (!host || !user || !password) {
      if (this.config.get<string>('env') !== 'production') {
        onDebugFallback();
        return null;
      }
      throw new AppError('EMAIL_GATEWAY_UNAVAILABLE', "L'envoi d'email n'est pas encore configuré.", 503);
    }

    return nodemailer.createTransport({
      host,
      port: this.config.get<number>('smtp.port') ?? 587,
      secure: (this.config.get<number>('smtp.port') ?? 587) === 465,
      auth: { user, pass: password },
    });
  }
}
