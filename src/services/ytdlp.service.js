const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const ytBinPath = path.join(__dirname, '..', '..', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlp = new YTDlpWrap(process.env.YTDLP_PATH || ytBinPath);
const TMP_DIR = process.env.TEMP_DIR || path.join(__dirname, '..', '..', 'tmp');

// ── Platform detection ───────────────────────────────────────────────────────
const PLATFORM_PATTERNS = {
  instagram: /instagram\.com/i,
  tiktok: /tiktok\.com/i,
  youtube: /youtube\.com|youtu\.be/i,
  twitter: /twitter\.com|x\.com/i,
  facebook: /facebook\.com|fb\.watch/i,
  reddit: /reddit\.com/i,
};

function detectPlatform(url) {
  for (const [name, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(url)) return name;
  }
  return 'unknown';
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    return parsed.href;
  } catch {
    throw new Error('Invalid URL format');
  }
}

// ── Quality format mapping ───────────────────────────────────────────────────
const QUALITY_FORMATS = {
  '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720p':  'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480p':  'bestvideo[height<=480]+bestaudio/best[height<=480]',
  'best':  'bestvideo+bestaudio/best',
};

// ── Get media info (fast metadata only) ─────────────────────────────────────
async function getMediaInfo(url) {
  const cleanUrl = sanitizeUrl(url);
  const platform = detectPlatform(cleanUrl);

  logger.info(`Fetching info for: ${cleanUrl} [${platform}]`);

  const infoRaw = await ytDlp.getVideoInfo(cleanUrl);

  // Determine content type
  let contentType = 'video';
  if (infoRaw._type === 'playlist' && infoRaw.entries?.length > 1) {
    contentType = 'carousel';
  } else if (infoRaw.vcodec === 'none' || !infoRaw.vcodec) {
    contentType = 'audio';
  } else if (!infoRaw.duration && infoRaw.ext === 'jpg') {
    contentType = 'image';
  }

  // Pick best thumbnail
  const thumbnails = infoRaw.thumbnails || [];
  const bestThumb = thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0))[0];

  // Available qualities
  const formats = (infoRaw.formats || [])
    .filter(f => f.height)
    .map(f => `${f.height}p`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => parseInt(b) - parseInt(a));

  // Clean caption
  const rawCaption = infoRaw.description || infoRaw.title || '';
  const cleanedCaption = rawCaption
    .replace(/#\w+/g, '')
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Estimate file size (bytes)
  const bestFormat = (infoRaw.formats || []).find(f => f.filesize) || {};
  const estimatedSize = bestFormat.filesize || infoRaw.filesize || null;

  return {
    platform,
    contentType,
    title: infoRaw.title || 'Untitled',
    caption: rawCaption,
    cleanCaption: cleanedCaption,
    duration: infoRaw.duration || null,
    durationString: infoRaw.duration_string || null,
    width: infoRaw.width || null,
    height: infoRaw.height || null,
    resolution: infoRaw.height ? `${infoRaw.width}x${infoRaw.height}` : null,
    thumbnail: bestThumb?.url || infoRaw.thumbnail || null,
    availableQualities: formats.length ? formats : ['720p', '480p'],
    estimatedSizeBytes: estimatedSize,
    estimatedSizeMB: estimatedSize ? (estimatedSize / 1024 / 1024).toFixed(1) : null,
    uploader: infoRaw.uploader || infoRaw.channel || null,
    uploadDate: infoRaw.upload_date || null,
    viewCount: infoRaw.view_count || null,
    likeCount: infoRaw.like_count || null,
    isPlaylist: contentType === 'carousel',
    entries: contentType === 'carousel' 
      ? (infoRaw.entries || []).slice(0, 10).map(e => ({
          id: e.id,
          title: e.title,
          thumbnail: e.thumbnail,
          duration: e.duration,
        }))
      : null,
  };
}

// ── Download video ─────────────────────────────────────────────────────────
async function downloadVideo(url, quality = 'best', onProgress) {
  const cleanUrl = sanitizeUrl(url);
  const fileId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${fileId}.%(ext)s`);
  const format = QUALITY_FORMATS[quality] || QUALITY_FORMATS['best'];

  logger.info(`Downloading video [${quality}]: ${cleanUrl}`);

  return new Promise((resolve, reject) => {
    const args = [
      cleanUrl,
      '-f', format,
      '-o', outputPath,
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', require('ffmpeg-static'),
      '--no-warnings',
      '--quiet',
      '--progress',
    ];

    const process = ytDlp.exec(args);
    let finalPath = null;

    process.on('ytDlpEvent', (eventType, eventData) => {
      if (eventType === 'download' && onProgress) {
        const match = eventData.match(/(\d+\.?\d*)%/);
        if (match) onProgress(parseFloat(match[1]));
      }
      if (eventType === 'merger' || eventType === 'download') {
        const pathMatch = eventData.match(/Destination:\s*(.+)/);
        if (pathMatch) finalPath = pathMatch[1].trim();
      }
    });

    process.on('close', (code) => {
      if (code === 0) {
        // Find the actual output file
        const files = fs.readdirSync(TMP_DIR)
          .filter(f => f.startsWith(fileId))
          .map(f => path.join(TMP_DIR, f));
        const file = files[0];
        if (file && fs.existsSync(file)) {
          resolve({ filePath: file, fileName: path.basename(file), fileId });
        } else {
          reject(new Error('Output file not found after download'));
        }
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    process.on('error', reject);
  });
}

// ── Download audio (MP3) ────────────────────────────────────────────────────
async function downloadAudio(url, onProgress) {
  const cleanUrl = sanitizeUrl(url);
  const fileId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${fileId}.%(ext)s`);

  logger.info(`Extracting audio: ${cleanUrl}`);

  return new Promise((resolve, reject) => {
    const args = [
      cleanUrl,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', outputPath,
      '--no-playlist',
      '--ffmpeg-location', require('ffmpeg-static'),
      '--quiet',
    ];

    const proc = ytDlp.exec(args);

    proc.on('ytDlpEvent', (eventType, eventData) => {
      if (eventType === 'download' && onProgress) {
        const match = eventData.match(/(\d+\.?\d*)%/);
        if (match) onProgress(parseFloat(match[1]));
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const files = fs.readdirSync(TMP_DIR)
          .filter(f => f.startsWith(fileId))
          .map(f => path.join(TMP_DIR, f));
        const file = files[0];
        if (file && fs.existsSync(file)) {
          resolve({ filePath: file, fileName: path.basename(file), fileId });
        } else {
          reject(new Error('Audio file not found after extraction'));
        }
      } else {
        reject(new Error(`yt-dlp audio extraction failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// ── Download thumbnail ──────────────────────────────────────────────────────
async function downloadThumbnail(url) {
  const cleanUrl = sanitizeUrl(url);
  const fileId = uuidv4();
  const outputPath = path.join(TMP_DIR, `${fileId}.%(ext)s`);

  return new Promise((resolve, reject) => {
    const args = [
      cleanUrl,
      '--write-thumbnail',
      '--skip-download',
      '-o', outputPath,
      '--quiet',
    ];

    const proc = ytDlp.exec(args);

    proc.on('close', (code) => {
      const files = fs.readdirSync(TMP_DIR)
        .filter(f => f.startsWith(fileId))
        .map(f => path.join(TMP_DIR, f));
      const file = files[0];
      if (file && fs.existsSync(file)) {
        resolve({ filePath: file, fileName: path.basename(file), fileId });
      } else {
        reject(new Error('Thumbnail not found'));
      }
    });

    proc.on('error', reject);
  });
}

// ── Cleanup old temp files (>1 hour) ───────────────────────────────────────
function cleanupTempFiles() {
  try {
    const now = Date.now();
    const files = fs.readdirSync(TMP_DIR);
    files.forEach(file => {
      const filePath = path.join(TMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        logger.debug(`Cleaned up temp file: ${file}`);
      }
    });
  } catch (err) {
    logger.error('Cleanup error:', err);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupTempFiles, 30 * 60 * 1000);

module.exports = {
  getMediaInfo,
  downloadVideo,
  downloadAudio,
  downloadThumbnail,
  detectPlatform,
  sanitizeUrl,
};
