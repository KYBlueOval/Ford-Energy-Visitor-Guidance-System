const APPS_SCRIPT_API =
  'https://script.google.com/macros/s/AKfycbwFqUXdz1oGXLOPOmvd8A_JD6Msluakmt5j2-z4Jyt_9rpu8bfJchpjbKKnLxUm_edD/exec?action=data';

let appData = null;
let selectedRoute = null;
let selectedSteps = [];
let currentStep = 0;
let currentPosition = null;
let watchId = null;
let cameraStream = null;
let voiceEnabled = true;
let hasFinishedRoute = false;

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

  setImage('logo', s.LOGO_URL);
  setImage('bwrdoLogo', s.BWRDO_LOGO_URL);

  const displayPhone = s.SECURITY_PHONE || '';
  const cleanPhone = cleanPhoneNumber(displayPhone);

  el('securityPhone').setAttribute('data-phone', cleanPhone);
  el('securityPhone').href = cleanPhone ? `tel:${cleanPhone}` : '#';
  el('securityPhone').textContent = displayPhone ? `Call Security: ${displayPhone}` : 'Call Security';

  buildRouteSelector();

  const defaultRoute = s.DEFAULT_ROUTE_ID || '';
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

  el('livePanel').classList.remove('hidden');

  currentStep = 0;
  hasFinishedRoute = false;

  renderStep(true);
  startGpsWatch();
  await startCamera();

  el('livePanel').scrollIntoView({ behavior: 'smooth' });
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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

  } catch (err) {
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

  el('stepCounter').textContent = `${currentStep + 1} of ${selectedSteps.length}`;
  el('stepTitle').textContent = step.StepName || '';
  el('stepInstruction').textContent = step.Instruction || '';

  if (step.ImageURL) {
    setImage('stepImage', step.ImageURL);
  } else {
    el('stepImage').style.display = 'none';
  }

  updateGuidanceText(shouldSpeak);
  updateLiveGuidance();
}

function updateGuidanceText(shouldSpeak = true) {
  const step = selectedSteps[currentStep];

  const direction = step.DirectionArrow || step.Instruction || '';
  const arrow = getArrowSymbol(direction);

  el('bigArrow').textContent = arrow;
  el('guidanceText').textContent = step.StepName || 'Continue Route';
  el('guidanceSubtext').textContent = step.Instruction || 'Follow the route step.';

  if (shouldSpeak) {
    const spokenText = step.VoicePrompt || step.Instruction || step.StepName;
    speakDirection(spokenText);
  }
}

function getArrowSymbol(direction) {
  const d = String(direction || '').toLowerCase();

  if (d.includes('left')) return '←';
  if (d.includes('right')) return '→';
  if (d.includes('arrive')) return '✓';
  if (d.includes('stop')) return '!';
  return '↑';
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

function startGpsWatch() {
  if (!navigator.geolocation) {
    el('gpsStatus').textContent = 'Not Supported';
    return;
  }

  el('gpsStatus').textContent = 'Requesting';

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }

  watchId = navigator.geolocation.watchPosition(
    pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      el('gpsStatus').textContent = `Live ±${Math.round(pos.coords.accuracy)}m`;
      updateLiveGuidance();
    },
    () => {
      el('gpsStatus').textContent = 'Denied / Unavailable';
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
    el('gpsStatus').textContent = 'Not Supported';
    return;
  }

  el('gpsStatus').textContent = 'Updating';

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      el('gpsStatus').textContent = `Updated ±${Math.round(pos.coords.accuracy)}m`;
      updateLiveGuidance();
    },
    () => {
      el('gpsStatus').textContent = 'GPS Failed';
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

  el('distanceRemaining').textContent = `Distance: ${Math.round(currentDistance)} ft`;

  const radius = Number(step.ArrivalRadiusFt || 100);

  if (currentDistance <= radius) {
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
      renderStep(true);
      return;
    }
  }

  el('routeStatus').textContent = 'En Route';
}

function advanceOrFinish() {
  if (currentStep < selectedSteps.length - 1) {
    el('routeStatus').textContent = 'Step Reached';
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
  speakDirection('You have arrived. Park and report to the appropriate security entrance.');
}

function nextStep() {
  if (currentStep < selectedSteps.length - 1) {
    currentStep++;
    renderStep(true);
  } else {
    finishRoute();
  }
}

function previousStep() {
  if (currentStep > 0) {
    currentStep--;
    hasFinishedRoute = false;
    renderStep(true);
  }
}

function handleOrientation(event) {
  let heading = null;

  if (event.webkitCompassHeading) {
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    heading = 360 - event.alpha;
  }

  if (heading !== null && !isNaN(heading)) {
    el('headingValue').textContent = `${Math.round(heading)}°`;
  }
}

function launchSecurityCall(e) {
  e.preventDefault();

  const phone = el('securityPhone').getAttribute('data-phone');

  if (!phone) {
    alert('Security phone number is not configured.');
    return;
  }

  window.location.href = `tel:${phone}`;
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
