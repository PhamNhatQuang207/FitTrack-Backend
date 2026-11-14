const jwt = require('jsonwebtoken');
const adminMiddleware = require('../../src/middleware/adminMiddleware');
const authMiddleware = require('../../src/middleware/authMiddleware');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Admin & User token isolation (unit)', () => {
  test('adminMiddleware rejects missing Authorization header with 401', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('adminMiddleware rejects a normal user token ({ userId }) with 403', () => {
    const userToken = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${userToken}` } };
    const res = mockRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('adminMiddleware accepts a valid admin token ({ isAdmin: true })', () => {
    const adminToken = jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const res = mockRes();
    const next = jest.fn();

    adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin).toEqual({ username: 'admin' });
  });

  test('authMiddleware rejects an admin token that has no userId', () => {
    const adminToken = jwt.sign({ isAdmin: true, username: 'admin' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const res = mockRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
