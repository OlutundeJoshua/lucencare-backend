// TODO: Implement — see docs/modules/consents.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConsentGrant } from './entities/consent-grant.entity';
import { CreateConsentGrantDto, UpdateConsentDto } from './dto/consent.dto';
import { ConsentPurpose, ConsentStatus } from 'src/common/enums';

@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(ConsentGrant)
    private readonly consentRepo: Repository<ConsentGrant>,
  ) {}

  async listForCurrentPatient() {
    throw new Error('Not implemented');
  }

  async create(_dto: CreateConsentGrantDto) {
    throw new Error('Not implemented');
  }

  async transition(_id: string, _dto: UpdateConsentDto) {
    // Validates state machine: NOT_GRANTED→PENDING→ACTIVE→PAUSED→ACTIVE / REVOKED
    // On REVOKED: tombstone enrollments, write audit, enqueue consent_revoked job
    throw new Error('Not implemented');
  }

  async getImpact(_id: string) {
    throw new Error('Not implemented');
  }

  async hasActiveGrant(_patientId: string, _purpose: ConsentPurpose): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async revokeAndCascade(_id: string, _patientId: string) {
    // Atomic: update status, tombstone enrollments, audit, enqueue job
    throw new Error('Not implemented');
  }

  async createForPatient(_patientId: string, _purposes: ConsentPurpose[]) {
    throw new Error('Not implemented');
  }

  async findActiveByPatientAndPurpose(_patientId: string, _purpose: ConsentPurpose) {
    throw new Error('Not implemented');
  }

  async findById(_id: string): Promise<ConsentGrant> {
    throw new Error('Not implemented');
  }
}
