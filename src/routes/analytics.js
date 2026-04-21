const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabase.service');

// ── GET /api/analytics ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await supabaseService.getAnalytics();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
