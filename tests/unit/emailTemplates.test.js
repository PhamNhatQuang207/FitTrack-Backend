const { buildVerificationEmail, buildResetPasswordEmail } = require('../../src/utils/emailTemplates');

describe('emailTemplates', () => {
  test('renders English verification email with 24h notice, text fallback, and escaped HTML', () => {
    const email = buildVerificationEmail({
      name: 'Quang <b>Admin</b>',
      verifyUrl: 'https://fittrack.io.vn/verify?t=1',
    });
    expect(email.subject).toMatch(/Verify Your Email/i);
    expect(email.html).toContain('https://fittrack.io.vn/verify?t=1');
    expect(email.html).toContain('Quang &lt;b&gt;Admin&lt;/b&gt;');
    expect(email.html).toMatch(/24 hours/i);
    expect(email.text).toContain('https://fittrack.io.vn/verify?t=1');
  });

  test('renders Vietnamese verification and reset emails when lang=vi with expiry notices', () => {
    const verify = buildVerificationEmail({ name: 'Quang', verifyUrl: 'https://fittrack.io.vn/v', lang: 'vi' });
    const reset = buildResetPasswordEmail({ name: 'Quang', resetUrl: 'https://fittrack.io.vn/r', lang: 'vi' });
    expect(verify.subject).toMatch(/Xác thực/i);
    expect(verify.html).toMatch(/24 giờ/i);
    expect(verify.text).toMatch(/24 giờ/i);
    expect(reset.subject).toMatch(/Đặt lại mật khẩu/i);
    expect(reset.html).toMatch(/1 giờ/i);
    expect(reset.text).toMatch(/1 giờ/i);
  });
});
