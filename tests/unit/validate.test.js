// Mock express-validator so we control what validationResult returns.
jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
}));

const { validationResult } = require('express-validator');
const validate = require('../../src/middleware/validate');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('validate middleware (unit)', () => {
  test('calls next() when there are no validation errors', () => {
    validationResult.mockReturnValue({ isEmpty: () => true });
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    validate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 400 with mapped error messages when validation fails', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [
        { msg: 'Please include a valid email' },
        { msg: 'Password is required' },
      ],
    });
    const req = {};
    const res = mockRes();
    const next = jest.fn();

    validate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Validation Error',
      errors: ['Please include a valid email', 'Password is required'],
    });
    expect(next).not.toHaveBeenCalled();
  });
});
