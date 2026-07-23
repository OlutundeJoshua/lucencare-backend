import * as nodemailer from 'nodemailer';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { MailService } from './mail.service';

jest.mock('nodemailer');

describe('MailService', () => {
  let service: MailService;
  let sendMail: jest.Mock;
  let createTransport: jest.Mock;

  const mailConfig: Record<string, unknown> = {
    'mail.host': 'smtp.example.com',
    'mail.port': 587,
    'mail.secure': false,
    'mail.user': 'user@example.com',
    'mail.password': 'secret',
    'mail.from': 'LucenCare <no-reply@lucencare.com>',
  };

  beforeEach(async () => {
    sendMail = jest.fn().mockResolvedValue(undefined);
    createTransport = nodemailer.createTransport as unknown as jest.Mock;
    createTransport.mockReturnValue({ sendMail });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => mailConfig[key]) },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds the transporter from mail config', () => {
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
  });

  it('sends an email with the configured from address', async () => {
    await service.send('patient@example.com', 'Welcome', 'Hello there');

    expect(sendMail).toHaveBeenCalledWith({
      from: 'LucenCare <no-reply@lucencare.com>',
      to: 'patient@example.com',
      subject: 'Welcome',
      text: 'Hello there',
    });
  });

  it('propagates the error when sendMail rejects', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await expect(service.send('patient@example.com', 'Welcome', 'Hello there')).rejects.toThrow(
      'SMTP connection refused',
    );
  });
});
