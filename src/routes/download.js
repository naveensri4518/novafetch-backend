const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const ytdlpService = require('../services/ytdlp.service');
const supabaseService = require('../services/supabase.service');
const logger = require('../utils/logger');

const TMP_DIR = process.env.TEMP_DIR || path.join(__dirname, '..', '..', 'tmp');

// ── POST /api/download/info ─────────────────────────────────────────────────
// Returns media metadata without downloading
router.post('/info', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const info = await ytdlpService.getMediaInfo(url);
    res.json({ success: true, data: info });
  } catch (err) {
    logger.error('Info error:', err);
    const message = err.message?.includes('Unsupported URL')
      ? 'This URL is not supported. Please try a different link.'
      : err.message?.includes('Invalid URL')
      ? 'Invalid URL. Please check the link and try again.'
      : err.message?.includes('Private')
      ? 'This content is private or unavailable.'
      : 'Failed to fetch media info. Please try again.';

    res.status(400).json({ success: false, error: message });
  }
});

// ── POST /api/download/video ────────────────────────────────────────────────
router.post('/video', async (req, res, next) => {
  const { url, quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    let progress = 0;
    const result = await ytdlpService.downloadVideo(url, quality, (p) => { progress = p; });

    // Log to Supabase (fire & forget)
    supabaseService.logDownload({
      url, platform: ytdlpService.detectPlatform(url),
      format: 'video', quality,
      fileSizeBytes: fs.statSync(result.filePath).size,
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        downloadUrl: `/files/${result.fileName}`,
        fileName: result.fileName,
        fileId: result.fileId,
        format: 'mp4',
        quality,
      },
    });
  } catch (err) {
    logger.error('Video download error:', err);
    res.status(500).json({ success: false, error: err.message || 'Video download failed' });
  }
});

// ── POST /api/download/audio ────────────────────────────────────────────────
router.post('/audio', async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    const result = await ytdlpService.downloadAudio(url);

    supabaseService.logDownload({
      url, platform: ytdlpService.detectPlatform(url),
      format: 'audio',
      fileSizeBytes: fs.statSync(result.filePath).size,
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        downloadUrl: `/files/${result.fileName}`,
        fileName: result.fileName,
        fileId: result.fileId,
        format: 'mp3',
      },
    });
  } catch (err) {
    logger.error('Audio download error:', err);
    res.status(500).json({ success: false, error: err.message || 'Audio extraction failed' });
  }
});

// ── POST /api/download/thumbnail ────────────────────────────────────────────
router.post('/thumbnail', async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    const result = await ytdlpService.downloadThumbnail(url);

    supabaseService.logDownload({
      url, platform: ytdlpService.detectPlatform(url),
      format: 'thumbnail',
      ip: req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        downloadUrl: `/files/${result.fileName}`,
        fileName: result.fileName,
      },
    });
  } catch (err) {
    logger.error('Thumbnail error:', err);
    res.status(500).json({ success: false, error: err.message || 'Thumbnail download failed' });
  }
});

// ── POST /api/download/all (ZIP) ─────────────────────────────────────────────
router.post('/all', async (req, res, next) => {
  const { url, quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    const [videoResult, audioResult] = await Promise.allSettled([
      ytdlpService.downloadVideo(url, quality),
      ytdlpService.downloadAudio(url),
    ]);

    const zipId = uuidv4();
    const zipPath = path.join(TMP_DIR, `${zipId}.zip`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const output = fs.createWriteStream(zipPath);

    await new Promise((resolve, reject) => {
      archive.pipe(output);

      if (videoResult.status === 'fulfilled') {
        archive.file(videoResult.value.filePath, { name: videoResult.value.fileName });
      }
      if (audioResult.status === 'fulfilled') {
        archive.file(audioResult.value.filePath, { name: audioResult.value.fileName });
      }

      archive.finalize();
      output.on('close', resolve);
      archive.on('error', reject);
    });

    res.json({
      success: true,
      data: {
        downloadUrl: `/files/${path.basename(zipPath)}`,
        fileName: path.basename(zipPath),
        format: 'zip',
      },
    });
  } catch (err) {
    logger.error('All download error:', err);
    res.status(500).json({ success: false, error: err.message || 'Download package failed' });
  }
});

// ── POST /api/download/batch ─────────────────────────────────────────────────
router.post('/batch', async (req, res, next) => {
  const { urls, quality = 'best' } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: 'URLs array is required' });
  }
  if (urls.length > 10) {
    return res.status(400).json({ success: false, error: 'Maximum 10 URLs per batch' });
  }

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const info = await ytdlpService.getMediaInfo(url);
      const video = await ytdlpService.downloadVideo(url, quality);
      return { url, info, downloadUrl: `/files/${video.fileName}`, fileName: video.fileName };
    })
  );

  const processed = results.map((r, i) => ({
    url: urls[i],
    success: r.status === 'fulfilled',
    ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
  }));

  res.json({ success: true, data: processed });
});

module.exports = router;
