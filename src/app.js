const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const { connectDB } = require('./config/db');
const dotenv = require('dotenv');
const authRoutes = require('./routes/authRoutes');
const helmet = require('helmet');
const { limiter } = require('./middleware/rateLimiter');
const userRoutes = require('./routes/userRoutes');
const workoutRoutes = require('./routes/workoutRoutes');
const exerciseRoutes = require('./routes/exerciseRoutes');
const workoutSessionRoutes = require('./routes/workoutSessionRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const weeklyPlanRoutes = require('./routes/weeklyPlanRoutes');
const weeklyScheduleRoutes = require('./routes/weeklyScheduleRoutes');
dotenv.config();
const app = express();

// Trust the first proxy (Render load balancer)
app.set('trust proxy', 1);

// CORS configuration - allow requests from frontend
app.use(cors({
  origin: [
    'http://localhost:3000',  // Local development (Create React App)
    'https://gym-tracking-123.vercel.app'  // Production frontend on Vercel
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Security Middleware
app.use(helmet());
app.use('/api', limiter); // Apply global rate limit to API routes

app.use(express.json());

// Health check endpoint for Render
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'FitTrack API Documentation'
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/workouts', workoutRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/workout-sessions', workoutSessionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/weekly-plans', weeklyPlanRoutes);
app.use('/api/weekly-schedules', weeklyScheduleRoutes);
const startServer = async () => {
  await connectDB();
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });
};

// Only boot the server (connect + listen) when run directly, e.g. `node src/app.js`.
// When imported by the test suite, we export the app so supertest can drive it
// against a test database without opening a real connection or port.
if (require.main === module) {
  startServer();
}

module.exports = app;