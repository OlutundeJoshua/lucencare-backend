// TODO: Implement — see docs/modules/auth.md

import { Controller, Post, Body } from '@nestjs/common';

import { AuthService } from './auth.service';
import {
  RegisterPatientDto,
  RegisterOrgDto,
  RegisterResearcherDto,
  LoginDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/patient')
  registerPatient(@Body() dto: RegisterPatientDto) {
    return this.authService.registerPatient(dto);
  }

  @Post('register/org')
  registerOrg(@Body() dto: RegisterOrgDto) {
    return this.authService.registerOrg(dto);
  }

  @Post('register/researcher')
  registerResearcher(@Body() dto: RegisterResearcherDto) {
    return this.authService.registerResearcher(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  refresh() {
    return this.authService.refresh();
  }

  @Post('logout')
  logout() {
    return this.authService.logout();
  }
}
