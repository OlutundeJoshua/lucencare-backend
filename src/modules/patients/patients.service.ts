// TODO: Implement — see docs/modules/patients.md

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Patient } from './entities/patient.entity';
import { CareEvent } from './entities/care-event.entity';
import { HmoLinkRequest } from './entities/hmo-link-request.entity';
import { UpdatePatientDto, LookupPatientDto, CreateCareEventDto } from './dto/patient.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { HmoLinkRequestStatus } from 'src/common/enums';

@Injectable()
export class PatientsService {
  constructor(
    @InjectRepository(Patient)
    private readonly patientRepo: Repository<Patient>,

    @InjectRepository(CareEvent)
    private readonly careEventRepo: Repository<CareEvent>,

    @InjectRepository(HmoLinkRequest)
    private readonly linkRequestRepo: Repository<HmoLinkRequest>,
  ) {}

  async getMyProfile() {
    throw new Error('Not implemented');
  }

  async updateMyProfile(_dto: UpdatePatientDto) {
    throw new Error('Not implemented');
  }

  async lookup(_dto: LookupPatientDto) {
    throw new Error('Not implemented');
  }

  async findOne(_id: string) {
    throw new Error('Not implemented');
  }

  async listEvents(_patientId: string, _pagination: PaginationDto) {
    throw new Error('Not implemented');
  }

  async createEvent(_patientId: string, _dto: CreateCareEventDto) {
    throw new Error('Not implemented');
  }

  async getSummary(_patientId: string) {
    // Validates export JWT before returning snapshot
    throw new Error('Not implemented');
  }

  async createLinkRequest(_patientId: string) {
    // Auth: hmo_coordinator — orgId from JWT (req.user.orgId)
    // 1. Find patient by id — 404 if not found
    // 2. Verify patient has active HMO_CARE consent grant — 403 if not
    // 3. Verify patient.hmoId IS NULL — 409 if already linked
    // 4. Verify no PENDING request for this patient-org pair — 409 if exists
    // 5. INSERT hmo_link_requests (status: PENDING, expiresAt: now + 7 days)
    // 6. NotificationsService.createOne() — type HMO_LINK_REQUEST, payload { orgId, orgName, linkRequestId }
    throw new Error('Not implemented');
  }

  async getMyLinkRequests(_status?: HmoLinkRequestStatus) {
    // Auth: patient — patientId resolved from req.user.sub via patients table
    // Return hmo_link_requests where patient_id = resolvedPatientId
    // Join organizations for orgName
    // Exclude expired rows (expires_at < NOW()) unless status filter is approved/rejected
    throw new Error('Not implemented');
  }

  async respondToLinkRequest(_requestId: string, _action: 'approve' | 'reject') {
    // Auth: patient — patientId resolved from req.user.sub
    // 1. Find request by id AND patient_id = resolvedPatientId — 404 if not found
    // 2. Verify status = PENDING — 409 if already actioned
    // 3. Verify expires_at > NOW() — 410 if expired
    // If approve:
    //   4a. Verify patient.hmoId IS NULL — 409 if already linked (race condition safety)
    //   4b. In a single transaction: UPDATE patients.hmo_id = orgId + UPDATE request status = APPROVED
    // If reject:
    //   4a. UPDATE request status = REJECTED
    throw new Error('Not implemented');
  }
}
