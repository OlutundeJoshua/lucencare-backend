import * as nodemailer from 'nodemailer';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { EmailContent } from 'src/common/interfaces/email-content.interface';

import { EmailRendererService } from './email-renderer.service';
import { MailService } from './mail.service';

jest.mock('nodemailer');

const CONTENT: EmailContent = {
  preheader: 'A short snippet',
  blocks: [
    { kind: 'paragraph', text: 'Hello there' },
    { kind: 'signoff', text: 'The LucenCare Team' },
  ],
};

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
    'mail.logoUrl': 'https://cdn.lucencare.test/logo-email.png',
    'mail.brandUrl': 'https://app.lucencare.test',
    'mail.supportEmail': 'support@lucencare.test',
  };

  beforeEach(async () => {
    sendMail = jest.fn().mockResolvedValue(undefined);
    createTransport = nodemailer.createTransport as unknown as jest.Mock;
    createTransport.mockReturnValue({ sendMail });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        EmailRendererService,
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

  it('sends from the configured address to the given recipient', async () => {
    await service.send('patient@example.com', 'Welcome', CONTENT);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: 'LucenCare <no-reply@lucencare.com>',
      to: 'patient@example.com',
      subject: 'Welcome',
    });
  });

  // Sending HTML alone breaks text-only clients and screen readers, and reads as spam
  // to most filters. Both parts always go out together.
  it('sends both an HTML and a plain-text part', async () => {
    await service.send('patient@example.com', 'Welcome', CONTENT);

    const { html, text } = sendMail.mock.calls[0][0];

    expect(text).toBe('Hello there\n\nThe LucenCare Team');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Hello there');
  });

  it('brands the HTML part with the configured logo', async () => {
    await service.send('patient@example.com', 'Welcome', CONTENT);

    expect(sendMail.mock.calls[0][0].html).toContain(
      'src="https://cdn.lucencare.test/logo-email.png"',
    );
  });

  it('puts the subject in the HTML title', async () => {
    await service.send('patient@example.com', 'Your code', CONTENT);

    expect(sendMail.mock.calls[0][0].html).toContain('<title>Your code</title>');
  });

  it('propagates the error when sendMail rejects', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await expect(service.send('patient@example.com', 'Welcome', CONTENT)).rejects.toThrow(
      'SMTP connection refused',
    );
  });

  // The rendered body carries the OTP, temporary password and patient details the email
  // exists to deliver — CLAUDE.md §8 forbids logging any of it.
  it('logs the recipient and subject but never the rendered body', async () => {
    const log = jest.spyOn(service['logger'], 'log').mockImplementation();

    await service.send('patient@example.com', 'Welcome', {
      blocks: [{ kind: 'code', value: '482913' }],
    });

    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('patient@example.com');
    expect(logged).toContain('Welcome');
    expect(logged).not.toContain('482913');
  });
});
