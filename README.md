# 🏋️ FitTrack Backend API

A comprehensive RESTful fitness tracking and workout planning backend service built with Node.js and Express. FitTrack enables users to log workouts, track progress, plan weekly training schedules, and gain insights through detailed analytics.

**Live Frontend:** https://fit-track-frontend-gray.vercel.app

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Database Models](#database-models)
- [Security](#security)
- [Available Scripts](#available-scripts)
- [Development](#development)
- [Deployment](#deployment)

---

## 🎯 Overview

FitTrack is a full-featured fitness tracking platform that helps users:
- Register and manage their fitness profiles
- Log detailed workout sessions with multiple exercises and sets
- Track exercise progression over time with strength analytics
- Create and manage weekly training plans
- Execute weekly schedules with daily workout tracking
- Monitor overall fitness progress with comprehensive statistics
- Receive automated email notifications

The backend provides a robust, scalable API with JWT-based authentication, rate limiting, and comprehensive Swagger documentation.

---

## 🛠 Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | Latest | Runtime environment |
| **Express.js** | ^5.2.1 | Web application framework |
| **MongoDB** | ^7.0.0 | NoSQL database (MongoDB Atlas) |
| **Mongoose** | ^9.1.2 | MongoDB object modeling |
| **JWT (jsonwebtoken)** | ^9.0.3 | Authentication & authorization |
| **bcryptjs** | ^3.0.3 | Password hashing & security |
| **Helmet** | ^8.1.0 | Security headers middleware |
| **express-rate-limit** | ^8.2.1 | API rate limiting |
| **express-validator** | ^7.3.1 | Input validation |
| **Nodemailer** | ^7.0.12 | Email sending (fallback) |
| **Resend** | ^6.6.0 | Email service provider |
| **Swagger** | ^6.2.8 | API documentation |
| **Morgan** | ^1.10.1 | HTTP request logging |
| **Axios** | ^1.13.2 | HTTP client |
| **CORS** | ^2.8.5 | Cross-origin resource sharing |
| **Dotenv** | ^17.2.3 | Environment variable management |
| **Nodemon** | ^3.1.11 | Development auto-reload |

---

## ✨ Features

### 🔐 Authentication & User Management
- **User Registration** with email verification
- **Login** with JWT token generation
- **Password Reset** with email-based verification
- **Email Verification** flow with custom tokens
- **Secure Password Storage** with bcryptjs (10-salt rounds)

### 📊 Workout Logging & Tracking
- **Log Workouts** with multiple exercises per session
- **Exercise Tracking** with sets, reps, and weight data
- **Workout History** with date-based queries
- **Exercise Categories** (Strength, Cardio, Flexibility, etc.)
- **Detailed Set Information** (reps, weight, set numbers)

### 📈 Analytics & Progress
- **Strength Progression** tracking for individual exercises
- **User Exercise Library** with personal stats
- **Workout Statistics** (total workouts, avg exercises per session)
- **Weekly Progress Monitoring** with weekly summaries
- **Performance Metrics** calculation and trending

### 📅 Weekly Training Plans
- **Create Custom Plans** for workout routines
- **Plan Management** (CRUD operations)
- **Plan Templates** for reusability
- **Structured Exercise Organization**

### 🗓️ Weekly Schedule Execution
- **Start Weekly Schedules** from plans
- **Daily Workout Tracking** within schedules
- **Mark Days Complete** as completed
- **Complete Full Weeks** with status tracking
- **Update Schedule Days** dynamically
- **Current Week Retrieval** for active sessions

### 💬 Exercise Database
- **Pre-loaded Exercise Library** with common exercises
- **Exercise Categorization** by muscle group
- **Exercise Details** (description, difficulty, etc.)

### 📧 Email Notifications
- **Welcome Emails** on registration with styled HTML templates
- **Email Verification** links
- **Password Reset** notifications
- **Smart Email Service** with fallback options (Resend → Nodemailer)

---

## 📁 Project Structure

```
server/
├── src/
│   ├── app.js                          # Main Express application
│   ├── seed.js                         # Database seeding script
│   ├── config/
│   │   ├── db.js                       # MongoDB connection setup
│   │   └── swagger.js                  # Swagger/OpenAPI configuration
│   ├── controllers/
│   │   ├── authController.js           # Auth endpoints (register, login, password reset)
│   │   ├── userController.js           # User profile management
│   │   ├── workoutController.js        # Workout logging and retrieval
│   │   ├── workoutSessionController.js # Workout session management
│   │   ├── exerciseController.js       # Exercise database endpoints
│   │   ├── analyticsController.js      # Progress and stats analytics
│   │   ├── weeklyPlanController.js     # Training plan CRUD
│   │   ├── weeklyScheduleController.js # Schedule execution
│   │   └── progressController.js       # User progress tracking
│   ├── routes/
│   │   ├── authRoutes.js               # POST /api/auth/* (register, login, etc.)
│   │   ├── userRoutes.js               # GET /api/users/* (profile, progress)
│   │   ├── workoutRoutes.js            # GET/POST /api/workouts
│   │   ├── workoutSessionRoutes.js     # /api/workout-sessions
│   │   ├── exerciseRoutes.js           # GET /api/exercises
│   │   ├── analyticsRoutes.js          # GET /api/analytics/* (stats, progression)
│   │   ├── weeklyPlanRoutes.js         # CRUD /api/weekly-plans
│   │   └── weeklyScheduleRoutes.js     # CRUD /api/weekly-schedules
│   ├── middleware/
│   │   ├── authMiddleware.js           # JWT token verification
│   │   ├── validate.js                 # Input validation using express-validator
│   │   └── rateLimiter.js              # API rate limiting (15 min, 50 auth requests/hour)
│   ├── utils/
│   │   ├── sendEmail.js                # Email utility wrapper
│   │   ├── sendEmailResend.js          # Resend email provider integration
│   │   └── sendEmailSmart.js           # Smart email service with fallback
│   ├── data/
│   │   └── exercise.json               # Exercise library dataset
│   ├── seeds/
│   │   └── exercises.seed.js           # Seed script for exercise database
│   ├── scripts/
│   │   ├── cleanupTestUsers.js         # Remove test users from database
│   │   └── migrateUsers.js             # User data migration utilities
│   └── models/
│       └── User.js                     # User schema (empty - using MongoDB native)
├── scripts/
│   └── verify-security.js              # Security verification script
├── package.json
├── .env                                # Environment configuration (REQUIRED)
├── .env.example                        # Environment template
└── README.md
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- MongoDB Atlas account (or local MongoDB)
- Resend API key (for email) or SMTP credentials
- Render.com account (or similar hosting) for deployment

### Step 1: Clone & Install Dependencies

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install
```

### Step 2: Configure Environment Variables

Create a `.env` file in the root of the server directory:

```bash
cp .env.example .env
```

Then edit `.env` with your credentials (see [Environment Variables](#environment-variables) section).

### Step 3: Start Development Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

Server will start on `http://localhost:5000` by default.

### Step 4: Seed Database (Optional)

```bash
# Load exercise library into database
npm run seed
```

---

## 🔑 Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# MongoDB Atlas Configuration
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
DB_NAME=fittrack

# Authentication
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
JWT_EXPIRE=7d

# Email Configuration (Resend API)
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=noreply@fittrack.com

# Email Configuration (Fallback - Nodemailer SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Application Settings
ALLOWED_ORIGIN=https://fit-track-frontend-gray.vercel.app
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000
```

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB Atlas connection string | `mongodb+srv://...` |
| `DB_NAME` | Database name | `fittrack` |
| `JWT_SECRET` | Secret key for JWT signing (min 32 chars) | `your_secret_key` |
| `JWT_EXPIRE` | Token expiration time | `7d` |
| `RESEND_API_KEY` | Resend API key for email delivery | `re_xxxx...` |
| `FROM_EMAIL` | Sender email address | `noreply@fittrack.com` |

---

## 📡 API Endpoints

### Base URL
```
Development: http://localhost:5000
Production: https://fittrack-api.render.com (or your domain)
```

All protected endpoints require JWT token in Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

### 🔐 Authentication Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| POST | `/api/auth/register` | Register new user | ❌ |
| POST | `/api/auth/login` | User login | ❌ |
| POST | `/api/auth/verify-email` | Verify email with token | ❌ |
| POST | `/api/auth/request-password-reset` | Request password reset email | ❌ |
| POST | `/api/auth/reset-password` | Reset password with token | ❌ |

### 👤 User Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| GET | `/api/users/progress` | Get user progress history | ✅ |
| PUT | `/api/users/:id` | Update user profile | ✅ |
| GET | `/api/users/:id` | Get user details | ✅ |

### 💪 Workout Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| POST | `/api/workouts` | Log new workout session | ✅ |
| GET | `/api/workouts` | Get all user workouts | ✅ |
| GET | `/api/workouts/:id` | Get specific workout | ✅ |

### 📊 Analytics Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| GET | `/api/analytics/strength-progression/:exerciseName` | Get exercise progression | ✅ |
| GET | `/api/analytics/user-exercises` | Get all user exercises | ✅ |
| GET | `/api/analytics/workout-stats` | Get workout statistics | ✅ |
| GET | `/api/analytics/weekly-progress` | Get weekly progress summary | ✅ |

### 📅 Weekly Plan Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| POST | `/api/weekly-plans` | Create new training plan | ✅ |
| GET | `/api/weekly-plans` | Get all user plans | ✅ |
| GET | `/api/weekly-plans/:id` | Get specific plan | ✅ |
| PUT | `/api/weekly-plans/:id` | Update plan | ✅ |
| DELETE | `/api/weekly-plans/:id` | Delete plan | ✅ |

### 🗓️ Weekly Schedule Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| POST | `/api/weekly-schedules/start` | Start new weekly schedule | ✅ |
| GET | `/api/weekly-schedules` | Get all schedules | ✅ |
| GET | `/api/weekly-schedules/current` | Get current active schedule | ✅ |
| GET | `/api/weekly-schedules/:id` | Get specific schedule | ✅ |
| PATCH | `/api/weekly-schedules/:id/complete-day` | Mark day as complete | ✅ |
| PATCH | `/api/weekly-schedules/:id/complete` | Mark entire week complete | ✅ |
| PATCH | `/api/weekly-schedules/:id/update-day` | Update specific day | ✅ |

### 🏋️ Exercise Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| GET | `/api/exercises` | Get exercise library | ✅ |
| GET | `/api/exercises/:id` | Get exercise details | ✅ |

### 🏥 Health Check
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| GET | `/api/health` | Server health status | ❌ |

---

## 💾 Database Models

### Users Collection
```javascript
{
  _id: ObjectId,
  email: String (unique),
  password: String (hashed),
  name: String,
  isVerified: Boolean,
  verificationToken: String,
  resetToken: String,
  resetTokenExpires: Date,
  age: Number,
  height: Number, // cm
  sex: String, // male, female, other
  weightHistory: [{
    weight: Number, // kg
    date: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### Workouts Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  date: Date,
  exercises: [{
    exerciseName: String,
    category: String,
    sets: [{
      setNumber: Number,
      reps: Number,
      weight: Number
    }]
  }],
  createdAt: Date
}
```

### Weekly Plans Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  name: String,
  description: String,
  days: [{
    dayOfWeek: Number, // 0-6 (Sun-Sat)
    exercises: [ObjectId]
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### Weekly Schedules Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  planId: ObjectId,
  startDate: Date,
  endDate: Date,
  days: [{
    dayOfWeek: Number,
    date: Date,
    isCompleted: Boolean,
    exercises: [ObjectId]
  }],
  isCompleted: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Exercises Collection
```javascript
{
  _id: ObjectId,
  name: String,
  category: String,
  difficulty: String, // beginner, intermediate, advanced
  description: String,
  targetMuscles: [String]
}
```

---

## 🔒 Security Features

1. **JWT Authentication**
   - Token-based authentication for protected routes
   - 7-day token expiration by default
   - Bearer token validation in authMiddleware

2. **Password Security**
   - bcryptjs hashing with 10 salt rounds
   - Password reset with time-limited tokens
   - Secure password change flow

3. **Rate Limiting**
   - Global: 1000 requests per 15 minutes per IP
   - Auth: 50 login attempts per hour per IP
   - Skipped in development mode
   - Respects proxy headers for Render deployment

4. **Helmet Security Headers**
   - HSTS, X-Frame-Options, CSP, and more
   - Protection against common security vulnerabilities

5. **CORS Protection**
   - Whitelist only verified frontend domains
   - Credentials and specific methods allowed
   - Environment-based configuration

6. **Input Validation**
   - express-validator for all API inputs
   - Email format validation
   - Required field verification
   - Sanitization of user input

7. **Email Verification**
   - Token-based email verification on signup
   - Prevents spam account registration

---

## 📝 Available Scripts

### Development
```bash
npm run dev        # Start with nodemon (auto-reload on file changes)
npm start          # Start production server
npm test           # Run test suite (not yet configured)
npm run seed       # Seed exercise database
```

### Utilities
```bash
# Cleanup test users
node src/scripts/cleanupTestUsers.js

# Migrate user data
node src/scripts/migrateUsers.js

# Security verification
node scripts/verify-security.js
```

---

## 💻 Development

### Starting the Development Server

```bash
npm run dev
```

The server will start with hot-reload enabled via Nodemon.

### API Documentation

Once the server is running, visit:
```
http://localhost:5000/api-docs
```

This provides an interactive Swagger UI for testing all endpoints.

### Logging

- HTTP requests logged via Morgan middleware
- Database connection logs printed to console
- Error logs in console for debugging

### Database Connections

All routes and controllers use MongoDB native driver through `getDb()` helper for direct collection access.

---

## 🌐 Deployment

### Deployment to Render

1. **Create Render Web Service**
   - Connect your GitHub repository
   - Build command: `npm install`
   - Start command: `npm start`

2. **Environment Variables**
   - Set all `.env` variables in Render dashboard

3. **CORS Configuration**
   - Update `FRONTEND_URL` in environment
   - Add production domain to CORS whitelist in `app.js`

4. **Database**
   - Use MongoDB Atlas (cloud) for production
   - Set `MONGO_URI` to Atlas connection string
   - Enable IP whitelist for Render deployment

5. **Email Service**
   - Configure Resend API key for production
   - Add production domain to Resend settings

### Health Check
```bash
curl https://your-api-domain.com/api/health
```

---

## 📦 Maintenance

### Database Cleanup
```bash
node src/scripts/cleanupTestUsers.js
```

### Add New Exercises
Edit `src/data/exercise.json` and run:
```bash
npm run seed
```

### Security Audit
```bash
node scripts/verify-security.js
```

---

## 📄 License

ISC License

---

## 👥 Support

For issues or questions about the FitTrack API, please check the Swagger documentation at `/api-docs` or review the controller implementations in `src/controllers/`.
