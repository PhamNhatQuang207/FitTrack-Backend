# FitTrack Backend

Backend server for the FitTrack fitness tracking application.

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- JWT Authentication

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
Create a `.env` file with the required configuration (see `.env.example`).

3. Run the server:
```bash
npm start
```

## API Documentation

API documentation is available via Swagger at `/api-docs` when the server is running.

## Project Structure

- `src/controllers/` - Request handlers
- `src/models/` - Database models
- `src/routes/` - API routes
- `src/middleware/` - Custom middleware
- `src/utils/` - Utility functions
- `src/config/` - Configuration files
