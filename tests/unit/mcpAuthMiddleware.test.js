const crypto = require('crypto');
const mcpAuthMiddleware = require('../../src/middleware/mcpAuthMiddleware');
const { getDb } = require('../../src/config/db');

jest.mock('../../src/config/db', () => ({
  getDb: jest.fn()
}));

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('mcpAuthMiddleware (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 Authentication required if no token is provided in headers', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await mcpAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('extracts token from x-mcp-api-key header and validates ftk_ token successfully', async () => {
    const rawKey = 'ftk_abcdef1234567890abcdef1234567890abcdef12';
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const mockFindOne = jest.fn().mockResolvedValue({ _id: 'user123' });

    getDb.mockReturnValue({
      collection: jest.fn().mockReturnValue({
        findOne: mockFindOne
      })
    });

    const req = {
      headers: {
        'x-mcp-api-key': rawKey
      }
    };
    const res = mockRes();
    const next = jest.fn();

    await mcpAuthMiddleware(req, res, next);

    expect(mockFindOne).toHaveBeenCalledWith(
      { mcpApiKeyHash: hash },
      { projection: { _id: 1 } }
    );
    expect(req.userId).toBe('user123');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 401 Invalid or revoked MCP API key if hash is not found in db', async () => {
    const rawKey = 'ftk_badkey1234567890abcdef1234567890abcdef12';
    const mockFindOne = jest.fn().mockResolvedValue(null);

    getDb.mockReturnValue({
      collection: jest.fn().mockReturnValue({
        findOne: mockFindOne
      })
    });

    const req = {
      headers: {
        authorization: `Bearer ${rawKey}`
      }
    };
    const res = mockRes();
    const next = jest.fn();

    await mcpAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or revoked MCP API key' });
    expect(next).not.toHaveBeenCalled();
  });

  test('delegates non-ftk token to authMiddleware', async () => {
    const req = {
      headers: {
        authorization: 'Bearer non_ftk_jwt_token'
      }
    };
    const res = mockRes();
    const next = jest.fn();

    await mcpAuthMiddleware(req, res, next);

    // authMiddleware should attempt jwt.verify and fail with 401
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
  });
});
