const mockVerifyIdToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const verifyGoogleToken = require('../../src/utils/verifyGoogleToken');
const { getAllowedAudiences } = verifyGoogleToken;

describe('verifyGoogleToken (unit)', () => {
  const envKeys = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_ANDROID_CLIENT_ID',
    'GOOGLE_IOS_CLIENT_ID',
    'GOOGLE_CLIENT_IDS',
  ];
  const originalEnv = {};

  beforeAll(() => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  describe('getAllowedAudiences', () => {
    test('returns an empty array when no Google client IDs are configured', () => {
      expect(getAllowedAudiences()).toEqual([]);
    });

    test('collects, trims, and deduplicates all configured Google client IDs', () => {
      process.env.GOOGLE_CLIENT_ID = ' web-id ';
      process.env.GOOGLE_ANDROID_CLIENT_ID = 'android-id';
      process.env.GOOGLE_IOS_CLIENT_ID = 'ios-id';
      process.env.GOOGLE_CLIENT_IDS = 'web-id, extra-id-1 , , extra-id-2';

      expect(getAllowedAudiences()).toEqual([
        'web-id',
        'android-id',
        'ios-id',
        'extra-id-1',
        'extra-id-2',
      ]);
    });
  });

  describe('verifyGoogleToken', () => {
    test('fails closed with an explicit error when no Google client ID is configured', async () => {
      await expect(verifyGoogleToken('some-id-token')).rejects.toThrow(
        'Google OAuth client ID is not configured'
      );
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    test('passes a single audience string when one client ID is configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'single-web-client-id';
      const payload = { sub: 'u1', email: 'user@example.com', email_verified: true };
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });

      const result = await verifyGoogleToken('token-123');

      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'token-123',
        audience: 'single-web-client-id',
      });
      expect(result).toEqual(payload);
    });

    test('passes an array of audiences when multiple client IDs are configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'web-client-id';
      process.env.GOOGLE_IOS_CLIENT_ID = 'ios-client-id';
      process.env.GOOGLE_ANDROID_CLIENT_ID = 'android-client-id';
      const payload = { sub: 'u2', email: 'mobile@example.com', email_verified: true };
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });

      const result = await verifyGoogleToken('token-456');

      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'token-456',
        audience: ['web-client-id', 'android-client-id', 'ios-client-id'],
      });
      expect(result).toEqual(payload);
    });

    test('propagates verification failures from google-auth-library', async () => {
      process.env.GOOGLE_CLIENT_ID = 'web-client-id';
      mockVerifyIdToken.mockRejectedValue(new Error('Wrong recipient, payload audience != requiredAudience'));

      await expect(verifyGoogleToken('bad-aud-token')).rejects.toThrow(
        'Wrong recipient, payload audience != requiredAudience'
      );
    });
  });
});
