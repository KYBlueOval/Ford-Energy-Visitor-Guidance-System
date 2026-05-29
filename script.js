const APPS_SCRIPT_API =
  'https://script.google.com/macros/s/AKfycbwFqUXdz1oGXLOPOmvd8A_JD6Msluakmt5j2-z4Jyt_9rpu8bfJchpjbKKnLxUm_edD/exec?action=data';

const APPS_SCRIPT_LOG =
  'https://script.google.com/macros/s/AKfycbwFqUXdz1oGXLOPOmvd8A_JD6Msluakmt5j2-z4Jyt_9rpu8bfJchpjbKKnLxUm_edD/exec?action=log';

let appData = null;
let selectedRoute = null;
let selectedSteps = [];
let currentStep = 0;
let currentPosition = null;
let watchId = null;
let cameraStream = null;
let voiceEnabled = true;
let hasFinishedRoute = false;
let currentHeading = null;
let sessionId = createSessionId();

const el = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  loadData();

  el('routeSelect').addEventListener('change', handleRouteChange);
  el('startBtn').addEventListener('click', startGuidance);
  el('gpsBtn').addEventListener('click', requestGpsOnce);
  el('nextBtn').addEventListener('click', nextStep);
  el('backBtn').addEventListener('click', previousStep);
  el('stopCameraBtn').addEventListener('click', stopCamera);
  el('securityPhone').addEventListener('click', launchSecurityCall);
  el('voiceBtn').addEventListener('click', toggleVoice);
  el('replayBtn').addEventListener('click', replayDirection);
  el('exitArBtn').addEventListener('click', exitArMode);

  window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  window.addEventListener('deviceorientation', handleOrientation, true);
});

function loadData() {
  const callbackName = 'jsonpCallback_' + Date.now();

  window[callbackName] = data => {
    appData = data || { settings: {}, routes: [], steps: [] };
    initApp();
    delete window[callbackName];
    script.remove();
  };

  const script = document.createElement('script');
  script.src = `${APPS_SCRIPT_API}&callback=${callbackName}`;
  script.onerror = () => alert('Could not load route data from Apps Script.');
  document.body.appendChild(script);
}

function initApp() {
  const s = appData.settings || {};

  el('appTitle').textContent = s.APP_TITLE || 'Site Navigation';
  el('emergencyText').textContent = s.EMERGENCY_TEXT || 'For emergencies, call 911. For site assistance, contact Security.';

  voiceEnabled = String(s.ENABLE_VOICE_GUIDANCE || 'TRUE').toUpperCase() !== 'FALSE';
  el('voiceBtn').textContent = voiceEnabled ? 'Voice: On' : 'Voice: Off';

  setImage('logo', s.LOGO_URL);
  setImage('bwrdoLogo', s.BWRDO_LOGO_URL);

  const displayPhone = s.SECURITY_PHONE || '';
  const cleanPhone = cleanPhoneNumber(displayPhone);

  el('securityPhone').setAttribute('data-phone', cleanPhone);
  el('securityPhone').href = cleanPhone ? `tel:${cleanPhone}` : '#';
  el('securityPhone').textContent = displayPhone ? `Call Security: ${displayPhone}` : 'Call Security';

  buildRouteSelector();

  const urlRoute = new URLSearchParams(window.location.search).get('route');
  const defaultRoute = urlRoute || s.DEFAULT_ROUTE_ID || '';

  if (defaultRoute) {
    el('routeSelect').value = defaultRoute;
    loadRoute(defaultRoute);
  }
}

function buildRouteSelector() {
  const select = el('routeSelect');
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

  if (!selectedRoute || !selectedSteps.length) {
    el('guidanceText').textContent = 'Route steps not found';
    el('guidanceSubtext').textContent = 'Check the Routes and Route_Steps tabs.';
    el('routeStatus').textContent = 'Route Missing';
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
  el('livePanel').classList.remove('hidden');
  el('livePanel').classList.add('fullscreen');

  currentStep = 0;
  hasFinishedRoute = false;

  logEvent('ROUTE_START', 'Route guidance started');

  renderStep(true);
  startGpsWatch();
  await startCamera();

  if (el('livePanel').requestFullscreen) {
    el('livePanel').requestFullscreen().catch(() => {});
  }
}

function exitArMode() {
  stopCamera();

  document.body.classList.remove('ar-active');
  el('livePanel').classList.remove('fullscreen');

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

    el('cameraVideo').srcObject = cameraStream;
    await el('cameraVideo').play();

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

  el('cameraVideo').srcObject = null;
}

function renderStep(shouldSpeak = true) {
  if (!selectedSteps.length) return;

  const step = selectedSteps[currentStep];

  el('hudStep').textContent = `${currentStep + 1}/${selectedSteps.length}`;
  el('guidanceText').textContent = step.StepName || '';
  el('guidanceSubtext').textContent = step.Instruction || '';

  if (step.ImageURL) setImage('stepImage', step.ImageURL);
  else el('stepImage').style.display = 'none';

  renderStepDots();
  updateGuidanceText(shouldSpeak);
  updateLiveGuidance();
}

function updateGuidanceText(shouldSpeak = true) {
  const step = selectedSteps[currentStep];

  const direction = step.DirectionArrow || step.Instruction || '';
  const directionType = getDirectionType(direction);

  el('turnBadge').textContent = getTurnBadge(directionType);

  if (directionType === 'arrive') {
    el('bigArrow').textContent = '✓';
    el('directionArrow').classList.add('arrive');
  } else {
    el('bigArrow').textContent = '↑';
    el('directionArrow').classList.remove('arrive');
  }

  updateBearingArrow();

  if (shouldSpeak) {
    const spokenText = step.VoicePrompt || step.Instruction || step.StepName;
    speakDirection(spokenText);
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

  el('directionArrow').style.transform =
    `translate(-50%, -50%) rotate(${rotation}deg)`;

  el('bigArrow').style.transform =
    `rotate(${-rotation}deg)`;
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
  if (type === 'left') return 'TURN LEFT';
  if (type === 'right') return 'TURN RIGHT';
  if (type === 'arrive') return 'ARRIVAL POINT';
  return 'NEXT WAYPOINT';
}

function renderStepDots() {
  const holder = el('stepDots');
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
  el('voiceBtn').textContent = voiceEnabled ? 'Voice: On' : 'Voice: Off';
}

function replayDirection() {
  if (!selectedSteps.length) return;
  const step = selectedSteps[currentStep];
  speakDirection(step.VoicePrompt || step.Instruction || step.StepName);
}

function startGpsWatch() {
  if (!navigator.geolocation) {
    el('hudGps').textContent = 'No GPS';
    logEvent('GPS_ERROR', 'GPS not supported');
    return;
  }

  el('hudGps').textContent = 'Requesting';

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  watchId = navigator.geolocation.watchPosition(
    pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      el('hudGps').textContent = `±${Math.round(pos.coords.accuracy)}m`;
      updateLiveGuidance();
      updateBearingArrow();
    },
    () => {
      el('hudGps').textContent = 'Denied';
      logEvent('GPS_ERROR', 'GPS denied or unavailable');
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 12000
    }
  );
}

function requestGpsOnce() {
  if (!navigator.geolocation) {
    el('hudGps').textContent = 'No GPS';
    logEvent('GPS_ERROR', 'GPS not supported');
    return;
  }

  el('hudGps').textContent = 'Updating';

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      el('hudGps').textContent = `±${Math.round(pos.coords.accuracy)}m`;
      updateLiveGuidance();
      updateBearingArrow();
    },
    () => {
      el('hudGps').textContent = 'Failed';
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
    el('distanceRemaining').textContent = 'Distance: --';
    el('routeStatus').textContent = currentPosition ? 'Waypoint Missing' : 'Waiting for GPS';
    return;
  }

  const currentDistance = getDistanceFeet(
    currentPosition.lat,
    currentPosition.lng,
    Number(step.Latitude),
    Number(step.Longitude)
  );

  el('distanceRemaining').textContent = `${Math.round(currentDistance)} ft`;
  el('routeStatus').textContent = 'En Route';

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
      logEvent('STEP_ADVANCE', 'Auto advanced to next waypoint');
      renderStep(true);
    }
  }
}

function advanceOrFinish() {
  if (currentStep < selectedSteps.length - 1) {
    currentStep++;
    renderStep(true);
  } else {
    finishRoute();
  }
}

function finishRoute() {
  hasFinishedRoute = true;
  el('routeStatus').textContent = 'Arrived';
  el('guidanceText').textContent = 'You have arrived';
  el('guidanceSubtext').textContent = 'Park and report to the appropriate security entrance.';
  el('bigArrow').textContent = '✓';
  el('distanceRemaining').textContent = 'Route complete';
  el('turnBadge').textContent = 'ARRIVED';
  el('directionArrow').classList.add('arrive');
  renderStepDots();
  speakDirection('You have arrived. Park and report to the appropriate security entrance.');
  logEvent('ROUTE_COMPLETE', 'Route completed');
}

function nextStep() {
  if (currentStep < selectedSteps.length - 1) {
    currentStep++;
    hasFinishedRoute = false;
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
    logEvent('STEP_ADVANCE', 'Manual previous step');
    renderStep(true);
  }
}

function handleOrientation(event) {
  let heading = null;

  if (event.webkitCompassHeading) heading = event.webkitCompassHeading;
  else if (event.alpha !== null) heading = 360 - event.alpha;

  if (heading !== null && !isNaN(heading)) {
    currentHeading = normalizeDegrees(heading);
    el('headingValue').textContent = `${Math.round(currentHeading)}°`;
    updateBearingArrow();
  }
}

function launchSecurityCall(e) {
  e.preventDefault();

  const phone = el('securityPhone').getAttribute('data-phone');

  if (!phone) {
    alert('Security phone number is not configured.');
    return;
  }

  logEvent('HELP_CALL', 'Security phone button selected');
  window.location.href = `tel:${phone}`;
}

function getBearingDegrees(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return normalizeDegrees(Math.atan2(y, x) * 180 / Math.PI);
}

function normalizeDegrees(deg) {
  return ((deg % 360) + 360) % 360;
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
    script.remove();
  };

  const script = document.createElement('script');
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
