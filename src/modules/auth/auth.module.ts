import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { ADMIN_QUEUE, MAIL_QUEUE } from 'src/queues/queues.constants';
import { AuditModule } from 'src/modules/audit/audit.module';
import { PatientsModule } from 'src/modules/patients/patients.module';
import { OrganizationsModule } from 'src/modules/organizations/organizations.module';
import { ConsentsModule } from 'src/modules/consents/consents.module';
import { ApplicationsModule } from 'src/modules/applications/applications.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        privateKey: configService.get<string>('jwt.privateKey'),
        publicKey: configService.get<string>('jwt.publicKey'),
        signOptions: {
          algorithm: 'RS256',
          expiresIn: configService.get<string>('jwt.accessTokenExpiresIn', '15m'),
        },
      }),
      inject: [ConfigService],
    }),

    BullModule.registerQueue({ name: MAIL_QUEUE }, { name: ADMIN_QUEUE }),

    // These modules are imported so their entities are registered with TypeORM autoLoadEntities.
    // AuthService uses DataSource.transaction() with manager.getRepository() for atomic
    // cross-entity writes — no services from these modules are injected into AuthService.
    PatientsModule,
    OrganizationsModule,
    ConsentsModule,

    AuditModule,
    ApplicationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
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
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
