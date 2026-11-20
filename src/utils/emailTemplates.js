function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLang(lang) {
  return lang === 'vi' ? 'vi' : 'en';
}

const THEMES = {
  lime: {
    accent: '#CCFF00',
    cardBorder: '#263000',
    badgeBg: '#171F00',
    badgeBorder: '#3B4D00',
    badgeText: '#CCFF00',
    fallbackUrlColor: '#CCFF00',
    noticeBg: '#121700',
    noticeBorder: '#2E3B00',
    noticeAccent: '#CCFF00',
    noticeText: '#D4D4D4',
  },
  orange: {
    accent: '#FF5C00',
    cardBorder: '#451C06',
    badgeBg: '#210E04',
    badgeBorder: '#59250A',
    badgeText: '#FF5C00',
    fallbackUrlColor: '#FF8A47',
    noticeBg: '#1B0D05',
    noticeBorder: '#4A2009',
    noticeAccent: '#FF5C00',
    noticeText: '#E8CFC2',
  },
};

function renderEmailHtml({
  lang = 'en',
  theme = 'lime',
  noticeTheme = theme,
  preheader = '',
  badge,
  heading,
  paragraphs,
  actionUrl,
  ctaLabel,
  secondaryAction = null,
  copyLabel,
  noticeLabel,
  noticeText,
  footerNote,
}) {
  const palette = THEMES[theme] || THEMES.lime;
  const noticePalette = THEMES[noticeTheme] || palette;
  const isVi = normalizeLang(lang) === 'vi';
  const tagline = isVi ? 'TẬP THÔNG MINH. THEO DÕI CHUẨN.' : 'TRAIN SMART. TRACK HARD.';
  const safeActionUrl = escapeHtml(actionUrl);
  const safePreheader = escapeHtml(preheader || heading);

  const fontDisplay = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
  const fontBody = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
  const fontMono = "'JetBrains Mono', Consolas, 'Courier New', monospace";

  const paragraphsHtml = paragraphs
    .map(
      (paragraph, idx) =>
        `<p style="margin: 0 0 ${idx === paragraphs.length - 1 ? '28' : '14'}px 0; font-family: ${fontBody}; color: #D4D4D4; font-size: 15px; line-height: 1.65;">${paragraph}</p>`
    )
    .join('');

  const secondaryHtml =
    secondaryAction && secondaryAction.url && secondaryAction.label
      ? `<p style="margin: 16px 0 0 0; text-align: center; font-family: ${fontBody}; font-size: 13px; color: #A0A0A0;">
          <a href="${escapeHtml(secondaryAction.url)}" style="color: #CCFF00; text-decoration: underline;">${escapeHtml(secondaryAction.label)}</a>
        </p>`
      : '';

  return `<!DOCTYPE html>
<html lang="${isVi ? 'vi' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,700;0,800;1,900&family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; color: #FFFFFF; font-family: ${fontBody}; -webkit-font-smoothing: antialiased;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #050505; opacity: 0;">${safePreheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #050505; width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 36px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; border-collapse: collapse;">
          <!-- Brand Header -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; margin: 0 auto;">
                <tr>
                  <td width="36" height="36" align="center" valign="middle" style="width: 36px; height: 36px; background-color: #CCFF00; border-radius: 2px; color: #000000; font-family: ${fontDisplay}; font-weight: 900; font-style: italic; font-size: 22px; line-height: 36px; text-align: center;">F</td>
                  <td style="padding-left: 12px; font-family: ${fontDisplay}; font-weight: 900; font-style: italic; font-size: 30px; line-height: 1; letter-spacing: 0.12em; text-transform: uppercase; color: #CCFF00;">FITTRACK</td>
                </tr>
              </table>
              <p style="margin: 10px 0 0 0; font-family: ${fontDisplay}; font-size: 11px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; color: #A0A0A0;">${tagline}</p>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background-color: #0A0A0A; border: 1px solid ${palette.cardBorder}; border-radius: 2px; overflow: hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="height: 3px; background-color: ${palette.accent}; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding: 34px 30px 30px 30px;">
                    <div style="margin-bottom: 18px;">
                      <span style="display: inline-block; background-color: ${palette.badgeBg}; color: ${palette.badgeText}; border: 1px solid ${palette.badgeBorder}; border-radius: 2px; padding: 4px 10px; font-family: ${fontDisplay}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em;">${escapeHtml(badge)}</span>
                    </div>

                    <h1 style="margin: 0 0 18px 0; font-family: ${fontDisplay}; font-weight: 900; font-style: italic; text-transform: uppercase; font-size: 28px; line-height: 1.15; letter-spacing: 0.04em; color: #FFFFFF;">${escapeHtml(heading)}</h1>

                    ${paragraphsHtml}

                    <!-- Primary CTA -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td align="center" style="padding: 4px 0 8px 0;">
                          <a href="${safeActionUrl}" style="display: inline-block; background-color: ${palette.accent}; color: #000000; border-radius: 2px; padding: 14px 32px; font-family: ${fontDisplay}; font-weight: 800; font-size: 15px; text-transform: uppercase; letter-spacing: 0.12em; text-decoration: none;">${escapeHtml(ctaLabel)}</a>
                        </td>
                      </tr>
                    </table>

                    ${secondaryHtml}

                    <!-- Fallback URL Panel -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-top: 26px;">
                      <tr>
                        <td style="background-color: #111111; border: 1px solid #1E1E1E; border-left: 3px solid ${palette.accent}; border-radius: 2px; padding: 14px 16px;">
                          <p style="margin: 0 0 8px 0; font-family: ${fontDisplay}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: #A0A0A0;">${escapeHtml(copyLabel)}</p>
                          <p style="margin: 0; font-family: ${fontMono}; font-size: 12px; line-height: 1.5; word-break: break-all; color: ${palette.fallbackUrlColor};">
                            <a href="${safeActionUrl}" style="color: ${palette.fallbackUrlColor}; text-decoration: none;">${safeActionUrl}</a>
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- Notice Callout -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                      <tr>
                        <td style="background-color: ${noticePalette.noticeBg}; border: 1px solid ${noticePalette.noticeBorder}; border-left: 3px solid ${noticePalette.noticeAccent}; border-radius: 2px; padding: 14px 16px;">
                          <p style="margin: 0 0 4px 0; font-family: ${fontDisplay}; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; color: ${noticePalette.noticeAccent};">${escapeHtml(noticeLabel)}</p>
                          <p style="margin: 0; font-family: ${fontBody}; font-size: 13px; line-height: 1.55; color: ${noticePalette.noticeText};">${escapeHtml(noticeText)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 12px 8px 12px; border-top: 1px solid #1A1A1A; text-align: center;">
              <p style="margin: 0 0 6px 0; font-family: ${fontBody}; font-size: 12px; line-height: 1.6; color: #666666;">${escapeHtml(footerNote)}</p>
              <p style="margin: 0; font-family: ${fontDisplay}; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #555555;">FitTrack &bull; fittrack.io.vn</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build bilingual verification email payload (subject, html, text).
 */
function buildVerificationEmail({ name, verifyUrl, lang = 'en' }) {
  const isVi = normalizeLang(lang) === 'vi';
  const rawName = name || (isVi ? 'bạn' : 'athlete');
  const safeName = escapeHtml(rawName);

  const copy = isVi
    ? {
        subject: 'FitTrack — Xác thực email của bạn',
        preheader: 'Xác thực địa chỉ email để kích hoạt tài khoản FitTrack của bạn.',
        badge: 'XÁC THỰC TÀI KHOẢN',
        heading: 'XÁC THỰC EMAIL',
        paragraphs: [
          `Chào mừng đến với FitTrack, ${safeName}.`,
          'Vui lòng xác nhận địa chỉ email bên dưới để kích hoạt tài khoản và bắt đầu theo dõi quá trình tập luyện của bạn.',
        ],
        ctaLabel: 'XÁC THỰC EMAIL',
        copyLabel: 'HOẶC SAO CHÉP LIÊN KẾT NÀY',
        noticeLabel: 'HIỆU LỰC 24 GIỜ',
        noticeText: 'Liên kết xác thực này sẽ hết hạn sau 24 giờ.',
        footerNote: 'Nếu bạn không tạo tài khoản FitTrack, bạn có thể bỏ qua email này.',
        text: `Chào mừng đến với FitTrack, ${rawName}.\n\nVui lòng xác thực địa chỉ email của bạn trong vòng 24 giờ:\n${verifyUrl}\n\nNếu bạn không tạo tài khoản FitTrack, bạn có thể bỏ qua email này.`,
      }
    : {
        subject: 'FitTrack — Verify Your Email',
        preheader: 'Confirm your email address to activate your FitTrack account.',
        badge: 'ACCOUNT VERIFICATION',
        heading: 'VERIFY YOUR EMAIL',
        paragraphs: [
          `Welcome to FitTrack, ${safeName}.`,
          'Confirm your email address below to activate your account and start tracking your training.',
        ],
        ctaLabel: 'VERIFY EMAIL ADDRESS',
        copyLabel: 'OR COPY AND PASTE THIS LINK',
        noticeLabel: 'EXPIRES IN 24 HOURS',
        noticeText: 'This verification link will remain active for 24 hours.',
        footerNote: 'If you did not create a FitTrack account, you can safely ignore this email.',
        text: `Welcome to FitTrack, ${rawName}.\n\nPlease verify your email address within 24 hours:\n${verifyUrl}\n\nIf you did not create a FitTrack account, you can safely ignore this email.`,
      };

  return {
    subject: copy.subject,
    html: renderEmailHtml({
      lang,
      theme: 'lime',
      actionUrl: verifyUrl,
      ...copy,
    }),
    text: copy.text,
  };
}

/**
 * Build bilingual password reset email payload (subject, html, text).
 */
function buildResetPasswordEmail({ name, resetUrl, lang = 'en' }) {
  const isVi = normalizeLang(lang) === 'vi';
  const rawName = name || (isVi ? 'bạn' : 'athlete');
  const safeName = escapeHtml(rawName);

  const copy = isVi
    ? {
        subject: 'FitTrack — Yêu cầu đặt lại mật khẩu',
        preheader: 'Đặt lại mật khẩu tài khoản FitTrack của bạn trong vòng 1 giờ.',
        badge: 'BẢO MẬT',
        heading: 'ĐẶT LẠI MẬT KHẨU',
        paragraphs: [
          `Xin chào ${safeName},`,
          'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FitTrack của bạn. Nhấn nút bên dưới để tạo mật khẩu mới.',
        ],
        ctaLabel: 'ĐẶT LẠI MẬT KHẨU',
        copyLabel: 'HOẶC SAO CHÉP LIÊN KẾT NÀY',
        noticeLabel: 'HIỆU LỰC 1 GIỜ',
        noticeText:
          'Liên kết đặt lại mật khẩu này sẽ hết hạn sau 1 giờ. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
        footerNote: 'Email này được gửi để bảo vệ tài khoản FitTrack của bạn.',
        text: `Xin chào ${rawName},\n\nChúng tôi nhận được yêu cầu đặt lại mật khẩu FitTrack của bạn. Truy cập liên kết dưới đây trong vòng 1 giờ:\n${resetUrl}\n\nNếu bạn không yêu cầu, bạn có thể bỏ qua email này.`,
      }
    : {
        subject: 'FitTrack — Password Reset Request',
        preheader: 'Reset your FitTrack password within the next 1 hour.',
        badge: 'SECURITY',
        heading: 'RESET YOUR PASSWORD',
        paragraphs: [
          `Hi ${safeName},`,
          'We received a request to reset the password for your FitTrack account. Use the button below to choose a new password.',
        ],
        ctaLabel: 'RESET PASSWORD',
        copyLabel: 'OR COPY AND PASTE THIS LINK',
        noticeLabel: 'EXPIRES IN 1 HOUR',
        noticeText:
          'This password reset link will expire in 1 hour. If you did not request a reset, you can safely ignore this email.',
        footerNote: 'This message was sent to keep your FitTrack account secure.',
        text: `Hi ${rawName},\n\nWe received a request to reset your FitTrack password. Visit the link below within 1 hour to set a new password:\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
      };

  return {
    subject: copy.subject,
    html: renderEmailHtml({
      lang,
      theme: 'orange',
      actionUrl: resetUrl,
      ...copy,
    }),
    text: copy.text,
  };
}

/**
 * Build bilingual owner-notice email when someone attempts to register with an already-verified email.
 * Never exposes tokens or modifies account state (OWASP anti-enumeration).
 */
function buildAccountExistsEmail({
  name,
  loginUrl,
  resetUrl = null,
  isGoogleOnly = false,
  hasGoogle = false,
  lang = 'en',
}) {
  const isVi = normalizeLang(lang) === 'vi';
  const rawName = name || (isVi ? 'bạn' : 'athlete');
  const safeName = escapeHtml(rawName);

  let copy;
  if (isVi) {
    const paragraphs = isGoogleOnly
      ? [
          `Xin chào ${safeName},`,
          'Có người vừa thử đăng ký tài khoản FitTrack mới bằng địa chỉ email này.',
          'Email của bạn đã được liên kết với một tài khoản FitTrack hoạt động qua <strong>Đăng nhập Google</strong> và không dùng mật khẩu. Hãy tiếp tục bằng Google tại trang đăng nhập.',
        ]
      : [
          `Xin chào ${safeName},`,
          'Có người vừa thử đăng ký tài khoản FitTrack mới bằng địa chỉ email này.',
          `Email này đã có tài khoản FitTrack được xác thực.${hasGoogle ? ' Bạn có thể đăng nhập bằng mật khẩu hoặc Google.' : ' Vui lòng đăng nhập bằng mật khẩu hiện tại của bạn.'}`,
        ];

    const secondaryAction =
      !isGoogleOnly && resetUrl
        ? { label: 'Quên mật khẩu? Đặt lại mật khẩu tại đây', url: resetUrl }
        : null;

    const text = isGoogleOnly
      ? `Xin chào ${rawName},\n\nCó người vừa thử đăng ký tài khoản FitTrack mới bằng địa chỉ email này, nhưng tài khoản đã tồn tại qua Đăng nhập Google.\n\nĐăng nhập bằng Google tại:\n${loginUrl}\n\nKhông có thay đổi nào được thực hiện trên tài khoản của bạn. Nếu không phải bạn thao tác, bạn có thể bỏ qua email này.`
      : `Xin chào ${rawName},\n\nCó người vừa thử đăng ký tài khoản FitTrack mới bằng địa chỉ email này, nhưng tài khoản đã được xác thực.${hasGoogle ? ' Bạn có thể đăng nhập bằng mật khẩu hoặc Google.' : ''}\n\nĐăng nhập tại:\n${loginUrl}${resetUrl ? `\n\nQuên mật khẩu? Đặt lại tại:\n${resetUrl}` : ''}\n\nKhông có thay đổi nào được thực hiện trên tài khoản của bạn. Nếu không phải bạn thao tác, bạn có thể bỏ qua email này.`;

    copy = {
      subject: 'FitTrack — Tài khoản FitTrack của bạn đã tồn tại',
      preheader: 'Có lượt đăng ký trùng với email tài khoản FitTrack của bạn.',
      badge: 'THÔNG BÁO TÀI KHOẢN',
      heading: 'TÀI KHOẢN ĐÃ TỒN TẠI',
      paragraphs,
      ctaLabel: isGoogleOnly ? 'ĐĂNG NHẬP BẰNG GOOGLE' : 'ĐĂNG NHẬP FITTRACK',
      secondaryAction,
      copyLabel: 'HOẶC MỞ TRANG ĐĂNG NHẬP',
      noticeLabel: 'LƯU Ý BẢO MẬT',
      noticeText:
        'Không có thay đổi nào được thực hiện trên tài khoản của bạn. Nếu không phải bạn thao tác, bạn có thể bỏ qua email này.',
      footerNote: 'Thông báo bảo mật này được gửi tới chủ sở hữu tài khoản FitTrack.',
      text,
    };
  } else {
    const paragraphs = isGoogleOnly
      ? [
          `Hi ${safeName},`,
          'Someone attempted to register a new FitTrack account using your email address.',
          'This email is already linked to an active FitTrack account via <strong>Google Sign-In</strong> and does not use a password. Use Google Sign-In on the login page to access your account.',
        ]
      : [
          `Hi ${safeName},`,
          'Someone attempted to register a new FitTrack account using your email address.',
          `A verified FitTrack account already exists for this email.${hasGoogle ? ' You can sign in using your email and password or Google Sign-In.' : ' Please sign in with your existing password.'}`,
        ];

    const secondaryAction =
      !isGoogleOnly && resetUrl
        ? { label: 'Forgot your password? Reset it here', url: resetUrl }
        : null;

    const text = isGoogleOnly
      ? `Hi ${rawName},\n\nSomeone attempted to register a new FitTrack account with this email address, which already exists via Google Sign-In.\n\nLog in with Google at:\n${loginUrl}\n\nNo changes were made to your account. If this wasn't you, you can safely ignore this email.`
      : `Hi ${rawName},\n\nSomeone attempted to register a new FitTrack account with this email address, which already has a verified account.${hasGoogle ? ' You can sign in with your password or Google Sign-In.' : ''}\n\nLog in at:\n${loginUrl}${resetUrl ? `\n\nForgot your password? Reset it at:\n${resetUrl}` : ''}\n\nNo changes were made to your account. If this wasn't you, you can safely ignore this email.`;

    copy = {
      subject: 'FitTrack — Account Already Exists',
      preheader: 'Someone tried to register with an email already linked to your FitTrack account.',
      badge: 'ACCOUNT NOTICE',
      heading: 'ACCOUNT ALREADY EXISTS',
      paragraphs,
      ctaLabel: isGoogleOnly ? 'LOG IN WITH GOOGLE' : 'LOG IN TO FITTRACK',
      secondaryAction,
      copyLabel: 'OR OPEN LOGIN PAGE',
      noticeLabel: 'SECURITY NOTICE',
      noticeText:
        'No changes were made to your account. If you did not try to register, you can safely ignore this email.',
      footerNote: 'This security notification was sent to the owner of this FitTrack account.',
      text,
    };
  }

  return {
    subject: copy.subject,
    html: renderEmailHtml({
      lang,
      theme: 'lime',
      noticeTheme: 'orange',
      actionUrl: loginUrl,
      ...copy,
    }),
    text: copy.text,
  };
}

/**
 * Build bilingual owner-notice email when a password reset is requested for a Google-only account.
 */
function buildGoogleResetNoticeEmail({ name, loginUrl, lang = 'en' }) {
  const isVi = normalizeLang(lang) === 'vi';
  const rawName = name || (isVi ? 'bạn' : 'athlete');
  const safeName = escapeHtml(rawName);

  const copy = isVi
    ? {
        subject: 'FitTrack — Đăng nhập bằng Google',
        preheader: 'Tài khoản FitTrack của bạn dùng Google và không có mật khẩu.',
        badge: 'ĐĂNG NHẬP GOOGLE',
        heading: 'ĐĂNG NHẬP BẰNG GOOGLE',
        paragraphs: [
          `Xin chào ${safeName},`,
          'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho địa chỉ email này.',
          'Tài khoản FitTrack của bạn sử dụng <strong>Đăng nhập Google</strong> và không có mật khẩu. Vui lòng quay lại trang đăng nhập và chọn tiếp tục với Google.',
        ],
        ctaLabel: 'ĐI TỚI ĐĂNG NHẬP',
        copyLabel: 'HOẶC MỞ TRANG ĐĂNG NHẬP',
        noticeLabel: 'LƯU Ý BẢO MẬT',
        noticeText:
          'Không có thay đổi nào được thực hiện trên tài khoản của bạn. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
        footerNote: 'Email này được gửi để bảo vệ tài khoản FitTrack của bạn.',
        text: `Xin chào ${rawName},\n\nHệ thống nhận được yêu cầu đặt lại mật khẩu cho email này, nhưng tài khoản FitTrack của bạn sử dụng Đăng nhập Google và không có mật khẩu.\n\nĐăng nhập bằng Google tại:\n${loginUrl}\n\nKhông có thay đổi nào được thực hiện trên tài khoản của bạn. Nếu không phải bạn thao tác, hãy bỏ qua email này.`,
      }
    : {
        subject: 'FitTrack — Sign In with Google',
        preheader: 'Your FitTrack account uses Google Sign-In and has no password.',
        badge: 'GOOGLE SIGN-IN',
        heading: 'SIGN IN WITH GOOGLE',
        paragraphs: [
          `Hi ${safeName},`,
          'We received a password reset request for your email address.',
          'Your FitTrack account uses <strong>Google Sign-In</strong> and does not have a password. Return to the login page and continue with Google.',
        ],
        ctaLabel: 'GO TO LOGIN',
        copyLabel: 'OR OPEN LOGIN PAGE',
        noticeLabel: 'SECURITY NOTICE',
        noticeText:
          'No changes were made to your account. If you did not request a password reset, you can safely ignore this email.',
        footerNote: 'This message was sent to keep your FitTrack account secure.',
        text: `Hi ${rawName},\n\nA password reset was requested for this email, but your FitTrack account uses Google Sign-In and does not have a password.\n\nSign in with Google at:\n${loginUrl}\n\nNo changes were made to your account. If this wasn't you, you can safely ignore this email.`,
      };

  return {
    subject: copy.subject,
    html: renderEmailHtml({
      lang,
      theme: 'orange',
      actionUrl: loginUrl,
      ...copy,
    }),
    text: copy.text,
  };
}

module.exports = {
  buildVerificationEmail,
  buildResetPasswordEmail,
  buildAccountExistsEmail,
  buildGoogleResetNoticeEmail,
};
