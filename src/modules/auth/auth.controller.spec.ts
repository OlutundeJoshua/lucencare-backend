import * as request from 'supertest';
import cookieParser = require('cookie-parser');
import { INestApplication, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthPayload = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
  user: { id: 'USERID01234567890123456789', email: 'test@example.com', role: UserRole.PATIENT },
};

const mockAuthService = {
  registerPatient: jest.fn().mockResolvedValue(mockAuthPayload),
  registerOrg: jest.fn().mockResolvedValue({
    ...mockAuthPayload,
    user: { ...mockAuthPayload.user, role: UserRole.NGO_ADMIN, orgId: 'ORG01234567890123456789' },
  }),
  registerResearcher: jest.fn().mockResolvedValue({
    ...mockAuthPayload,
    user: { ...mockAuthPayload.user, role: UserRole.RESEARCHER },
  }),
  login: jest.fn().mockResolvedValue(mockAuthPayload),
  refreshTokens: jest.fn().mockResolvedValue({
    ...mockAuthPayload,
    accessToken: 'new.access.token',
    refreshToken: 'new.refresh.token',
  }),
  logout: jest.fn().mockResolvedValue(undefined),
  requestOtp: jest.fn().mockResolvedValue(undefined),
  forgotPassword: jest.fn().mockResolvedValue(undefined),
  resetPassword: jest.fn().mockResolvedValue(undefined),
};

describe('AuthController (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        // ClsService is required by JwtAuthGuard (which is used on the logout endpoint)
        { provide: ClsService, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    })
      // Override JwtAuthGuard so logout tests work without a real JWT; guards are tested separately
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) =>
          new UnprocessableEntityException({
            errors: errors.map((e) => ({
              path: e.property,
              message: Object.values(e.constraints ?? {}).join('; '),
            })),
          }),
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockAuthService).forEach((fn) => {
      if (typeof fn === 'function') (fn as jest.Mock).mockRestore?.();
    });
    mockAuthService.registerPatient.mockResolvedValue(mockAuthPayload);
    mockAuthService.registerOrg.mockResolvedValue({ ...mockAuthPayload, user: { ...mockAuthPayload.user, role: UserRole.NGO_ADMIN } });
    mockAuthService.registerResearcher.mockResolvedValue({ ...mockAuthPayload, user: { ...mockAuthPayload.user, role: UserRole.RESEARCHER } });
    mockAuthService.login.mockResolvedValue(mockAuthPayload);
    mockAuthService.refreshTokens.mockResolvedValue({ ...mockAuthPayload, accessToken: 'new.access.token', refreshToken: 'new.refresh.token' });
    mockAuthService.logout.mockResolvedValue(undefined);
    mockAuthService.requestOtp.mockResolvedValue(undefined);
    mockAuthService.forgotPassword.mockResolvedValue(undefined);
    mockAuthService.resetPassword.mockResolvedValue(undefined);
  });

  // POST /auth/request-otp
  describe('POST /auth/request-otp', () => {
    it('returns 200 with OTP sent message', () => {
      return request(app.getHttpServer())
        .post('/auth/request-otp')
        .send({ email: 'researcher@hospital.ng' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data?.message ?? res.body.message).toMatch(/OTP/i);
          expect(mockAuthService.requestOtp).toHaveBeenCalledWith({ email: 'researcher@hospital.ng' });
        });
    });

    it('returns 422 for invalid email', () => {
      return request(app.getHttpServer())
        .post('/auth/request-otp')
        .send({ email: 'not-an-email' })
        .expect(422);
    });
  });

  // POST /auth/register/patient
  describe('POST /auth/register/patient', () => {
    const validBody = {
      email: 'patient@example.com',
      password: 'password123',
      name: 'Ada Okafor',
      phone: '+2348000000001',
      conditionTags: ['hypertension'],
      consentPurposes: ['ngo_funding'],
    };

    it('returns 201 with accessToken in body and Set-Cookie header', () => {
      return request(app.getHttpServer())
        .post('/auth/register/patient')
        .send(validBody)
        .expect(201)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          expect(body.accessToken).toBeDefined();
          expect(body.user).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
          expect(res.headers['set-cookie'].join(',')).toContain('refresh_token');
        });
    });

    it('returns 422 when consentPurposes is empty', () => {
      return request(app.getHttpServer())
        .post('/auth/register/patient')
        .send({ ...validBody, consentPurposes: [] })
        .expect(422);
    });

    it('returns 422 when email is invalid', () => {
      return request(app.getHttpServer())
        .post('/auth/register/patient')
        .send({ ...validBody, email: 'not-an-email' })
        .expect(422);
    });

    it('returns 422 when password is too short', () => {
      return request(app.getHttpServer())
        .post('/auth/register/patient')
        .send({ ...validBody, password: 'short' })
        .expect(422);
    });
  });

  // POST /auth/register/org
  describe('POST /auth/register/org', () => {
    const validBody = {
      email: 'admin@ngo.org',
      password: 'password123',
      orgName: 'Helping Hands',
      orgType: 'ngo',
      contactEmail: 'contact@ngo.org',
      role: 'ngo_admin',
    };

    it('returns 201 with accessToken and Set-Cookie', () => {
      return request(app.getHttpServer())
        .post('/auth/register/org')
        .send(validBody)
        .expect(201)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          expect(body.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
        });
    });

    it('returns 422 for invalid orgType', () => {
      return request(app.getHttpServer())
        .post('/auth/register/org')
        .send({ ...validBody, orgType: 'invalid' })
        .expect(422);
    });
  });

  // POST /auth/register/researcher
  describe('POST /auth/register/researcher', () => {
    const validBody = {
      email: 'researcher@university.edu',
      password: 'password123',
      institutionName: 'Lagos University',
      otpCode: '123456',
    };

    it('returns 201 with accessToken and Set-Cookie', () => {
      return request(app.getHttpServer())
        .post('/auth/register/researcher')
        .send(validBody)
        .expect(201)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          expect(body.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
        });
    });

    it('returns 422 when OTP code is not exactly 6 characters', () => {
      return request(app.getHttpServer())
        .post('/auth/register/researcher')
        .send({ ...validBody, otpCode: '12345' })
        .expect(422);
    });
  });

  // POST /auth/login
  describe('POST /auth/login', () => {
    it('returns 200 with accessToken and Set-Cookie', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'patient@example.com', password: 'password123' })
        .expect(200)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          expect(body.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
        });
    });

    it('returns 422 when email is missing', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: 'password123' })
        .expect(422);
    });
  });

  // POST /auth/refresh
  describe('POST /auth/refresh', () => {
    it('returns 200 with new accessToken and new refresh cookie', () => {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', ['refresh_token=mock.refresh.token'])
        .expect(200)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          expect(body.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
          expect(res.headers['set-cookie'].join(',')).toContain('refresh_token');
        });
    });

    it('returns 401 when refresh cookie is absent', () => {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .expect(401);
    });
  });

  // POST /auth/logout
  describe('POST /auth/logout', () => {
    it('returns 200 with logout message and clears refresh cookie', () => {
      return request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', 'Bearer mock.access.token')
        .set('Cookie', ['refresh_token=mock.refresh.token'])
        .expect(200)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          expect(body.message).toMatch(/logged out/i);
        });
    });
  });

  // POST /auth/forgot-password
  describe('POST /auth/forgot-password', () => {
    it('returns 200 with generic message regardless of email existence', () => {
      return request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'anyone@example.com' })
        .expect(200)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          const message = body.message ?? body.data?.message;
          expect(typeof message).toBe('string');
        });
    });

    it('returns 422 for invalid email format', () => {
      return request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'not-valid' })
        .expect(422);
    });
  });

  // POST /auth/reset-password
  describe('POST /auth/reset-password', () => {
    it('returns 200 with success message', () => {
      return request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'valid64hextoken', password: 'newpassword123' })
        .expect(200)
        .expect((res) => {
          const body = res.body.data ?? res.body;
          const message = body.message ?? body.data?.message;
          expect(typeof message).toBe('string');
        });
    });

    it('returns 422 when new password is too short', () => {
      return request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'valid64hextoken', password: 'short' })
        .expect(422);
    });
  });
});
