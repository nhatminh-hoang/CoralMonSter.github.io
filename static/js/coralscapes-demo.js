/* CoralScapes V1 ground-truth explorer. No model inference is performed. */
(function () {
  'use strict';

  const root = document.getElementById('coralscapes-demo');
  if (!root) return;

  const DATASET = 'EPFL-ECEO/coralscapes';
  const SAMPLE_INDICES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const GROUPS = {
    alive: {
      label: 'Coral alive',
      ids: [6, 17, 21, 22, 25, 27, 28, 31, 34, 36],
      color: [41, 214, 169]
    },
    dead: {
      label: 'Coral dead',
      ids: [3, 20, 23, 32, 37],
      color: [255, 150, 91]
    },
    bleached: {
      label: 'Coral bleached',
      ids: [4, 16, 19, 33],
      color: [249, 116, 182]
    }
  };
  // Exact color values from the official 39-class CoralScapes V1 palette.
  // Some image decoders expose the palette RGB; others expose grayscale class IDs.
  const PALETTE = {
    3: [114, 60, 61], 4: [250, 224, 225], 6: [224, 118, 119],
    16: [255, 248, 228], 17: [236, 150, 21], 19: [252, 231, 240],
    20: [123, 50, 86], 21: [244, 150, 115], 22: [226, 91, 157],
    23: [134, 86, 18], 25: [236, 128, 255], 27: [228, 255, 119],
    28: [189, 119, 255], 31: [255, 146, 150], 32: [85, 53, 116],
    33: [251, 243, 216], 34: [255, 111, 194], 36: [230, 193, 0],
    37: [119, 100, 14]
  };

  const groupCode = { alive: 1, dead: 2, bleached: 3 };
  const idToCode = new Uint8Array(256);
  const paletteToCode = new Map();
  Object.keys(GROUPS).forEach(function (key) {
    GROUPS[key].ids.forEach(function (id) {
      idToCode[id] = groupCode[key];
      const color = PALETTE[id];
      if (color) paletteToCode.set(color.join(','), groupCode[key]);
    });
  });

  const viewer = root.querySelector('[data-demo-viewer]');
  const rgbImage = root.querySelector('[data-demo-rgb]');
  const maskCanvas = root.querySelector('[data-demo-mask]');
  const counter = root.querySelector('[data-demo-counter]');
  const status = root.querySelector('[data-demo-status]');
  const thumbnails = root.querySelector('[data-demo-thumbnails]');
  const positionText = root.querySelector('[data-demo-position]');
  const opacityInput = root.querySelector('[data-demo-opacity]');
  const opacityText = root.querySelector('[data-demo-opacity-value]');
  const retryButton = root.querySelector('[data-demo-retry]');
  const labelButtons = Array.from(root.querySelectorAll('[data-coral-label]'));
  const coverage = root.querySelector('[data-demo-coverage]');

  let samples = [];
  let selectedIndex = -1;
  let selectedGroup = 'all';
  let reveal = 50;
  let opacity = Number(opacityInput.value) / 100;
  let dragging = false;
  let loadVersion = 0;
  let pixels = null;
  let maskWidth = 0;
  let maskHeight = 0;
  let counts = [0, 0, 0, 0];

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('is-error', !!isError);
  }

  function setReveal(value) {
    reveal = Math.max(0, Math.min(100, value));
    maskCanvas.style.clipPath = 'inset(0 0 0 ' + reveal + '%)';
    viewer.style.setProperty('--reveal', reveal + '%');
    viewer.setAttribute('aria-valuenow', String(Math.round(reveal)));
    positionText.textContent = Math.round(reveal) + '%';
  }

  function readGroup(r, g, b) {
    if (r <= 39 && g === r && b === r) return idToCode[r];
    if (r <= 39 && g === 0 && b === 0) return idToCode[r];
    return paletteToCode.get(r + ',' + g + ',' + b) || 0;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('Could not load a CoralScapes image or mask.')); };
      image.src = url;
    });
  }

  function drawOverlay() {
    if (!pixels) return;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: false });
    const output = ctx.createImageData(maskWidth, maskHeight);
    const out = output.data;
    const keys = ['alive', 'dead', 'bleached'];
    const colors = keys.map(function (key) { return GROUPS[key].color; });
    const intensity = Math.round(opacity * 255);
    for (let i = 0, j = 0; i < pixels.length; i++, j += 4) {
      const code = pixels[i];
      if (!code || (selectedGroup !== 'all' && code !== groupCode[selectedGroup])) continue;
      const color = colors[code - 1];
      out[j] = color[0];
      out[j + 1] = color[1];
      out[j + 2] = color[2];
      out[j + 3] = intensity;
    }
    ctx.putImageData(output, 0, 0);
    updateCoverage();
  }

  function updateCoverage() {
    if (!pixels) {
      coverage.textContent = 'Select an image to inspect its masks.';
      return;
    }
    const names = ['alive', 'dead', 'bleached'];
    const visible = selectedGroup === 'all' ? names : [selectedGroup];
    coverage.textContent = visible.map(function (key) {
      const count = counts[groupCode[key]];
      return GROUPS[key].label + ': ' + (count ? (100 * count / pixels.length).toFixed(1) + '% of image' : 'not annotated in this sample');
    }).join('  ·  ');
  }

  function setGroup(group) {
    selectedGroup = group;
    labelButtons.forEach(function (button) {
      const active = button.dataset.coralLabel === group;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    drawOverlay();
  }

  function renderThumbnails() {
    thumbnails.replaceChildren();
    samples.forEach(function (sample, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'coral-demo__thumb';
      button.setAttribute('aria-label', 'View CoralScapes sample ' + (index + 1));
      const image = document.createElement('img');
      image.src = sample.image.src;
      image.alt = '';
      image.loading = 'lazy';
      const number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      button.append(image, number);
      button.addEventListener('click', function () { selectSample(index); });
      thumbnails.appendChild(button);
    });
  }

  async function selectSample(index) {
    selectedIndex = index;
    const version = ++loadVersion;
    const sample = samples[index];
    if (!sample) return;

    thumbnails.querySelectorAll('button').forEach(function (button, i) {
      button.classList.toggle('is-selected', i === index);
      button.setAttribute('aria-pressed', String(i === index));
    });
    counter.textContent = 'Sample ' + String(index + 1).padStart(2, '0') + ' / ' + samples.length +
      ' · validation row ' + sample.index;
    viewer.classList.add('is-loading');
    pixels = null;
    rgbImage.removeAttribute('src');
    maskCanvas.getContext('2d').clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    updateCoverage();
    setStatus('Loading original RGB image and pixel-level annotations…');

    try {
      const images = await Promise.all([loadImage(sample.image.src), loadImage(sample.label.src)]);
      if (version !== loadVersion) return;

      const sourceImage = images[0];
      const sourceMask = images[1];
      if (sourceImage.naturalWidth !== sourceMask.naturalWidth ||
          sourceImage.naturalHeight !== sourceMask.naturalHeight) {
        throw new Error('The RGB and annotation dimensions do not match.');
      }

      maskWidth = sourceMask.naturalWidth;
      maskHeight = sourceMask.naturalHeight;
      const decodingCanvas = document.createElement('canvas');
      decodingCanvas.width = maskWidth;
      decodingCanvas.height = maskHeight;
      const decodingContext = decodingCanvas.getContext('2d', { willReadFrequently: true });
      decodingContext.drawImage(sourceMask, 0, 0);
      // This reads the original mask pixels, never the photographic RGB pixels.
      const raw = decodingContext.getImageData(0, 0, maskWidth, maskHeight).data;
      const decoded = new Uint8Array(maskWidth * maskHeight);
      const newCounts = [0, 0, 0, 0];
      for (let pixel = 0, byte = 0; pixel < decoded.length; pixel++, byte += 4) {
        const code = readGroup(raw[byte], raw[byte + 1], raw[byte + 2]);
        decoded[pixel] = code;
        newCounts[code]++;
      }
      if (version !== loadVersion) return;
      pixels = decoded;
      counts = newCounts;
      rgbImage.src = sourceImage.src;
      maskCanvas.width = maskWidth;
      maskCanvas.height = maskHeight;
      drawOverlay();
      setStatus('Ground-truth overlay ready. Move or drag over the image to compare.');
    } catch (error) {
      if (version !== loadVersion) return;
      console.error('CoralScapes demo:', error);
      setStatus('Could not decode this pair. Try another sample or reload the dataset. ' +
        '(Remote images must allow cross-origin canvas access.)', true);
    } finally {
      if (version === loadVersion) viewer.classList.remove('is-loading');
    }
  }

  async function initialize() {
    ++loadVersion;
    retryButton.hidden = true;
    setStatus('Fetching 10 paired CoralScapes validation examples…');
    try {
      const url = new URL('https://datasets-server.huggingface.co/rows');
      url.searchParams.set('dataset', DATASET);
      url.searchParams.set('config', 'default');
      url.searchParams.set('split', 'validation');
      url.searchParams.set('offset', '0');
      url.searchParams.set('length', '100');

      // The endpoint generates fresh, short-lived image URLs on each page load.
      const response = await fetch(url.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Dataset viewer returned HTTP ' + response.status);
      const dataset = await response.json();
      const available = new Map((dataset.rows || []).map(function (item) {
        return [item.row_idx, item.row];
      }));
      samples = SAMPLE_INDICES.map(function (index) {
        const row = available.get(index);
        return row && row.image && row.label && row.image.src && row.label.src
          ? { index: index, image: row.image, label: row.label } : null;
      }).filter(Boolean);
      if (samples.length !== 10) throw new Error('Fewer than 10 image–mask pairs were available.');
      renderThumbnails();
      await selectSample(0);
    } catch (error) {
      console.error('CoralScapes dataset fetch:', error);
      setStatus('The CoralScapes dataset service is unavailable. Reload the dataset to try again.', true);
      retryButton.hidden = false;
    }
  }

  function updatePointer(event) {
    const bounds = viewer.getBoundingClientRect();
    setReveal(100 * (event.clientX - bounds.left) / bounds.width);
  }

  viewer.addEventListener('pointerdown', function (event) {
    dragging = true;
    viewer.setPointerCapture(event.pointerId);
    updatePointer(event);
  });
  viewer.addEventListener('pointermove', function (event) {
    if (dragging || event.pointerType === 'mouse') updatePointer(event);
  });
  viewer.addEventListener('pointerup', function () { dragging = false; });
  viewer.addEventListener('pointercancel', function () { dragging = false; });
  viewer.addEventListener('keydown', function (event) {
    let next = reveal;
    if (event.key === 'ArrowLeft') next -= 5;
    else if (event.key === 'ArrowRight') next += 5;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 100;
    else return;
    event.preventDefault();
    setReveal(next);
  });

  labelButtons.forEach(function (button) {
    button.addEventListener('click', function () { setGroup(button.dataset.coralLabel); });
  });

  opacityInput.addEventListener('input', function () {
    opacity = Number(opacityInput.value) / 100;
    opacityText.textContent = opacityInput.value + '%';
    drawOverlay();
  });
  retryButton.addEventListener('click', initialize);
  setReveal(50);
  setGroup('all');
  initialize();
})();