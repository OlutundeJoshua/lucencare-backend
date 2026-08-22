import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';

import aiConfig from './config/ai.config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import mailConfig from './config/mail.config';

import { CommonModule } from './common/common.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { MedicationsModule } from './modules/medications/medications.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ConsentsModule } from './modules/consents/consents.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { StudiesModule } from './modules/studies/studies.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { MatchingModule } from './modules/matching/matching.module';
import { CommunityModule } from './modules/community/community.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ExportModule } from './modules/export/export.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { QueuesModule } from './queues/queues.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [aiConfig, appConfig, databaseConfig, jwtConfig, mailConfig],
      envFilePath: '.env',
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.body.password'],
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,req.headers,res.headers',
                  messageFormat: '{context} {msg}',
                },
              },
      },
    }),

    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'),
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
          username: configService.get<string>('app.redisUsername', 'default'),
          password: configService.get<string>('app.redisPassword'),
          ...(configService.get<boolean>('app.redisTls') ? { tls: {} } : {}),
        }),
      }),
      inject: [ConfigService],
    }),

    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),

    CommonModule,
    AuthModule,
    PatientsModule,
    MedicationsModule,
    AppointmentsModule,
    OrganizationsModule,
    ConsentsModule,
    ProgramsModule,
    StudiesModule,
    EnrollmentsModule,
    MatchingModule,
    CommunityModule,
    NotificationsModule,
    MessagesModule,
    ExportModule,
    AuditModule,
    AdminModule,
    AiModule,
    ApplicationsModule,
    QueuesModule,
    HealthModule,
  ],
  providers: [TransformInterceptor, GlobalExceptionFilter],
})
export class AppModule {}
