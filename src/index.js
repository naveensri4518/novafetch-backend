require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const logger = require('./utils/logger');
const { rateLimiter, speedLimiter } = require('./middleware/rateLimit');
const downloadRoutes = require('./routes/download');
const analyticsRoutes = require('./routes/analytics');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Ensure temp directory exists ───────────────────────────────────────────
const tmpDir = process.env.TEMP_DIR || path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Rate limiting ───────────────────────────────────────────────────────────
app.use('/api/', speedLimiter);
app.use('/api/', rateLimiter);

// ── Static temp files (for direct download links) ──────────────────────────
app.use('/files', express.static(tmpDir, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.set('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  }
}));

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.use('/api/download', downloadRoutes);
app.use('/api/analytics', analyticsRoutes);

// ── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ── Global error handler ────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 NovaFetch API running on http://localhost:${PORT}`);
});

module.exports = app;
