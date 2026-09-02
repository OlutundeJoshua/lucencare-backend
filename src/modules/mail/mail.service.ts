import * as nodemailer from 'nodemailer';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailContent } from 'src/common/interfaces/email-content.interface';

import { EmailRendererService } from './email-renderer.service';
import { renderEmailText } from './email-text.util';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly emailRenderer: EmailRendererService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('mail.host'),
      port: this.configService.get<number>('mail.port'),
      secure: this.configService.get<boolean>('mail.secure'),
      auth: {
        user: this.configService.get<string>('mail.user'),
        pass: this.configService.get<string>('mail.password'),
      },
    });
  }

  /**
   * Sends one transactional email as multipart/alternative — the branded HTML part and
   * a plain-text part, both rendered from the same `content`. Sending HTML alone would
   * break text-only clients and screen readers and reads as spam to most filters.
   */
  async send(to: string, subject: string, content: EmailContent): Promise<void> {
    const from = this.configService.get<string>('mail.from');

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject,
        text: renderEmailText(content),
        html: this.emailRenderer.toHtml(subject, content),
      });
      // Recipient and subject only — never the rendered body, which carries the
      // OTP, temporary password and patient details this email exists to deliver.
      this.logger.log(`Email sent to=${to} subject="${subject}"`);
    } catch (err) {
      this.logger.error(
        `Failed to send email to=${to} subject="${subject}": ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
