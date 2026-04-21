const fs = require('fs');
const path = require('path');
const YTDlpWrap = require('yt-dlp-wrap').default;

const binPath = path.join(__dirname, '..', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function setup() {
  if (fs.existsSync(binPath)) {
    console.log(`yt-dlp already exists at ${binPath}. Skipping download.`);
    return;
  }
  
  console.log(`Downloading latest yt-dlp binary for ${process.platform}...`);
  try {
    await YTDlpWrap.downloadFromGithub(binPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(binPath, '755'); // Make executable on linux/mac
    }
    console.log('✅ yt-dlp downloaded successfully!');
  } catch (err) {
    console.error('❌ Failed to download yt-dlp:', err.message);
    process.exit(1);
  }
}

setup();
