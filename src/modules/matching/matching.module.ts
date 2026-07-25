import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { ConsentGrant } from 'src/modules/consents/entities/consent-grant.entity';
import { Patient } from 'src/modules/patients/entities/patient.entity';
import { Program } from 'src/modules/programs/entities/program.entity';
import { Study } from 'src/modules/studies/entities/study.entity';

import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [TypeOrmModule.forFeature([Program, Study, Patient, ConsentGrant])],
  controllers: [MatchingController],
  providers: [
    MatchingService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) =>
        new Redis({
          host: configService.get<string>('app.redisHost', 'localhost'),
          port: configService.get<number>('app.redisPort', 6379),
          password: configService.get<string>('app.redisPassword'),
          lazyConnect: true,
          ...(configService.get<boolean>('app.redisTls') ? { tls: {} } : {}),
        }),
      inject: [ConfigService],
    },
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
