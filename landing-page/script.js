// Initialize Lucide Icons
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }
});

// Demo Mode Switcher (GIF vs MP4 Web vs Original MP4)
function switchDemoMode(mode) {
  const gifView = document.getElementById('demo-gif-view');
  const mp4View = document.getElementById('demo-mp4-view');
  const videoSource = document.getElementById('video-source');
  const filename = document.getElementById('video-filename');
  const badge = document.getElementById('demo-badge');
  const description = document.getElementById('demo-description');
  const mediaLink = document.getElementById('download-media-link');

  const tabGif = document.getElementById('tab-gif');
  const tabMp4 = document.getElementById('tab-mp4');
  const tabOrig = document.getElementById('tab-orig');

  // Reset tab classes
  const activeClass = 'bg-blue-600 text-white shadow-md';
  const inactiveClass = 'text-slate-400 hover:text-white';

  tabGif.className = `px-5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${mode === 'gif' ? activeClass : inactiveClass}`;
  tabMp4.className = `px-5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${mode === 'mp4' ? activeClass : inactiveClass}`;
  tabOrig.className = `px-5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${mode === 'orig' ? activeClass : inactiveClass}`;

  if (mode === 'gif') {
    mp4View.pause();
    mp4View.classList.add('hidden');
    gifView.classList.remove('hidden');

    filename.textContent = 'app-demo.gif';
    badge.textContent = 'GIF Preview';
    badge.className = 'px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono';
    description.textContent = 'Showing lightweight auto-playing GIF. Click "Full HD Video" to stream 1080p video with audio.';
    mediaLink.href = 'assets/images/app-demo.gif';
  } else if (mode === 'mp4') {
    gifView.classList.add('hidden');
    mp4View.classList.remove('hidden');
    
    videoSource.src = 'assets/videos/app-demo-web.mp4';
    mp4View.load();
    mp4View.play().catch(() => {});

    filename.textContent = 'app-demo-web.mp4 (1080p Web Video)';
    badge.textContent = '1080p MP4';
    badge.className = 'px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono';
    description.textContent = 'Streaming Web-Optimized 1080p MP4 Video (24 MB). Includes full desktop interaction & audio.';
    mediaLink.href = 'assets/videos/app-demo-web.mp4';
  } else if (mode === 'orig') {
    gifView.classList.add('hidden');
    mp4View.classList.remove('hidden');

    videoSource.src = 'assets/videos/app-demo.mp4';
    mp4View.load();
    mp4View.play().catch(() => {});

    filename.textContent = 'app-demo.mp4 (Original Source 70MB)';
    badge.textContent = 'Raw 70MB Source';
    badge.className = 'px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono';
    description.textContent = 'Streaming Uncompressed Original MP4 Video File (70 MB).';
    mediaLink.href = 'assets/videos/app-demo.mp4';
  }
}

// Lightbox Modal for Screenshots
function openLightbox(imgSrc, title) {
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');

  lightboxImg.src = imgSrc;
  lightboxTitle.textContent = title;
  lightbox.classList.remove('hidden');
  lightbox.classList.add('flex');
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  lightbox.classList.add('hidden');
  lightbox.classList.remove('flex');
}

// Close lightbox on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLightbox();
  }
});
