// TODO: Implement — see docs/modules/auth.md

import { Injectable } from '@nestjs/common';

import {
  RegisterPatientDto,
  RegisterOrgDto,
  RegisterResearcherDto,
  LoginDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  async registerPatient(_dto: RegisterPatientDto) {
    // Atomic: users + patients + consent_grants
    throw new Error('Not implemented');
  }

  async registerOrg(_dto: RegisterOrgDto) {
    // Creates users row + pending organizations row
    throw new Error('Not implemented');
  }

  async registerResearcher(_dto: RegisterResearcherDto) {
    // Validates institutional email, OTP, creates user
    throw new Error('Not implemented');
  }

  async login(_dto: LoginDto) {
    // Validates credentials, issues access token + refresh cookie
    throw new Error('Not implemented');
  }

  async refresh() {
    // Validates refresh cookie jti against Redis revocation set
    throw new Error('Not implemented');
  }

  async logout() {
    // Writes refresh jti to Redis revocation set
    throw new Error('Not implemented');
  }
}
