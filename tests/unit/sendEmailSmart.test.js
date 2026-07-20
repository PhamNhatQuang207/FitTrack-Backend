// Mock both concrete senders so no real email/SMTP/Resend call is made.
jest.mock('../../src/utils/sendEmail', () => jest.fn());
jest.mock('../../src/utils/sendEmailResend', () => jest.fn());

const sendEmailSMTP = require('../../src/utils/sendEmail');
const sendEmailResend = require('../../src/utils/sendEmailResend');
const sendEmailSmart = require('../../src/utils/sendEmailSmart');

const options = { to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' };

describe('sendEmailSmart (unit) — service selection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    delete process.env.EMAIL_SERVICE;
  });

  test('uses Resend when EMAIL_SERVICE=resend', async () => {
    process.env.EMAIL_SERVICE = 'resend';
    sendEmailResend.mockResolvedValue({ data: { id: 'r1' } });

    await sendEmailSmart(options);

    expect(sendEmailResend).toHaveBeenCalledWith(options);
    expect(sendEmailSMTP).not.toHaveBeenCalled();
  });

  test('uses SMTP when EMAIL_SERVICE=smtp', async () => {
    process.env.EMAIL_SERVICE = 'smtp';
    sendEmailSMTP.mockResolvedValue({ messageId: 's1' });

    await sendEmailSmart(options);

    expect(sendEmailSMTP).toHaveBeenCalledWith(options);
    expect(sendEmailResend).not.toHaveBeenCalled();
  });

  test('defaults to Resend in production when EMAIL_SERVICE is unset', async () => {
    delete process.env.EMAIL_SERVICE;
    process.env.NODE_ENV = 'production';
    sendEmailResend.mockResolvedValue({ data: { id: 'r2' } });

    await sendEmailSmart(options);

    expect(sendEmailResend).toHaveBeenCalledTimes(1);
    expect(sendEmailSMTP).not.toHaveBeenCalled();
  });

  test('defaults to SMTP outside production when EMAIL_SERVICE is unset', async () => {
    delete process.env.EMAIL_SERVICE;
    process.env.NODE_ENV = 'development';
    sendEmailSMTP.mockResolvedValue({ messageId: 's2' });

    await sendEmailSmart(options);

    expect(sendEmailSMTP).toHaveBeenCalledTimes(1);
    expect(sendEmailResend).not.toHaveBeenCalled();
  });

  test('SMTP failure degrades gracefully (does not throw)', async () => {
    process.env.EMAIL_SERVICE = 'smtp';
    sendEmailSMTP.mockRejectedValue(new Error('SMTP down'));

    const result = await sendEmailSmart(options);

    expect(result).toEqual({ id: 'dev-mode-skipped' });
  });
});
