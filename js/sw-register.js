// ══════════════════════════════════════
// Service Worker Registration
// Registra sw.js como el Service Worker principal
// ══════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: '/' })
    .then(registration => {
      console.log('✅ Service Worker registrado:', registration.scope);
    })
    .catch(e => console.log('SW not registered:', e));
}
