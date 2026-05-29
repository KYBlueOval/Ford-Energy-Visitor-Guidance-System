const APPS_SCRIPT_API =
  'https://script.google.com/macros/s/AKfycbwFqUXdz1oGXLOPOmvd8A_JD6Msluakmt5j2-z4Jyt_9rpu8bfJchpjbKKnLxUm_edD/exec?action=data';

const APPS_SCRIPT_LOG =
  'https://script.google.com/macros/s/AKfycbwFqUXdz1oGXLOPOmvd8A_JD6Msluakmt5j2-z4Jyt_9rpu8bfJchpjbKKnLxUm_edD/exec?action=log';

let appData = null;
let selectedRoute = null;
let selectedSteps = [];
let currentStep = 0;
let currentPosition = null;
let currentHeading = null;
let watchId = null;
let cameraStream = null;
let voiceEnabled = true;
let hasFinishedRoute = false;
let sessionId = createSessionId();
let lastZone = '';
let lastSpokenStep = -1;

const el = id => document.getElementById(id);
const setText = (id, value) => { const node = el(id); if (node) node.textContent = value; };
const show = id => { const node = el(id); if (node) node.classList.remove('hidden'); };
const hide = id => { const node = el(id); if (node) node.classList.add('hidden'); };

document.addEventListener('DOMContentLoaded', () => {
  bind('routeSelect', 'change', handleRouteChange);
  bind('startBtn', 'click', startGuidance);
  bind('gpsBtn', 'click', requestGpsOnce);
  bind('nextBtn', 'click', nextStep);
  bind('backBtn', 'click', previousStep);
  bind('stopCameraBtn', 'click', stopCamera);
  bind('securityPhone', 'click', launchSecurityCall);
  bind('voiceBtn', 'click', toggleVoice);
  bind('replayBtn', 'click', replayDirection);
  bind('exitArBtn', 'click', exitArMode);

  window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  window.addEventListener('deviceorientation', handleOrientation, true);

  loadData();
});

function bind(id, eventName, handler) {
  const node = el(id);
  if (node) node.addEventListener(eventName, handler);
}

function loadData() {
  const callbackName = 'jsonpCallback_' + Date.now();

  window[callbackName] = data => {
    appData = data || { settings: {}, routes: [], steps: [] };
    initApp();
    delete window[callbackName];
    const s = document.getElementById(callbackName);
    if (s) s.remove();
  };

  const script = document.createElement('script');
  script.id = callbackName;
  script.src = `${APPS_SCRIPT_API}&callback=${callbackName}`;
  script.onerror = () => alert('Could not load route data from Apps Script.');
  document.body.appendChild(script);
}

function initApp() {
  const s = appData.settings || {};

  setText('appTitle', s.APP_TITLE || 'Site Navigation');
  setText('emergencyText', s.EMERGENCY_TEXT || 'For emergencies, call 911. For site assistance, contact Security.');

  voiceEnabled = String(s.ENABLE_VOICE_GUIDANCE || 'TRUE').toUpperCase() !== 'FALSE';
  setText('voiceBtn', voiceEnabled ? 'Voice: On' : 'Voice: Off');

  setImage('logo', s.LOGO_URL);
  setImage('bwrdoLogo', s.BWRDO_LOGO_URL);

  const displayPhone = s.SECURITY_PHONE || '';
  const cleanPhone = cleanPhoneNumber(displayPhone);
  const phoneBtn = el('securityPhone');

  if (phoneBtn) {
    phoneBtn.setAttribute('data-phone', cleanPhone);
    phoneBtn.href = cleanPhone ? `tel:${cleanPhone}` : '#';
    phoneBtn.textContent = displayPhone ? `Call Security: ${displayPhone}` : 'Call Security';
  }

  buildRouteSelector();

  const urlRoute = new URLSearchParams(window.location.search).get('route');
  const defaultRoute = urlRoute || s.DEFAULT_ROUTE_ID || '';

  if (defaultRoute && el('routeSelect')) {
    el('routeSelect').value = defaultRoute;
    loadRoute(defaultRoute);
  }
}

function buildRouteSelector() {
  const select = el('routeSelect');
  if (!select) return;

  select.innerHTML = '';

  if (!appData.routes || !appData.routes.length) {
    select.innerHTML = '<option value="">No routes found</option>';
    return;
  }

  appData.routes.forEach(route => {
    const opt = document.createElement('option');
    opt.value = route.RouteID;
    opt.textContent = route.RouteName || route.DestinationName || route.RouteID;
    select.appendChild(opt);
  });
}

function handleRouteChange() {
  loadRoute(el('routeSelect').value);
}

function loadRoute(routeId) {
  selectedRoute = (appData.routes || []).find(r => r.RouteID === routeId);

  selectedSteps = (appData.steps || [])
    .filter(step => step.RouteID === routeId)
    .sort((a, b) => Number(a.StepOrder) - Number(b.StepOrder));

  currentStep = 0;
  hasFinishedRoute = false;
  lastZone = '';
  lastSpokenStep = -1;

  if (!selectedRoute || !selectedSteps.length) {
    setText('guidanceText', 'Route steps not found');
    setText('guidanceSubtext', 'Check the Routes and Route_Steps tabs.');
    setText('routeStatus', 'Route Missing');
    return;
  }

  renderStep(false);
}

async function startGuidance() {
  if (!selectedSteps.length) {
    alert('Please select a route first.');
    return;
  }

  document.body.classList.add('ar-active');

  const panel = el('livePanel');
  if (panel) {
    panel.classList.remove('hidden');
    panel.classList.add('fullscreen');
  }

  currentStep = 0;
  hasFinishedRoute = false;
  lastZone = '';
  lastSpokenStep = -1;

  logEvent('ROUTE_START', 'Route guidance started');

  renderStep(true);
  startGpsWatch();
  await startCamera();

  if (panel && panel.requestFullscreen) {
    panel.requestFullscreen().catch(() => {});
  }
}

function exitArMode() {
  stopCamera();

  document.body.classList.remove('ar-active');

  const panel = el('livePanel');
  if (panel) panel.classList.remove('fullscreen');

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      logEvent('CAMERA_ERROR', 'Live camera not supported');
      alert('Live camera is not supported in this browser. Use Chrome on Android or Safari on iPhone.');
      return;
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    const video = el('cameraVideo');
    if (video) {
      video.srcObject = cameraStream;
      await video.play();
    }

    logEvent('CAMERA_OPEN', 'Camera opened');

  } catch (err) {
    logEvent('CAMERA_ERROR', err.message || 'Camera failed');
    alert('Camera could not open. Allow camera permission and use Chrome on Android or Safari on iPhone.');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const video = el('cameraVideo');
  if (video) video.srcObject = null;
}

function renderStep(shouldSpeak = true) {
  if (!selectedSteps.length) return;

  const step = selectedSteps[currentStep];

  setText('hudStep', `${currentStep + 1}/${selectedSteps.length}`);
  setText('guidanceText', step.StepName || '');
  setText('guidanceSubtext', step.Instruction || '');

  if (step.ImageURL) setImage('stepImage', step.ImageURL);
  else {
    const img = el('stepImage');
    if (img) img.style.display = 'none';
  }

  renderStepDots();
  updateGuidanceText(shouldSpeak);
  updateLiveGuidance();
}

function updateGuidanceText(shouldSpeak = true) {
  const step = selectedSteps[currentStep];
  const directionType = getDirectionType(step.DirectionArrow || step.Instruction || '');

  setText('turnBadge', getTurnBadge(directionType));

  const arrow = el('directionArrow');

  if (directionType === 'arrive') {
    setText('bigArrow', '✓');
    if (arrow) arrow.classList.add('arrive');
  } else {
    setText('bigArrow', '↑');
    if (arrow) arrow.classList.remove('arrive');
  }

  updateBearingArrow();

  if (shouldSpeak && lastSpokenStep !== currentStep) {
    lastSpokenStep = currentStep;
    speakDirection(step.VoicePrompt || step.Instruction || step.StepName);
  }
}

function updateBearingArrow() {
  if (!selectedSteps.length || !currentPosition) return;

  const step = selectedSteps[currentStep];
  if (!step.Latitude || !step.Longitude) return;

  const bearing = getBearingDegrees(
    currentPosition.lat,
    currentPosition.lng,
    Number(step.Latitude),
    Number(step.Longitude)
  );

  let rotation = bearing;

  if (currentHeading !== null && !isNaN(currentHeading)) {
    rotation = normalizeDegrees(bearing - currentHeading);
  }

  const arrow = el('directionArrow');
  const big = el('bigArrow');

  if (arrow) arrow.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
  if (big) big.style.transform = `rotate(${-rotation}deg)`;

  updateWrongWayWarning(rotation);
}

function updateWrongWayWarning(rotation) {
  const badge = el('turnBadge');
  if (!badge) return;

  const offCourse = rotation > 120 && rotation < 240;

  if (offCourse) {
    badge.textContent = 'TURN AROUND / CHECK DIRECTION';
    badge.style.background = 'linear-gradient(135deg, #ff6b6b, #ff1f1f)';
    badge.style.color = 'white';
  } else {
    badge.style.background = '';
    badge.style.color = '';
  }
}

function updateApproachZone(distanceFt) {
  let zone = 'far';

  if (distanceFt <= 50) zone = 'arrival';
  else if (distanceFt <= 150) zone = 'final';
  else if (distanceFt <= 300) zone = 'approach';

  if (zone === lastZone) return;

  lastZone = zone;

  if (zone === 'approach') {
    speakDirection('Approaching next waypoint.');
    vibrate([80]);
  }

  if (zone === 'final') {
    speakDirection('Prepare for the next instruction.');
    vibrate([80, 60, 80]);
  }

  if (zone === 'arrival') {
    vibrate([120, 70, 120]);
  }
}

function getDirectionType(direction) {
  const d = String(direction || '').toLowerCase();

  if (d.includes('left')) return 'left';
  if (d.includes('right')) return 'right';
  if (d.includes('arrive')) return 'arrive';
  if (d.includes('stop')) return 'arrive';

  return 'straight';
}

function getTurnBadge(type) {
  if (type === 'left') return 'BEARING TO LEFT WAYPOINT';
  if (type === 'right') return 'BEARING TO RIGHT WAYPOINT';
  if (type === 'arrive') return 'ARRIVAL POINT';
  return 'BEARING TO NEXT WAYPOINT';
}

function renderStepDots() {
  const holder = el('stepDots');
  if (!holder) return;

  holder.innerHTML = '';

  selectedSteps.forEach((_, index) => {
    const dot = document.createElement('span');
    dot.className = 'step-dot';

    if (index < currentStep) dot.classList.add('complete');
    if (index === currentStep) dot.classList.add('active');

    holder.appendChild(dot);
  });
}

function speakDirection(text) {
  if (!voiceEnabled || !text) return;
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();

  const msg = new SpeechSynthesisUtterance(text);
  msg.rate = 0.92;
  msg.pitch = 1;
  msg.volume = 1;

  window.speechSynthesis.speak(msg);
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  setText('voiceBtn', voiceEnabled ? 'Voice: On' : 'Voice: Off');
}

function replayDirection() {
  if (!selectedSteps.length) return;

  const step = selectedSteps[currentStep];
  speakDirection(step.VoicePrompt || step.Instruction || step.StepName);
}

function startGpsWatch() {
  if (!navigator.geolocation) {
    setText('hudGps', 'No GPS');
    logEvent('GPS_ERROR', 'GPS not supported');
    return;
  }

  setText('hudGps', 'Requesting');

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      setText('hudGps', `±${Math.round(pos.coords.accuracy)}m`);
      updateLiveGuidance();
      updateBearingArrow();
    },
    () => {
      setText('hudGps', 'Denied');
      logEvent('GPS_ERROR', 'GPS denied or unavailable');
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1500,
      timeout: 12000
    }
  );
}

function requestGpsOnce() {
  if (!navigator.geolocation) {
    setText('hudGps', 'No GPS');
    logEvent('GPS_ERROR', 'GPS not supported');
    return;
  }

  setText('hudGps', 'Updating');

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      setText('hudGps', `±${Math.round(pos.coords.accuracy)}m`);
      updateLiveGuidance();
      updateBearingArrow();
    },
    () => {
      setText('hudGps', 'Failed');
      logEvent('GPS_ERROR', 'Manual GPS update failed');
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000
    }
  );
}

function updateLiveGuidance() {
  if (!selectedSteps.length || hasFinishedRoute) return;

  const step = selectedSteps[currentStep];
  const nextStepObj = selectedSteps[currentStep + 1];

  if (!currentPosition || !step.Latitude || !step.Longitude) {
    setText('distanceRemaining', 'Distance: --');
    setText('routeStatus', currentPosition ? 'Waypoint Missing' : 'Waiting for GPS');
    return;
  }

  const currentDistance = getDistanceFeet(
    currentPosition.lat,
    currentPosition.lng,
    Number(step.Latitude),
    Number(step.Longitude)
  );

  setText('distanceRemaining', `${Math.round(currentDistance)} ft`);
  setText('routeStatus', 'En Route');

  updateApproachZone(currentDistance);

  const radius = Number(step.ArrivalRadiusFt || 100);

  if (currentDistance <= radius) {
    logEvent('STEP_ARRIVAL', `Reached ${step.StepName || 'step'}`);
    advanceOrFinish();
    return;
  }

  if (nextStepObj && nextStepObj.Latitude && nextStepObj.Longitude) {
    const nextDistance = getDistanceFeet(
      currentPosition.lat,
      currentPosition.lng,
      Number(nextStepObj.Latitude),
      Number(nextStepObj.Longitude)
    );

    if (nextDistance + 75 < currentDistance) {
      currentStep++;
      lastZone = '';
      logEvent('STEP_ADVANCE', 'Auto advanced to next waypoint');
      renderStep(true);
    }
  }
}

function advanceOrFinish() {
  if (currentStep < selectedSteps.length - 1) {
    currentStep++;
    lastZone = '';
    renderStep(true);
  } else {
    finishRoute();
  }
}

function finishRoute() {
  hasFinishedRoute = true;

  setText('routeStatus', 'Arrived');
  setText('guidanceText', 'You have arrived');
  setText('guidanceSubtext', 'Park and report to the appropriate security entrance.');
  setText('bigArrow', '✓');
  setText('distanceRemaining', 'Route complete');
  setText('turnBadge', 'ARRIVED');

  const arrow = el('directionArrow');
  if (arrow) arrow.classList.add('arrive');

  renderStepDots();
  vibrate([180, 80, 180, 80, 180]);
  speakDirection('You have arrived. Park and report to the appropriate security entrance.');
  logEvent('ROUTE_COMPLETE', 'Route completed');
}

function nextStep() {
  if (currentStep < selectedSteps.length - 1) {
    currentStep++;
    hasFinishedRoute = false;
    lastZone = '';
    logEvent('STEP_ADVANCE', 'Manual next step');
    renderStep(true);
  } else {
    finishRoute();
  }
}

function previousStep() {
  if (currentStep > 0) {
    currentStep--;
    hasFinishedRoute = false;
    lastZone = '';
    logEvent('STEP_ADVANCE', 'Manual previous step');
    renderStep(true);
  }
}

function handleOrientation(event) {
  let heading = null;

  if (event.webkitCompassHeading) heading = event.webkitCompassHeading;
  else if (typeof event.alpha === 'number') heading = 360 - event.alpha;

  if (heading !== null && !isNaN(heading)) {
    currentHeading = normalizeDegrees(heading);
    setText('headingValue', `${Math.round(currentHeading)}°`);
    updateBearingArrow();
  }
}

function launchSecurityCall(e) {
  e.preventDefault();

  const phone = el('securityPhone') ? el('securityPhone').getAttribute('data-phone') : '';

  if (!phone) {
    alert('Security phone number is not configured.');
    return;
  }

  logEvent('HELP_CALL', 'Security phone button selected');
  window.location.href = `tel:${phone}`;
}

function getBearingDegrees(lat1, lng1, lat2, lng2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const delta = toRad(lng2 - lng1);

  const y = Math.sin(delta) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(delta);

  return normalizeDegrees(Math.atan2(y, x) * 180 / Math.PI);
}

function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
}

function vibrate(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function logEvent(eventType, notes) {
  const routeId = selectedRoute ? selectedRoute.RouteID : '';
  const routeName = selectedRoute ? (selectedRoute.RouteName || selectedRoute.DestinationName || routeId) : '';
  const step = selectedSteps[currentStep] || {};
  const callbackName = 'logCallback_' + Date.now() + Math.random().toString(36).slice(2);

  const params = new URLSearchParams({
    callback: callbackName,
    sessionId,
    eventType,
    routeId,
    routeName,
    stepOrder: step.StepOrder || '',
    lat: currentPosition ? currentPosition.lat : '',
    lng: currentPosition ? currentPosition.lng : '',
    accuracyFt: currentPosition ? Math.round(currentPosition.accuracy * 3.28084) : '',
    deviceInfo: navigator.userAgent,
    notes: notes || ''
  });

  window[callbackName] = () => {
    delete window[callbackName];
    const node = document.getElementById(callbackName);
    if (node) node.remove();
  };

  const script = document.createElement('script');
  script.id = callbackName;
  script.src = `${APPS_SCRIPT_LOG}&${params.toString()}`;
  script.onerror = () => {};
  document.body.appendChild(script);
}

function createSessionId() {
  return 'FE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function cleanPhoneNumber(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function getDistanceFeet(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 3.28084;
}

function toRad(value) {
  return value * Math.PI / 180;
}

function setImage(id, src) {
  const image = el(id);
  if (!image) return;

  if (!src) {
    image.style.display = 'none';
    return;
  }

  image.src = src;
  image.style.display = 'block';

  image.onerror = () => {
    image.style.display = 'none';
  };
}
