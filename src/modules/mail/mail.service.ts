import * as nodemailer from 'nodemailer';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
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

  async send(to: string, subject: string, body: string): Promise<void> {
    const from = this.configService.get<string>('mail.from');

    try {
      await this.transporter.sendMail({ from, to, subject, text: body });
      this.logger.log(`Email sent to=${to} subject="${subject}"`);
    } catch (err) {
      this.logger.error(`Failed to send email to=${to} subject="${subject}": ${(err as Error).message}`);
      throw err;
    }
  }
}
