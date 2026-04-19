// ══════════════════════════════════════════════════════════════════
// PASTILLERO PILAR — Firebase Messaging Service Worker (Legacy Bridge)
// ══════════════════════════════════════════════════════════════════
// Este archivo existe porque Firebase SDK busca "firebase-messaging-sw.js"
// por defecto si no se configura uno personalizado.
//
// IMPORTANTE: La app registra sw.js como Service Worker principal y le dice
// a Firebase Messaging que use ese mismo SW (ver sw-register.js).
// Este archivo es un fallback por si el navegador lo busca directamente.
// ══════════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAqtsi5m_kqXHKwHcsIXHiyrNti6G5qtMo",
  authDomain: "pastillero-interactivo.firebaseapp.com",
  projectId: "pastillero-interactivo",
  storageBucket: "pastillero-interactivo.firebasestorage.app",
  messagingSenderId: "59578784468",
  appId: "1:59578784468:web:79467c7fa1a2cc78fa7941"
});

const messaging = firebase.messaging();

// Aggressive alarm pattern
const VIBRATE = [1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000];

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message:', payload);

  const data = payload.data || {};
  const title = data.title || payload.notification?.title || '⏰ Medicamento';
  const body = data.body || payload.notification?.body || 'Es la hora de tu medicamento.';

  return self.registration.showNotification(title, {
    body: body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: VIBRATE,
    requireInteraction: true,
    renotify: true,
    tag: data.medId ? `pastillero-alarm-${data.medId}` : 'pastillero-med-alarm',
    actions: [
      { action: 'taken', title: '✅ TOMADA' },
      { action: 'snooze', title: '⏰ +10 min' }
    ],
    data: {
      url: data.url || './index.html',
      medId: data.medId || '',
      type: 'MED_ALARM'
    }
  });
});
