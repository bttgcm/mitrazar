import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// three-globe's ES module build (three-globe.mjs) has bare imports for
// internal deps (kapsule, d3-geo, three/examples/jsm/*, ...) that only a
// bundler can resolve — loading it directly in a browser fails silently.
// Its UMD build bundles all of that in and only needs a global THREE, so we
// set that from our ES-module import and load the UMD build dynamically.
const THREE_GLOBE_SRC = 'https://unpkg.com/three-globe@2.45.6/dist/three-globe.min.js';
const GLOBE_IMG = 'https://unpkg.com/three-globe@2.45.6/example/img/earth-blue-marble.jpg';
const BUMP_IMG = 'https://unpkg.com/three-globe@2.45.6/example/img/earth-topology.png';

window.THREE = THREE;

function loadThreeGlobe() {
  if (window.ThreeGlobe) return Promise.resolve(window.ThreeGlobe);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = THREE_GLOBE_SRC;
    script.onload = () => resolve(window.ThreeGlobe);
    script.onerror = () => reject(new Error(`Failed to load ${THREE_GLOBE_SRC}`));
    document.head.appendChild(script);
  });
}

const container = document.getElementById('globe-container');
const loadingEl = document.getElementById('loading');
const hintEl = document.getElementById('globe-hint');
const tooltip = document.getElementById('pin-tooltip');

const modal = document.getElementById('location-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalPhotos = document.getElementById('modal-photos');
const modalVideos = document.getElementById('modal-videos');
const modalPhotosWrap = document.getElementById('modal-photos-wrap');
const modalVideosWrap = document.getElementById('modal-videos-wrap');

const lightbox = document.getElementById('lightbox');
const lightboxContent = document.getElementById('lightbox-content');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxPrevBtn = document.querySelector('.lightbox-prev');
const lightboxNextBtn = document.querySelector('.lightbox-next');

let controls;
let currentGallery = []; // combined photos + videos for the open location, in thumb order
let currentIndex = -1;

init();

async function init() {
  let locations = [];
  let ThreeGlobe;
  try {
    const [res, globeCtor] = await Promise.all([fetch('data/locations.json'), loadThreeGlobe()]);
    locations = res.ok ? await res.json() : [];
    ThreeGlobe = globeCtor;
  } catch (err) {
    loadingEl.textContent = 'Failed to load the globe (see console for details).';
    console.error(err);
    return;
  }
  loadingEl.remove();
  hintEl.textContent = locations.length
    ? 'Drag to rotate · scroll to zoom · click a pin'
    : 'No locations found — run "npm run build" after adding one to /locations';
  buildScene(locations, ThreeGlobe);
}

function buildScene(locations, ThreeGlobe) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
  sunLight.position.set(1, 1, 1);
  scene.add(sunLight);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 0, 320);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // three-globe (unlike the higher-level globe.gl wrapper) has no built-in
  // click/hover API — it just builds the Object3D tree and tags each point's
  // mesh with the source datum on `__data`. Picking is done by raycasting
  // ourselves and walking up to find that tag.
  const globe = new ThreeGlobe()
    .globeImageUrl(GLOBE_IMG)
    .bumpImageUrl(BUMP_IMG)
    .pointsData(locations)
    .pointLat('lat')
    .pointLng('lon')
    .pointColor(() => '#ff5a3c')
    .pointAltitude(0.025)
    .pointRadius(1.1)
    .pointResolution(24)
    .pointsMerge(false);

  scene.add(globe);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const PICK_RADIUS_PX = 22; // forgiving click/hover target around each pin

  function pickLocation(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    pointer.x = (clickX / rect.width) * 2 - 1;
    pointer.y = -(clickY / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    // Exact geometry hit first (works when zoomed in close).
    const hits = raycaster.intersectObject(globe, true);
    for (const { object } of hits) {
      let o = object;
      while (o && !o.__data) o = o.parent;
      if (o && o.__data) return o.__data;
    }

    // Pins are only a few pixels across at default zoom, so fall back to
    // the nearest pin within a forgiving screen-space radius, skipping any
    // on the far side of the globe.
    const cameraDir = camera.position.clone().normalize();
    let best = null;
    let bestDist = PICK_RADIUS_PX;
    for (const loc of locations) {
      const c = globe.getCoords(loc.lat, loc.lon, 0.02);
      const worldPos = new THREE.Vector3(c.x, c.y, c.z);
      if (worldPos.clone().normalize().dot(cameraDir) < 0.1) continue;
      const screenPos = worldPos.project(camera);
      const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
      const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;
      const dist = Math.hypot(sx - clickX, sy - clickY);
      if (dist < bestDist) {
        bestDist = dist;
        best = loc;
      }
    }
    return best;
  }

  let pointerDownPos = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    const start = pointerDownPos;
    pointerDownPos = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
    const loc = pickLocation(e);
    if (loc) {
      tooltip.classList.add('hidden');
      openModal(loc);
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (pointerDownPos) {
      tooltip.classList.add('hidden');
      return;
    }
    const loc = pickLocation(e);
    renderer.domElement.style.cursor = loc ? 'pointer' : 'grab';
    if (loc) {
      tooltip.textContent = loc.title;
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY}px`;
      tooltip.classList.remove('hidden');
    } else {
      tooltip.classList.add('hidden');
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    tooltip.classList.add('hidden');
  });

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 150;
  controls.maxDistance = 600;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  renderer.domElement.style.cursor = 'grab';

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();
}

function openModal(loc) {
  if (controls) controls.autoRotate = false;

  modalTitle.textContent = loc.title;
  modalBody.textContent = loc.body || '';

  currentGallery = [];

  modalPhotos.innerHTML = '';
  (loc.photos || []).forEach((src) => {
    const index = currentGallery.length;
    currentGallery.push({ type: 'photo', src, alt: loc.title });
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = src;
    img.alt = loc.title;
    thumb.appendChild(img);
    thumb.addEventListener('click', () => openLightboxAt(index));
    modalPhotos.appendChild(thumb);
  });
  modalPhotosWrap.style.display = (loc.photos || []).length ? '' : 'none';

  modalVideos.innerHTML = '';
  (loc.videos || []).forEach((video) => {
    const index = currentGallery.length;
    currentGallery.push({ type: 'video', url: video.url, title: video.title });
    const thumb = document.createElement('div');
    thumb.className = 'thumb video-thumb';
    const playIcon = document.createElement('div');
    playIcon.className = 'play-icon';
    const title = document.createElement('div');
    title.className = 'video-title';
    title.textContent = video.title;
    thumb.appendChild(playIcon);
    thumb.appendChild(title);
    thumb.addEventListener('click', () => openLightboxAt(index));
    modalVideos.appendChild(thumb);
  });
  modalVideosWrap.style.display = (loc.videos || []).length ? '' : 'none';

  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
  if (controls) controls.autoRotate = true;
}

function renderLightboxItem(index) {
  if (!currentGallery.length) return;
  currentIndex = ((index % currentGallery.length) + currentGallery.length) % currentGallery.length;
  const item = currentGallery[currentIndex];

  lightboxContent.querySelectorAll('video').forEach((v) => v.pause());
  lightboxContent.innerHTML = '';

  if (item.type === 'video') {
    if (item.url.trim().startsWith('<')) {
      // A pasted provider embed snippet (Vimeo/YouTube "Share > Embed"),
      // authored by the site owner via videos.txt — not public input, so
      // injecting it is the same trust level as writing it in this file.
      const wrap = document.createElement('div');
      wrap.className = 'embed-wrap';
      wrap.innerHTML = item.url;
      lightboxContent.appendChild(wrap);
    } else {
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.autoplay = true;
      lightboxContent.appendChild(video);
    }
  } else {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.alt;
    lightboxContent.appendChild(img);
  }

  const multi = currentGallery.length > 1;
  lightboxPrevBtn.classList.toggle('hidden', !multi);
  lightboxNextBtn.classList.toggle('hidden', !multi);
  lightboxCounter.classList.toggle('hidden', !multi);
  lightboxCounter.textContent = `${currentIndex + 1} / ${currentGallery.length}`;
}

function openLightboxAt(index) {
  renderLightboxItem(index);
  lightbox.classList.remove('hidden');
}

function closeLightbox() {
  lightboxContent.querySelectorAll('video').forEach((v) => v.pause());
  lightboxContent.innerHTML = '';
  lightbox.classList.add('hidden');
}

document.querySelector('.modal-close').addEventListener('click', closeModal);
document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);

modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
lightboxPrevBtn.addEventListener('click', () => renderLightboxItem(currentIndex - 1));
lightboxNextBtn.addEventListener('click', () => renderLightboxItem(currentIndex + 1));

document.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('hidden')) {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') renderLightboxItem(currentIndex + 1);
    else if (e.key === 'ArrowLeft') renderLightboxItem(currentIndex - 1);
    return;
  }
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
});
