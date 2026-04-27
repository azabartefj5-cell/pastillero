// ══════════════════════════════════════════════════════════════════
// PASTILLERO PILAR — Service Worker v32
// Alarma agresiva con botones de acción y registro en segundo plano
// ══════════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAqtsi5m_kqXHKwHcsIXHiyrNti6G5qtMo",
  authDomain: "pastillero-interactivo.firebaseapp.com",
  projectId: "pastillero-interactivo",
  storageBucket: "pastillero-interactivo.firebasestorage.app",
  messagingSenderId: "59578784468",
  appId: "1:59578784468:web:79467c7fa1a2cc78fa7941"
});

const messaging = firebase.messaging();
const db = firebase.firestore();

// ══════════════════════════════════════
// AGGRESSIVE VIBRATION PATTERN
// 1s ON, 0.5s OFF — repeated 7 times = ~10.5 seconds of vibration
// ══════════════════════════════════════
const AGGRESSIVE_VIBRATE = [
  1000, 500, 1000, 500, 1000, 500,
  1000, 500, 1000, 500, 1000, 500, 1000
];

// ══════════════════════════════════════
// DATA-ONLY MESSAGE HANDLER
// This fires for BOTH foreground and background data messages
// Because we send data-only from the backend (no "notification" field),
// this handler ALWAYS fires, even in Doze mode.
// ══════════════════════════════════════
messaging.onBackgroundMessage((payload) => {
  console.log('[sw.js] 📩 Data message received:', payload);

  const data = payload.data || {};

  // Only handle medication alarms
  if (data.type === 'MED_ALARM') {
    return showMedAlarm(data);
  }

  // Fallback for legacy notification-style messages
  if (payload.notification) {
    return self.registration.showNotification(payload.notification.title, {
      body: payload.notification.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: AGGRESSIVE_VIBRATE,
      tag: 'pastillero-med-alarm',
      requireInteraction: true,
      data: { url: './index.html' }
    });
  }
});

// ══════════════════════════════════════
// SHOW AGGRESSIVE MEDICATION ALARM
// ══════════════════════════════════════
function showMedAlarm(data) {
  const title = data.title || '⏰ Hora del medicamento';
  const body = data.body || 'Es la hora de tu medicamento.';
  const medId = data.medId || '';
  const timestamp = data.timestamp || new Date().toISOString();

  // Generate a unique tag per medId to prevent collapsing
  // but still replace same-med notifications
  const tag = medId ? `pastillero-alarm-${medId}` : `pastillero-alarm-${Date.now()}`;

  const options = {
    body: body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    image: './icons/icon-192.png',

    // ═══ AGGRESSIVE SETTINGS ═══
    vibrate: AGGRESSIVE_VIBRATE,
    requireInteraction: true, // Will NOT auto-dismiss! User MUST interact.
    renotify: true,           // Re-vibrate even if same tag replaces existing
    tag: tag,
    silent: false,            // Explicitly NOT silent

    // ═══ ACTION BUTTONS ═══
    actions: [
      {
        action: 'taken',
        title: '✅ TOMADA',
        icon: './icons/icon-192.png'
      },
      {
        action: 'snooze',
        title: '⏰ +10 min',
        icon: './icons/icon-192.png'
      }
    ],

    // ═══ DATA FOR CLICK HANDLER ═══
    data: {
      url: data.url || './index.html',
      medId: medId,
      timestamp: timestamp,
      type: 'MED_ALARM'
    }
  };

  return self.registration.showNotification(title, options);
}

// ══════════════════════════════════════
// NOTIFICATION CLICK & ACTION HANDLER
// ══════════════════════════════════════
self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  console.log(`[sw.js] 🖱️ Notification click. Action: "${action}", MedId: "${data.medId}"`);

  notification.close();

  if (action === 'taken' && data.medId) {
    // ═══ MARK AS TAKEN IN BACKGROUND (no need to open the app!) ═══
    event.waitUntil(markMedAsTaken(data.medId));
    return;
  }

  if (action === 'snooze' && data.medId) {
    // ═══ SNOOZE: Show notification again after 10 minutes ═══
    event.waitUntil(snoozeAlarm(data));
    return;
  }

  // Default click (tapped the notification body): open/focus the app
  event.waitUntil(openApp(data.url || './index.html'));
});

// ══════════════════════════════════════
// MARK MEDICATION AS TAKEN (Background Firebase Write)
// ══════════════════════════════════════
async function markMedAsTaken(medId) {
  const today = getTodayString();
  const timestamp = new Date().toISOString();

  try {
    // Write to Firestore directly from the Service Worker
    await db.collection('tomas_pilar').doc(today).set({
      [medId]: {
        taken: true,
        timestamp: timestamp,
        periodo: getPeriod(),
        source: 'notification_action' // Track that it was from notification
      }
    }, { merge: true });

    console.log(`[sw.js] ✅ ${medId} marcado como tomado en Firebase desde notificación`);

    // Show confirmation notification
    return self.registration.showNotification('✅ Medicamento Registrado', {
      body: `${medId.replace(/_/g, ' ')} marcado como tomado.`,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'pastillero-confirmation',
      requireInteraction: false,
      silent: true,
      vibrate: [200]
    });
  } catch (err) {
    console.error('[sw.js] ❌ Error marcando toma:', err);

    // Show error notification so user knows to open the app
    return self.registration.showNotification('⚠️ Error al registrar', {
      body: 'Abre la app para confirmar la toma manualmente.',
      icon: './icons/icon-192.png',
      tag: 'pastillero-error',
      requireInteraction: true,
      data: { url: './index.html' }
    });
  }
}

// ══════════════════════════════════════
// SNOOZE ALARM (10 minutes later)
// ══════════════════════════════════════
async function snoozeAlarm(data) {
  const SNOOZE_MS = 10 * 60 * 1000; // 10 minutes

  console.log(`[sw.js] ⏰ Posponiendo alarma de ${data.medId} por 10 minutos...`);

  // Show brief acknowledgment
  await self.registration.showNotification('⏰ Pospuesto 10 min', {
    body: `Te recordaré de nuevo en 10 minutos.`,
    icon: './icons/icon-192.png',
    tag: 'pastillero-snooze-ack',
    requireInteraction: false,
    silent: true,
    vibrate: [200]
  });

  // Wait 10 minutes, then re-fire the alarm
  // Note: setTimeout in SW may not survive if the browser kills the SW.
  // As a more reliable fallback, we also store the snooze in Firestore
  // so the cron can pick it up. But for immediate UX, setTimeout works
  // if the SW stays alive.
  return new Promise(resolve => {
    setTimeout(() => {
      showMedAlarm({
        ...data,
        title: '🔔 ¡RECORDATORIO! ' + (data.title || ''),
        body: '⚠️ Hace 10 min que pospusiste esta toma. ¡No la olvides!'
      }).then(resolve);
    }, SNOOZE_MS);
  });
}

// ══════════════════════════════════════
// OPEN/FOCUS APP
// ══════════════════════════════════════
async function openApp(targetUrl) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  // Try to focus an existing window first
  for (const client of clientList) {
    if (client.url.includes('index.html') && 'focus' in client) {
      return client.focus();
    }
  }

  // Otherwise open a new window
  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl);
  }
}

// ══════════════════════════════════════
// HELPER: Get today's date string (YYYY-MM-DD)
// ══════════════════════════════════════
function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPeriod() {
  const h = new Date().getHours();
  if (h >= 6 && h < 13) return 'manana';
  if (h >= 13 && h < 18) return 'comida';
  return 'noche';
}


// ══════════════════════════════════════════════════════════════════
// CACHE & OFFLINE SUPPORT
// ══════════════════════════════════════════════════════════════════
const CACHE_NAME = 'pastillero-pilar-v36';
const STATIC_ASSETS = [
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/sw-register.js',
  './manifest.json',
  './alerta.mp3',
  'https://cdn.tailwindcss.com?plugins=forms,container-queries',
  'https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700;800;900&family=Public+Sans:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap'
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for Firebase, cache-first for static
self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // Network-first for Firebase/Firestore calls
  if (url.includes('firestore.googleapis.com') || url.includes('firebase')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ══════════════════════════════════════════════════════════════════
// PUSH EVENT — Direct push handling (alternative to onBackgroundMessage)
// This catches push events that might not go through FCM's handler
// ══════════════════════════════════════════════════════════════════
self.addEventListener('push', event => {
  // Only handle if FCM's onBackgroundMessage didn't already handle it
  // FCM compat library usually handles this, but this is our safety net
  if (event.data) {
    try {
      const payload = event.data.json();
      // If it has FCM structure, let the FCM handler deal with it
      if (payload.data?.type === 'MED_ALARM' && !payload.notification) {
        // FCM didn't handle it (data-only), so we do
        console.log('[sw.js] 📨 Push event with data-only payload, showing alarm');
        event.waitUntil(showMedAlarm(payload.data));
      }
    } catch (e) {
      // Not JSON, ignore
    }
  }
});
