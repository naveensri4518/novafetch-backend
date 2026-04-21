const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please wait before trying again.',
    retryAfter: 60,
  },
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  },
});

const speedLimiter = slowDown({
  windowMs: 60 * 1000,
  delayAfter: 5,
  delayMs: (hits) => hits * 200,
});

module.exports = { rateLimiter, speedLimiter };
