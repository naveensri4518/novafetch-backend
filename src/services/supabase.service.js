const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let supabase = null;

const dataPath = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath);
const analyticsFile = path.join(dataPath, 'analytics.json');

let fallbackData = { total: 0, video: 0, audio: 0, thumbnail: 0, platforms: {} };
if (fs.existsSync(analyticsFile)) {
  try { fallbackData = JSON.parse(fs.readFileSync(analyticsFile, 'utf-8')); } catch(e){}
}
function saveFallback() {
  try { fs.writeFileSync(analyticsFile, JSON.stringify(fallbackData, null, 2)); } catch(e){}
}

function getClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (url && key && !url.includes('your_supabase')) {
      supabase = createClient(url, key);
    }
  }
  return supabase;
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + 'novafetch_salt').digest('hex').slice(0, 16);
}

async function logDownload({ url, platform, format, quality, fileSizeBytes, ip }) {
  const client = getClient();
  if (!client) {
    fallbackData.total++;
    if (format === 'video') fallbackData.video++;
    else if (format === 'audio') fallbackData.audio++;
    else if (format === 'thumbnail') fallbackData.thumbnail++;
    if (platform) fallbackData.platforms[platform] = (fallbackData.platforms[platform] || 0) + 1;
    saveFallback();
    return null;
  }

  try {
    const { data, error } = await client.from('download_logs').insert({
      url: url.substring(0, 500),
      platform,
      format,
      quality: quality || 'best',
      file_size: fileSizeBytes || null,
      ip_hash: hashIp(ip || 'unknown'),
      created_at: new Date().toISOString(),
    });

    if (error) logger.warn('Supabase log error:', error.message);
    return data;
  } catch (err) {
    logger.warn('Supabase logDownload failed:', err.message);
    return null;
  }
}

async function getAnalytics() {
  const client = getClient();
  if (!client) {
    return {
      totalDownloads: fallbackData.total,
      videoDownloads: fallbackData.video,
      audioDownloads: fallbackData.audio,
      thumbnailDownloads: fallbackData.thumbnail,
      topPlatforms: Object.entries(fallbackData.platforms)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([platform, count]) => ({ platform, count })),
    };
  }

  try {
    const { data: total } = await client
      .from('download_logs')
      .select('id', { count: 'exact', head: true });

    const { data: byFormat } = await client
      .from('download_logs')
      .select('format')
      .then(r => r);

    const counts = { video: 0, audio: 0, thumbnail: 0 };
    (byFormat || []).forEach(r => { if (counts[r.format] !== undefined) counts[r.format]++; });

    const { data: platforms } = await client
      .from('download_logs')
      .select('platform')
      .limit(1000);

    const platformCounts = {};
    (platforms || []).forEach(r => {
      platformCounts[r.platform] = (platformCounts[r.platform] || 0) + 1;
    });

    return {
      totalDownloads: total?.length || 0,
      videoDownloads: counts.video,
      audioDownloads: counts.audio,
      thumbnailDownloads: counts.thumbnail,
      topPlatforms: Object.entries(platformCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([platform, count]) => ({ platform, count })),
    };
  } catch (err) {
    logger.warn('Supabase getAnalytics failed:', err.message);
    return { totalDownloads: 0, videoDownloads: 0, audioDownloads: 0, thumbnailDownloads: 0, topPlatforms: [] };
  }
}

module.exports = { logDownload, getAnalytics };
