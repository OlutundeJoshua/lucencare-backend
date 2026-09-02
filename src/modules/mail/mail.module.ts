import { Module } from '@nestjs/common';

import { EmailRendererService } from './email-renderer.service';
import { MailService } from './mail.service';

@Module({
  providers: [EmailRendererService, MailService],
  exports: [EmailRendererService, MailService],
})
export class MailModule {}
