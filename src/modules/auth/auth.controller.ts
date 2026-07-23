import { Request, Response } from 'express';

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ConfigService } from '@nestjs/config';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { UserRole } from 'src/common/enums';

import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  HmoOnboardingDto,
  LoginDto,
  NgoOnboardingDto,
  PatientOnboardingDto,
  RegisterOrgDto,
  RegisterPatientDto,
  RegisterResearcherDto,
  RequestOtpDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';
import { BenefactorOnboardingDto, ProfessionalOnboardingDto } from 'src/modules/applications/dto/applications.dto';
import { ApplicationsService } from 'src/modules/applications/applications.service';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly applicationsService: ApplicationsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request OTP for researcher pre-registration email verification' })
  @ApiResponse({ status: 200, description: 'OTP sent to institutional email' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    await this.authService.requestOtp(dto);
    return { message: 'OTP sent to your email' };
  }

  @Post('register/patient')
  @ApiOperation({ summary: 'Register a patient with initial consent purposes' })
  @ApiResponse({ status: 201, description: 'Patient registered; access token in body, refresh token in httpOnly cookie' })
  @ApiResponse({ status: 409, description: 'Email, phone, or membership number already registered' })
  async registerPatient(
    @Body() dto: RegisterPatientDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.registerPatient(dto);
    this.setRefreshCookie(res, payload.refreshToken);
    return { accessToken: payload.accessToken, user: payload.user };
  }

  @Post('register/org')
  @ApiOperation({ summary: 'Register org staff + create pending organisation' })
  @ApiResponse({ status: 201, description: 'Org staff registered; org status pending_verification' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async registerOrg(
    @Body() dto: RegisterOrgDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.registerOrg(dto);
    this.setRefreshCookie(res, payload.refreshToken);
    return { accessToken: payload.accessToken, user: payload.user };
  }

  @Post('register/researcher')
  @ApiOperation({ summary: 'Register a researcher (requires prior OTP verification)' })
  @ApiResponse({ status: 201, description: 'Researcher registered' })
  @ApiResponse({ status: 400, description: 'Email domain not on institution allowlist' })
  @ApiResponse({ status: 401, description: 'OTP invalid or expired' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async registerResearcher(
    @Body() dto: RegisterResearcherDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.registerResearcher(dto);
    this.setRefreshCookie(res, payload.refreshToken);
    return { accessToken: payload.accessToken, user: payload.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Authenticated; access token in body, refresh token in httpOnly cookie' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account suspended' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.login(dto);
    this.setRefreshCookie(res, payload.refreshToken);
    return { accessToken: payload.accessToken, user: payload.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate access and refresh tokens using the httpOnly refresh cookie' })
  @ApiResponse({ status: 200, description: 'New access token issued; new refresh cookie set' })
  @ApiResponse({ status: 401, description: 'Refresh token missing, expired, or revoked' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!refreshToken) {
      throw new (await import('@nestjs/common')).UnauthorizedException('Refresh token missing');
    }
    const payload = await this.authService.refreshTokens(refreshToken);
    this.setRefreshCookie(res, payload.refreshToken);
    return { accessToken: payload.accessToken, user: payload.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke refresh token and clear cookie' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  @ApiResponse({ status: 401, description: 'Access token missing or invalid' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.authService.logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE);
    return { message: 'Logged out successfully' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({ status: 200, description: 'Reset link sent if email is registered (always returns 200)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete password reset using the token from the reset email' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 401, description: 'Reset token invalid or expired' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Password updated successfully.' };
  }

  @Post('signup')
  @ApiOperation({ summary: 'Create account with minimal details (name, email, password, role)' })
  @ApiResponse({ status: 201, description: 'Account created; access token in body, refresh token in httpOnly cookie' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = await this.authService.signupLite(dto);
    this.setRefreshCookie(res, payload.refreshToken);
    return { accessToken: payload.accessToken, user: payload.user };
  }

  @Post('onboarding/patient')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete patient health profile and consent selections' })
  @ApiResponse({ status: 201, description: 'Patient profile updated with onboarding data' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires patient role' })
  async onboardPatient(
    @Body() dto: PatientOnboardingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.authService.completePatientOnboarding(user.sub, dto);
  }

  @Post('onboarding/ngo')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.NGO_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit NGO organisation details for admin verification' })
  @ApiResponse({ status: 201, description: 'Organisation profile updated; verification job queued' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires ngo_admin role' })
  async onboardNgo(
    @Body() dto: NgoOnboardingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.authService.completeNgoOnboarding(user.orgId as string, dto);
  }

  @Post('onboarding/hmo')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.HMO_COORDINATOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit HMO organisation details for admin verification' })
  @ApiResponse({ status: 201, description: 'Organisation profile updated; verification job queued' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires hmo_coordinator role' })
  async onboardHmo(
    @Body() dto: HmoOnboardingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.authService.completeHmoOnboarding(user.orgId as string, dto);
  }

  @Post('onboarding/professional')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.PROFESSIONAL)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit professional application for admin verification' })
  @ApiResponse({ status: 201, description: 'Application submitted; pending admin review' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires professional role' })
  @ApiResponse({ status: 409, description: 'Application already submitted' })
  async onboardProfessional(
    @Body() dto: ProfessionalOnboardingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.applicationsService.createProfessional(user.sub, dto);
  }

  @Post('onboarding/benefactor')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(UserRole.BENEFACTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit benefactor application for admin verification' })
  @ApiResponse({ status: 201, description: 'Application submitted; pending admin review' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Requires benefactor role' })
  @ApiResponse({ status: 409, description: 'Application already submitted' })
  async onboardBenefactor(
    @Body() dto: BenefactorOnboardingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.applicationsService.createBenefactor(user.sub, dto);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.get<string>('app.nodeEnv') === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }
}
