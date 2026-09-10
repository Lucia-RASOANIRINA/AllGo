import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { AppError } from '../../common/http/app-error';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerification(to: string, token: string): Promise<void> {
    const host = this.config.get<string>('smtp.host');
    const user = this.config.get<string>('smtp.user');
    const password = this.config.get<string>('smtp.password');
    const from = this.config.getOrThrow<string>('smtp.from');
    const verificationUrl = this.config.getOrThrow<string>('smtp.verificationUrl');

    if (!host || !user || !password) {
      if (this.config.get<string>('env') !== 'production') {
        this.logger.debug(`Lien de vérification email pour ${to}: ${verificationUrl}?token=${token}`);
        return;
      }
      throw new AppError('EMAIL_GATEWAY_UNAVAILABLE', "L'envoi d'email n'est pas encore configuré.", 503);
    }

    const transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('smtp.port') ?? 587,
      secure: (this.config.get<number>('smtp.port') ?? 587) === 465,
      auth: { user, pass: password },
    });

    await transporter.sendMail({
      from,
      to,
      subject: 'Vérifiez votre adresse email AllGo',
      text: `Vérifiez votre adresse email en ouvrant ce lien : ${verificationUrl}?token=${token}`,
      html: `<p>Bienvenue sur AllGo.</p><p><a href="${verificationUrl}?token=${token}">Vérifier mon adresse email</a></p><p>Ce lien expire dans 30 minutes.</p>`,
    });
  }
}