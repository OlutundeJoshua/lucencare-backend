// TODO: Implement — see docs/modules/organizations.md

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/modules/auth/entities/user.entity';

import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { Organization } from './entities/organization.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, User])],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
