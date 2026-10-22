(() => {
  'use strict';

  const root = document.querySelector('[data-wvos-root]');
  if (!root) return;

  const find = (name) => root.querySelector(`[data-wvos-${name}]`);
  const viewer = find('viewer');
  const canvas = find('overlay');
  const context = canvas.getContext('2d');
  const handle = find('handle');
  const select = find('select');
  const play = find('play');
  const view = find('view');
  const timeline = find('timeline');
  const status = find('status');
  const retry = find('retry');
  const legend = find('legend');
  let video = find('video');
  let clips = [];
  let active = null;
  let generation = 0;
  let controller = null;
  let initialized = false;
  let pointerId = null;
  let display = { kind: 'split', fraction: 0.5 };

  function validateManifest(data) {
    if (!data || !Array.isArray(data.clips) || !data.clips.length) throw new Error('Invalid clip manifest.');
    const ids = new Set();
    for (const clip of data.clips) {
      const dimensions = ['fps', 'frameCount', 'sourceWidth', 'sourceHeight', 'width', 'height'];
      if (!clip || dimensions.some((key) => !Number.isSafeInteger(clip[key]) || clip[key] <= 0)
          || clip.fps !== 24 || clip.width % 2 || clip.height % 2
          || Math.max(clip.width, clip.height) > 1280
          || clip.width > clip.sourceWidth || clip.height > clip.sourceHeight
          || typeof clip.id !== 'string' || !clip.id || ids.has(clip.id)
          || typeof clip.title !== 'string' || !clip.title
          || ['src', 'poster', 'annotations'].some((key) => typeof clip[key] !== 'string'
            || !/^static\/videos\/wvos\/[\w.-]+$/.test(clip[key]))) {
        throw new Error('Invalid clip metadata.');
      }
      ids.add(clip.id);
    }
    return data.clips;
  }

  function validateAnnotations(data, clip) {
    if (!data || !Array.isArray(data.frames) || data.frames.length !== clip.frameCount) {
      throw new Error('Annotation frame count does not match the video.');
    }
    for (const frame of data.frames) {
      if (!Array.isArray(frame)) throw new Error('Invalid annotation frame.');
      for (const polygon of frame) {
        if (!polygon || typeof polygon.id !== 'string' || !polygon.id
            || typeof polygon.label !== 'string' || !polygon.label
            || !Array.isArray(polygon.points) || polygon.points.length < 3
            || polygon.points.some((point) => !Array.isArray(point) || point.length !== 2
              || !point.every(Number.isFinite))) {
          throw new Error('Invalid annotation polygon.');
        }
      }
    }
    return data.frames;
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()}.`);
    return response.json();
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }

  function enableControls(ready) {
    play.disabled = view.disabled = timeline.disabled = !ready;
    handle.tabIndex = ready ? 0 : -1;
    handle.setAttribute('aria-disabled', String(!ready));
    viewer.dataset.ready = String(ready);
    viewer.setAttribute('aria-busy', String(!ready));
  }

  function revealFraction() {
    return display.kind === 'split' ? display.fraction : display.kind === 'rgb' ? 1 : 0;
  }

  function setDisplay(next) {
    display = next;
    const percentage = Math.round(revealFraction() * 100);
    viewer.style.setProperty('--reveal', `${percentage}%`);
    root.dataset.view = display.kind;
    handle.setAttribute('aria-valuenow', String(percentage));
    handle.setAttribute('aria-valuetext', `${percentage}% RGB, ${100 - percentage}% annotation`);
    view.textContent = display.kind === 'annotation' ? 'Show RGB only' : 'Show full annotation';
    find('rgb-label').hidden = percentage === 0;
    find('annotation-label').hidden = percentage === 100;
  }

  function finishDrag() {
    const previous = pointerId;
    pointerId = null;
    if (previous !== null && handle.hasPointerCapture(previous)) handle.releasePointerCapture(previous);
  }

  function stopFrames(session = active) {
    if (!session || session.callback === null) return;
    if (session.video.requestVideoFrameCallback) session.video.cancelVideoFrameCallback(session.callback);
    else cancelAnimationFrame(session.callback);
    session.callback = null;
    session.epoch += 1;
  }

  function timeLabel(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }

  function drawFrame(session, mediaTime) {
    if (active !== session) return;
    const { clip, frames, colors } = session;
    const index = Math.min(clip.frameCount - 1, Math.max(0, Math.floor(mediaTime * clip.fps + 0.000001)));
    session.mediaTime = mediaTime;
    viewer.dataset.frame = String(index);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = clip.width / clip.sourceWidth;
    const scaleY = clip.height / clip.sourceHeight;
    context.lineWidth = 2 * clip.width / Math.max(1, viewer.clientWidth);
    context.strokeStyle = '#142b2a';
    for (const polygon of frames[index]) {
      context.beginPath();
      polygon.points.forEach(([x, y], pointIndex) => {
        if (pointIndex === 0) context.moveTo(x * scaleX, y * scaleY);
        else context.lineTo(x * scaleX, y * scaleY);
      });
      context.closePath();
      context.fillStyle = colors.get(polygon.id).color;
      context.globalAlpha = 0.45;
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
    }
    timeline.value = String(Math.min(mediaTime, clip.frameCount / clip.fps));
    find('time').textContent = `${timeLabel(mediaTime)} / ${timeLabel(clip.frameCount / clip.fps)}`;
    find('frame').textContent = `Frame ${index + 1} / ${clip.frameCount}`;
  }

  function scheduleFrames(session) {
    if (active !== session || session.video.paused || session.video.seeking || session.callback !== null) return;
    const epoch = session.epoch;
    const onFrame = (_, metadata) => {
      if (active !== session || session.epoch !== epoch) return;
      session.callback = null;
      if (!session.video.seeking) drawFrame(session, metadata ? metadata.mediaTime : session.video.currentTime);
      scheduleFrames(session);
    };
    session.callback = session.video.requestVideoFrameCallback
      ? session.video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame);
  }

  function fail(message, token) {
    if (token !== generation) return;
    stopFrames();
    active = null;
    if (controller) controller.abort();
    video.pause();
    finishDrag();
    enableControls(false);
    viewer.setAttribute('aria-busy', 'false');
    play.textContent = 'Play';
    setStatus(`${message} Retry this sequence or choose another.`, true);
    retry.hidden = false;
  }

  function makeColors(frames) {
    const labels = new Map();
    for (const frame of frames) for (const polygon of frame) labels.set(polygon.id, polygon.label);
    const palette = ['#29d6a9', '#ff965b', '#f974b6', '#6ebfff', '#ffe06b'];
    const colors = new Map();
    [...labels.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach((id, index) => {
      colors.set(id, { label: labels.get(id), color: palette[index % palette.length] });
    });
    return colors;
  }

  async function selectClip(id) {
    const token = ++generation;
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    stopFrames();
    active = null;
    finishDrag();
    video.pause();
    video.removeAttribute('src');
    video.load();
    // Each selection owns its media events, including events queued before a switch.
    const nextVideo = video.cloneNode(false);
    video.replaceWith(nextVideo);
    video = nextVideo;
    const clip = clips.find((item) => item.id === id);
    select.value = id;
    enableControls(false);
    play.textContent = 'Play';
    retry.hidden = true;
    legend.replaceChildren();
    canvas.width = clip.width;
    canvas.height = clip.height;
    viewer.style.setProperty('--aspect', String(clip.width / clip.height));
    setDisplay({ kind: 'split', fraction: 0.5 });
    setStatus(`Loading ${clip.title.toLowerCase()} video and annotations…`);
    nextVideo.poster = clip.poster;
    nextVideo.setAttribute('aria-label', `${clip.title} WVOS RGB video`);
    nextVideo.preload = 'auto';
    const mediaReady = new Promise((resolve, reject) => {
      nextVideo.addEventListener('loadeddata', resolve, { once: true, signal });
      nextVideo.addEventListener('error', () => reject(new Error('Could not decode the video.')), { once: true, signal });
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    nextVideo.src = clip.src;
    nextVideo.load();
    try {
      const [data] = await Promise.all([fetchJson(clip.annotations, signal), mediaReady]);
      if (token !== generation) return;
      const frames = validateAnnotations(data, clip);
      if (nextVideo.videoWidth !== clip.width || nextVideo.videoHeight !== clip.height
          || Math.abs(nextVideo.duration - clip.frameCount / clip.fps) > 1 / clip.fps) {
        throw new Error('Video metadata does not match its annotations.');
      }
      const colors = makeColors(frames);
      const session = { clip, frames, colors, video: nextVideo, callback: null, epoch: 0, mediaTime: 0 };
      active = session;
      for (const [objectId, object] of colors) {
        const item = document.createElement('li');
        const swatch = document.createElement('span');
        swatch.className = 'wvos-demo__swatch';
        swatch.style.backgroundColor = object.color;
        swatch.setAttribute('aria-hidden', 'true');
        item.append(swatch, document.createTextNode(`${object.label} · ID ${objectId}`));
        legend.append(item);
      }
      timeline.max = String(clip.frameCount / clip.fps);
      drawFrame(session, nextVideo.currentTime);
      enableControls(true);
      setStatus(`${clip.title} ready. Supplied WVOS annotations, 24 FPS preview.`);
      nextVideo.addEventListener('play', () => {
        if (active !== session) return;
        play.textContent = 'Pause';
        scheduleFrames(session);
      }, { signal });
      nextVideo.addEventListener('pause', () => {
        if (active !== session) return;
        stopFrames(session);
        play.textContent = 'Play';
        if (!nextVideo.seeking) drawFrame(session, nextVideo.currentTime);
      }, { signal });
      nextVideo.addEventListener('seeking', () => stopFrames(session), { signal });
      nextVideo.addEventListener('seeked', () => {
        if (active !== session || nextVideo.seeking) return;
        drawFrame(session, nextVideo.currentTime);
        scheduleFrames(session);
      }, { signal });
      nextVideo.addEventListener('loadeddata', () => {
        if (active === session && !nextVideo.seeking) drawFrame(session, nextVideo.currentTime);
      }, { signal });
      nextVideo.addEventListener('error', () => fail('Could not decode the video.', token), { signal });
    } catch (error) {
      if (error.name !== 'AbortError') fail(error.message || 'Could not load this sequence.', token);
    }
  }

  async function initialize() {
    if (initialized) return;
    initialized = true;
    retry.hidden = true;
    setStatus('Loading WVOS sequences…');
    try {
      clips = validateManifest(await fetchJson(root.dataset.manifest));
      select.replaceChildren(...clips.map((clip) => {
        const option = document.createElement('option');
        option.value = clip.id;
        option.textContent = clip.title;
        return option;
      }));
      select.disabled = false;
      await selectClip(clips[0].id);
    } catch (error) {
      initialized = false;
      fail(error.message || 'Could not load the clip list.', generation);
    }
  }

  select.addEventListener('change', () => selectClip(select.value));
  retry.addEventListener('click', () => clips.length ? selectClip(select.value) : initialize());
  play.addEventListener('click', async () => {
    if (!active) return;
    const session = active;
    if (!video.paused) video.pause();
    else {
      try { await video.play(); }
      catch (error) {
        if (active === session && error.name !== 'AbortError') fail('Playback could not start.', generation);
      }
    }
  });
  view.addEventListener('click', () => setDisplay({ kind: display.kind === 'annotation' ? 'rgb' : 'annotation' }));
  timeline.addEventListener('input', () => {
    if (active) video.currentTime = Math.min(Number(timeline.value), (active.clip.frameCount - 0.5) / active.clip.fps);
  });
  function updatePointer(event) {
    const bounds = viewer.getBoundingClientRect();
    setDisplay({ kind: 'split', fraction: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) });
  }
  handle.addEventListener('pointerdown', (event) => {
    if (!active || !event.isPrimary || event.button !== 0 || pointerId !== null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    handle.focus();
    handle.setPointerCapture(pointerId);
    updatePointer(event);
  });
  handle.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) updatePointer(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    handle.addEventListener(name, (event) => { if (event.pointerId === pointerId) finishDrag(); });
  }
  handle.addEventListener('keydown', (event) => {
    if (!active || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const fraction = event.key === 'Home' ? 0 : event.key === 'End' ? 1
      : revealFraction() + (event.key === 'ArrowLeft' ? -0.05 : 0.05);
    setDisplay({ kind: 'split', fraction: Math.min(1, Math.max(0, fraction)) });
  });
  const repaint = () => { if (active && !video.seeking) drawFrame(active, active.mediaTime); };
  if ('ResizeObserver' in window) new ResizeObserver(repaint).observe(viewer);
  else window.addEventListener('resize', repaint);
  setDisplay(display);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      initialize();
    }, { rootMargin: '300px' });
    observer.observe(root);
  } else initialize();
})();
