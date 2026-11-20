const {
  buildVerificationEmail,
  buildResetPasswordEmail,
  buildAccountExistsEmail,
  buildGoogleResetNoticeEmail,
} = require('../../src/utils/emailTemplates');

const assertMatchesNewUi = (html) => {
  expect(html).toContain('#050505');
  expect(html).toContain('#0A0A0A');
  expect(html).toContain('#CCFF00');
  expect(html).toContain('Barlow Condensed');
  expect(html).toContain('FITTRACK');
  expect(html).not.toContain('#3b82f6');
  expect(html).not.toContain('#8b5cf6');
  expect(html).not.toContain('<svg');
};

describe('emailTemplates', () => {
  test('renders English verification email with sporty UI, 24h notice, text fallback, and escaped HTML', () => {
    const email = buildVerificationEmail({
      name: 'Quang <b>Admin</b>',
      verifyUrl: 'https://fittrack.io.vn/verify-email?token=1&ref=a',
    });

    expect(email.subject).toMatch(/Verify Your Email/i);
    assertMatchesNewUi(email.html);
    expect(email.html).toContain('https://fittrack.io.vn/verify-email?token=1&amp;ref=a');
    expect(email.html).toContain('Quang &lt;b&gt;Admin&lt;/b&gt;');
    expect(email.html).toMatch(/24 hours/i);
    expect(email.text).toContain('https://fittrack.io.vn/verify-email?token=1&ref=a');
    expect(email.text).toMatch(/24 hours/i);
  });

  test('renders Vietnamese verification and reset emails when lang=vi with expiry notices', () => {
    const verify = buildVerificationEmail({
      name: 'Quang',
      verifyUrl: 'https://fittrack.io.vn/verify-email?token=v',
      lang: 'vi',
    });
    const reset = buildResetPasswordEmail({
      name: 'Quang',
      resetUrl: 'https://fittrack.io.vn/reset-password?token=r',
      lang: 'vi',
    });

    assertMatchesNewUi(verify.html);
    assertMatchesNewUi(reset.html);
    expect(reset.html).toContain('#FF5C00');

    expect(verify.subject).toMatch(/Xác thực/i);
    expect(verify.html).toMatch(/24 giờ/i);
    expect(verify.text).toMatch(/24 giờ/i);

    expect(reset.subject).toMatch(/Đặt lại mật khẩu/i);
    expect(reset.html).toMatch(/1 giờ/i);
    expect(reset.text).toMatch(/1 giờ/i);
    expect(reset.text).toContain('https://fittrack.io.vn/reset-password?token=r');
  });

  test('renders English reset email with #FF5C00 security theme and 1h notice', () => {
    const email = buildResetPasswordEmail({
      name: 'Alex',
      resetUrl: 'https://fittrack.io.vn/reset-password?token=abc',
      lang: 'en',
    });

    expect(email.subject).toMatch(/Password Reset/i);
    assertMatchesNewUi(email.html);
    expect(email.html).toContain('#FF5C00');
    expect(email.html).toMatch(/1 hour/i);
    expect(email.text).toMatch(/1 hour/i);
    expect(email.text).toContain('https://fittrack.io.vn/reset-password?token=abc');
  });

  test('renders account-exists notice for Google-only vs password accounts in EN & VI', () => {
    const googleEn = buildAccountExistsEmail({
      name: 'Quang <script>',
      loginUrl: 'https://fittrack.io.vn/login',
      isGoogleOnly: true,
      hasGoogle: true,
      lang: 'en',
    });

    expect(googleEn.subject).toMatch(/Account Already Exists/i);
    assertMatchesNewUi(googleEn.html);
    expect(googleEn.html).toContain('#FF5C00');
    expect(googleEn.html).toContain('Quang &lt;script&gt;');
    expect(googleEn.html).toMatch(/Google/i);
    expect(googleEn.html).toContain('https://fittrack.io.vn/login');
    expect(googleEn.html).not.toContain('/reset-password');
    expect(googleEn.text).toMatch(/Google/i);
    expect(googleEn.text).toContain('https://fittrack.io.vn/login');

    const pwVi = buildAccountExistsEmail({
      name: 'Quang',
      loginUrl: 'https://fittrack.io.vn/login',
      resetUrl: 'https://fittrack.io.vn/reset-password',
      isGoogleOnly: false,
      hasGoogle: false,
      lang: 'vi',
    });

    expect(pwVi.subject).toMatch(/tồn tại/i);
    assertMatchesNewUi(pwVi.html);
    expect(pwVi.html).toContain('https://fittrack.io.vn/login');
    expect(pwVi.html).toContain('https://fittrack.io.vn/reset-password');
    expect(pwVi.text).toContain('https://fittrack.io.vn/login');
    expect(pwVi.text).toContain('https://fittrack.io.vn/reset-password');
  });

  test('renders Google reset-notice email in EN & VI with no reset token', () => {
    const enEmail = buildGoogleResetNoticeEmail({
      name: 'Quang',
      loginUrl: 'https://fittrack.io.vn/login',
      lang: 'en',
    });
    expect(enEmail.subject).toMatch(/Google/i);
    assertMatchesNewUi(enEmail.html);
    expect(enEmail.html).toContain('#FF5C00');
    expect(enEmail.html).toContain('https://fittrack.io.vn/login');
    expect(enEmail.text).toMatch(/Google/i);
    expect(enEmail.text).toContain('https://fittrack.io.vn/login');

    const viEmail = buildGoogleResetNoticeEmail({
      name: 'Quang <em>',
      loginUrl: 'https://fittrack.io.vn/login',
      lang: 'vi',
    });
    expect(viEmail.subject).toMatch(/Google/i);
    assertMatchesNewUi(viEmail.html);
    expect(viEmail.html).toContain('Quang &lt;em&gt;');
    expect(viEmail.html).toMatch(/Đăng nhập Google/i);
    expect(viEmail.text).toContain('https://fittrack.io.vn/login');
  });
});
