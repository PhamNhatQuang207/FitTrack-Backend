// Runs before any test module is imported. Force a deterministic test
// environment and set secrets so we never touch the real .env / Atlas cluster.
// dotenv (called inside source modules) does NOT overwrite vars already set here.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';
process.env.DB_NAME = 'fittrack_test';
// MONGO_URI is set at runtime by tests/setup/testDb.js once the in-memory
// server has a port. We clear any inherited value here as a safety net.
delete process.env.MONGO_URI;
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.GEMINI_API_KEY = 'test-gemini-api-key';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';
