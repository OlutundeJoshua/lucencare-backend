// TODO: Implement — see docs/modules/app.md

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';

import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ConsentsModule } from './modules/consents/consents.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { StudiesModule } from './modules/studies/studies.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { MatchingModule } from './modules/matching/matching.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ExportModule } from './modules/export/export.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { QueuesModule } from './queues/queues.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
      envFilePath: '.env',
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.body.password'],
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      },
    }),

    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'),
        synchronize: false,
        autoLoadEntities: true,
      }),
      inject: [ConfigService],
    }),

    ThrottlerModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('app.throttleTtl', 60),
            limit: configService.get<number>('app.throttleLimit', 60),
          },
        ],
        storage: new ThrottlerStorageRedisService({
          host: configService.get<string>('app.redisHost', 'localhost'),
          port: configService.get<number>('app.redisPort', 6379),
          password: configService.get<string>('app.redisPassword'),
        }),
      }),
      inject: [ConfigService],
    }),

    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),

    AuthModule,
    PatientsModule,
    OrganizationsModule,
    ConsentsModule,
    ProgramsModule,
    StudiesModule,
    EnrollmentsModule,
    MatchingModule,
    NotificationsModule,
    MessagesModule,
    ExportModule,
    AuditModule,
    AdminModule,
    QueuesModule,
    HealthModule,
  ],
})
export class AppModule {}
