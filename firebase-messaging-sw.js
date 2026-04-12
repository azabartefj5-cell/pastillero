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

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Mensaje en segundo plano: ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png'
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
