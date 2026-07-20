const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let counter = 0;

// Insert a user directly and return its id + a valid Bearer token.
// The token payload mirrors what authController.login issues ({ userId }).
const createUserAndToken = async (db, overrides = {}) => {
  counter += 1;
  const plainPassword = overrides.plainPassword || 'password123';
  const user = {
    email: overrides.email || `user${counter}_${Date.now()}@test.com`,
    name: overrides.name || 'Test User',
    password: await bcrypt.hash(plainPassword, 10),
    isVerified: overrides.isVerified !== undefined ? overrides.isVerified : true,
    ...stripHelperKeys(overrides),
  };
  const { insertedId } = await db.collection('users').insertOne(user);
  const token = jwt.sign({ userId: insertedId.toString() }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
  return { userId: insertedId, token, plainPassword, email: user.email };
};

// Remove keys that are helper-only and shouldn't be persisted verbatim.
const stripHelperKeys = (overrides) => {
  const clone = { ...overrides };
  delete clone.plainPassword;
  delete clone.email;
  delete clone.name;
  delete clone.isVerified;
  return clone;
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { createUserAndToken, authHeader };
