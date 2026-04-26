import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import{getFirestore,doc,setDoc,getDoc,getDocs,onSnapshot,updateDoc,increment,collection,addDoc,serverTimestamp,query,orderBy,limit,deleteField}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import{getMessaging,getToken,onMessage}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const VAPID_KEY = "BCFBreCrb3eakQLr_mdIhIZ-0Uxh6PLD45KOI9SHDRzeLadzVXgHo13w3qygI9y1fkp2TDceUredg2CMzDDoMvk";

// ══════════════════════════════════════
// FIREBASE CONFIG (HARDCODED)
// ══════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAqtsi5m_kqXHKwHcsIXHiyrNti6G5qtMo",
  authDomain: "pastillero-interactivo.firebaseapp.com",
  projectId: "pastillero-interactivo",
  storageBucket: "pastillero-interactivo.firebasestorage.app",
  messagingSenderId: "59578784468",
  appId: "1:59578784468:web:79467c7fa1a2cc78fa7941"
};

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
const APP = {
  db: null,
  firebaseReady: false,
  currentScreen: null,
  timers: { am: null, pm: null },
  timerEnds: { am: 0, pm: 0 },
  meds: {},
  sosState: { oramorphUnlock: 0, fortasecCount: 0 },
  deviceId: localStorage.getItem('pilar_device_id') || (() => {
    const id = 'dev_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('pilar_device_id', id);
    return id;
  })(),
  _connectedAt: new Date(Date.now() - 10000), // Slightly in the past to catch very recent alerts
  _alarmInterval: null,
  _audioCtx: null,
  guided: {
    active: false,
    currentStep: 0,
    steps: [],
    period: null
  }
};

// ══════════════════════════════════════
// VOICE SYNTHESIS (TTS)
// ══════════════════════════════════════
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = 0.85; // Slightly slower for elderly
  utterance.pitch = 1.0;
  
  // Choose a female voice if available (often clearer for seniors)
  const voices = window.speechSynthesis.getVoices();
  const femaleVoice = voices.find(v => v.lang.startsWith('es') && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('google-es')));
  if (femaleVoice) utterance.voice = femaleVoice;
  
  window.speechSynthesis.speak(utterance);
}
window.speak = speak;

const TODAY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const PERIOD = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 13) return 'manana';
  if (h >= 13 && h < 18) return 'comida';
  return 'noche';
};

const IS_WEEKDAY = () => { const d = new Date().getDay(); return d >= 1 && d <= 5; };

const SPANISH_DATE = () => {
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const d = new Date();
  return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]}`;
};

// ══════════════════════════════════════
// CORE: SAVE MEDICATION TOMA (defined early for event listeners)
// ══════════════════════════════════════
async function saveMedToma(medId, periodo) {
  console.log(`💾 Registrando toma: ${medId} (${periodo})`);
  const today = TODAY();
  const timestamp = new Date().toISOString();
  const key = `med_${today}_${medId}`;

  // 1. Save locally for immediate feedback
  localStorage.setItem(key, timestamp);

  // 2. Save to history
  const hist = JSON.parse(localStorage.getItem('tomas_history') || '[]');
  hist.unshift({ med: medId, periodo, timestamp, fecha: today });
  if (hist.length > 100) hist.length = 100;
  localStorage.setItem('tomas_history', JSON.stringify(hist));

  // 3. Save to Firebase
  if (APP.db) {
    const syncEl = document.getElementById('sync-indicator');
    syncEl.innerHTML = '<span class="material-symbols-outlined text-xs animate-spin">sync</span>Sync...';
    syncEl.classList.add('bg-yellow-100','text-yellow-700');
    syncEl.classList.remove('bg-green-100','text-green-700');
    try {
      await setDoc(doc(APP.db, 'tomas_pilar', today), {
        [medId]: { taken: true, timestamp, periodo }
      }, { merge: true });
      syncEl.innerHTML = '<span class="material-symbols-outlined text-xs icon-fill">cloud_done</span>Sync';
      syncEl.classList.remove('bg-yellow-100','text-yellow-700');
      syncEl.classList.add('bg-green-100','text-green-700');
      console.log('✅ Sincronizado con Firebase');
    } catch(e) {
      console.error('❌ Error de sincronización:', e);
      syncEl.innerHTML = '<span class="material-symbols-outlined text-xs">cloud_off</span>Error';
      syncEl.classList.remove('bg-yellow-100','text-yellow-700');
      syncEl.classList.add('bg-red-100','text-red-700');
    }
  }

  // 4. Update UI
  renderTomasHistory();
  return timestamp;
}

function markCardTakenUI(card, isoString) {
  if (!card) return;
  const timeStr = isoString ? new Date(isoString).toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'}) : '';
  const medId = card.dataset.med || (card.id === 'card-omeprazol-am' ? 'omeprazol_am' : card.id === 'card-omeprazol-pm' ? 'omeprazol_pm' : '');

  // Make the entire card a vivid green and update border
  card.classList.add('!bg-[#22c55e]', '!border-[#16a34a]', 'shadow-none');

  // Make all text elements white for contrast
  card.querySelectorAll('h3, h4, p, span').forEach(el => {
    el.classList.add('!text-white');
  });

  // Soften icon bubbles inside the card
  card.querySelectorAll('.rounded-full.p-3').forEach(el => {
    el.classList.add('!bg-white/20');
  });

  const btns = card.querySelectorAll('button');
  btns.forEach(btn => {
    // Layout vertical: el botón/etiqueta pasa a abajo del todo
    card.classList.remove('flex-row', 'items-center', 'justify-between');
    card.classList.add('flex-col', 'items-stretch', 'gap-4');

    // Contenedor para el botón de "Tomado" y el de borrado
    const isLarge = btn.classList.contains('btn-toma') || btn.id === 'btn-omeprazol-am' || btn.id === 'btn-omeprazol-pm';
    btn.className = 'hidden'; // Hide the original button

    let statusDiv = card.querySelector('.taken-status-container');
    if (!statusDiv) {
      statusDiv = document.createElement('div');
      statusDiv.className = 'taken-status-container flex items-center gap-2 w-full';
      card.appendChild(statusDiv);
    }

    statusDiv.innerHTML = `
      <div class="flex-1 h-${isLarge ? '16' : '14'} bg-white/25 rounded-xl flex items-center justify-center gap-2 font-headline font-bold text-white text-${isLarge ? 'lg' : 'sm'}">
        <span class="material-symbols-outlined ${isLarge ? 'text-3xl' : 'text-2xl'} icon-fill !text-white">task_alt</span>
        TOMADO A LAS ${timeStr}
      </div>
      <button onclick="event.stopPropagation(); if(confirm('¿Anular esta toma?')) deleteMedToma('${medId}', TODAY())" class="h-${isLarge ? '16' : '14'} w-${isLarge ? '16' : '14'} bg-white/10 hover:bg-white/20 rounded-xl flex items-center justify-center transition-all active:scale-90" title="Anular toma">
        <span class="material-symbols-outlined !text-white">delete</span>
      </button>
    `;

    btn.disabled = true;
  });
}

function resetCardUI(medId) {
  // Find the card and revert it to original state
  const card = document.querySelector(`[data-med="${medId}"]`) ||
               (medId === 'omeprazol_am' ? document.getElementById('card-omeprazol-am') :
                medId === 'omeprazol_pm' ? document.getElementById('card-omeprazol-pm') : null);

  if (!card) return;

  // Remove the status container if exists
  const statusDiv = card.querySelector('.taken-status-container');
  if (statusDiv) statusDiv.remove();

  // Revert classes
  card.classList.remove('!bg-[#22c55e]', '!border-[#16a34a]', 'shadow-none', 'flex-col', 'items-stretch', 'gap-4');
  card.classList.add('flex-row', 'items-center', 'justify-between');

  // Revert text color
  card.querySelectorAll('.!text-white').forEach(el => {
    el.classList.remove('!text-white');
  });

  // Revert icon bubbles
  card.querySelectorAll('.!bg-white/20').forEach(el => {
    el.classList.remove('!bg-white/20');
  });

  // Revert and enable buttons
  const btns = card.querySelectorAll('button');
  btns.forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('hidden');
    btn.style.position = '';
    btn.style.right = '';
    btn.style.top = '';
    btn.style.transform = '';

    // Restore original HTML/Classes based on ID/Role
    if (medId === 'omeprazol_am') {
      btn.className = 'w-full h-20 bg-gradient-to-b from-primary to-primary-container text-white rounded-xl font-headline font-bold text-xl flex items-center justify-center gap-3 active:scale-[0.98] transition-all shadow-lg';
      btn.innerHTML = '<span class="material-symbols-outlined text-3xl">check_circle</span>CONFIRMAR TOMA';
      card.classList.remove('hidden');
      document.getElementById('timer-omeprazol-am').classList.add('hidden');
    } else if (medId === 'omeprazol_pm') {
      btn.className = 'w-full h-20 bg-gradient-to-b from-primary to-primary-container text-white rounded-xl font-headline font-bold text-lg flex items-center justify-center gap-3 active:scale-95 transition-all shadow-lg';
      btn.innerHTML = '<span class="material-symbols-outlined text-3xl">check_circle</span>Tomar Omeprazol (Cena)';
      card.classList.remove('hidden');
      document.getElementById('timer-omeprazol-pm').classList.add('hidden');
    } else if (btn.classList.contains('btn-toma')) {
      const isMerienda = medId.includes('merienda');
      btn.className = `btn-toma w-full h-20 bg-gradient-to-b from-${isMerienda ? 'tertiary' : 'secondary'} to-${isMerienda ? 'tertiary-container' : 'secondary-fixed-dim'} text-white rounded-xl font-headline font-bold text-xl flex items-center justify-center gap-3 active:scale-[0.98] transition-all shadow-lg`;
      btn.innerHTML = '<span class="material-symbols-outlined text-3xl">check_circle</span>REGISTRAR TOMA';
    } else if (btn.classList.contains('btn-med-am') || btn.classList.contains('btn-med-pm')) {
      btn.className = btn.classList.contains('btn-med-am') ? 'btn-med-am h-16 w-16 bg-surface-variant rounded-full flex items-center justify-center active:scale-90 transition-all flex-shrink-0' : 'btn-med-pm h-16 w-16 bg-surface-variant rounded-full flex items-center justify-center active:scale-90 transition-all flex-shrink-0';
      btn.innerHTML = '<span class="material-symbols-outlined text-3xl">check</span>';
    }
  });

  // Re-apply Trangorex rule if needed
  if (medId === 'trangorex_am') applyTrangorexRule();
}

async function deleteMedToma(medId, fecha) {
  // 1. Remove from localStorage
  const medKey = `med_${fecha}_${medId}`;
  localStorage.removeItem(medKey);

  // 2. Remove from tomas_history in localStorage
  const hist = JSON.parse(localStorage.getItem('tomas_history') || '[]');
  const newHist = hist.filter(h => !(h.med === medId && h.fecha === fecha));
  localStorage.setItem('tomas_history', JSON.stringify(newHist));

  // 3. Remove from Firebase
  if (APP.db) {
    try {
      const docRef = doc(APP.db, 'tomas_pilar', fecha);
      await updateDoc(docRef, {
        [medId]: deleteField()
      });
      console.log(`✅ ${medId} eliminado de Firebase para el ${fecha}`);
    } catch(e) {
      console.warn('Error eliminando toma de Firebase:', e);
    }
  }

  // 4. Special cases: Omeprazol timers
  if (medId === 'omeprazol_am' || medId === 'omeprazol_pm') {
    const suffix = medId === 'omeprazol_am' ? 'am' : 'pm';
    localStorage.removeItem(`omeprazol_timer_${suffix}_${fecha}`);
  }

  // 5. If it's SOS Fortasec, decrement count
  if (medId === 'sos_fortasec' && fecha === TODAY()) {
    APP.sosState.fortasecCount = Math.max(0, APP.sosState.fortasecCount - 1);
    localStorage.setItem(`fortasec_${fecha}`, APP.sosState.fortasecCount);
    updateFortasecUI();
  }

  // 6. Refresh UI
  renderTomasHistory();
  if (HISTORY_DATA.loaded) {
    if (HISTORY_DATA.days[fecha] && HISTORY_DATA.days[fecha].meds[medId]) {
      delete HISTORY_DATA.days[fecha].meds[medId];
      renderHistoryByDay();
      updateStats();
    }
  }

  // 7. If date is today, reset the card UI
  if (fecha === TODAY()) {
    resetCardUI(medId);
  }
}

// Global exports for HTML onclick handlers
window.deleteMedToma = deleteMedToma;
// ══════════════════════════════════════
// DYNAMIC CONFIGURATION LOGIC
// ══════════════════════════════════════
let MEDICATIONS_DB = {
  // MAÑANA
  "omeprazol_am": { name: "Omeprazol 40mg", dose: "1 Cápsula (30m antes)", time: "08:00", days: [1,2,3,4,5,6,0], period: "manana" },
  "valsartan": { name: "Valsartan/HTZ 160/25", dose: "1 Comprimido", time: "08:30", days: [1,2,3,4,5,6,0], period: "manana" },
  "amlodipino": { name: "Amlodipino 5mg", dose: "1 Comprimido", time: "08:30", days: [1,2,3,4,5,6,0], period: "manana" },
  "trangorex_am": { name: "Trangorex 200mg", dose: "1 Comp. Solo L-V", time: "08:30", days: [1,2,3,4,5], period: "manana" },
  "kreon_am": { name: "Kreon 35000", dose: "1 Cápsula", time: "08:30", days: [1,2,3,4,5,6,0], period: "manana" },
  "enoxaparina": { name: "Enoxaparina 100mg", dose: "Inyectable SC", time: "08:30", days: [1,2,3,4,5,6,0], period: "manana" },
  "insulina_lantus_am": { name: "Insulina Lantus", dose: "10-12 UI SC", time: "08:30", days: [1,2,3,4,5,6,0], period: "manana" },
  
  // ALMUERZO
  "kreon_almuerzo": { name: "Kreon 35000", dose: "1 Cápsula", time: "11:30", days: [1,2,3,4,5,6,0], period: "almuerzo" },
  
  // COMIDA
  "kreon_comida": { name: "Kreon 35000", dose: "2 Cápsulas", time: "14:30", days: [1,2,3,4,5,6,0], period: "comida" },
  
  // MERIENDA
  "kreon_merienda": { name: "Kreon 35000", dose: "3 Cápsulas", time: "18:00", days: [1,2,3,4,5,6,0], period: "merienda" },
  
  // NOCHE
  "omeprazol_pm": { name: "Omeprazol 40mg", dose: "1 Cápsula (30m antes)", time: "20:00", days: [1,2,3,4,5,6,0], period: "noche" },
  "kreon_noche": { name: "Kreon 35000", dose: "2 Cápsulas", time: "21:00", days: [1,2,3,4,5,6,0], period: "noche" },
  "mirtazapina_noche": { name: "Mirtazapina 15mg", dose: "1 Comprimido", time: "22:00", days: [1,2,3,4,5,6,0], period: "noche" },
  
  // ESPECIALES
  "morfina": { name: "Parche Morfina", dose: "Cambio de parche", time: "09:00", days: [], period: "especial", periodic: 3 },
  "hidroferol": { name: "Hidroferol", dose: "1 Cápsula", time: "09:00", days: [], period: "especial", periodic: 15 }
};

let currentEditingMedId = null;

window.createNewMedication = function() {
  const newId = 'med_custom_' + Date.now();
  MEDICATIONS_DB[newId] = {
    name: 'Nuevo Medicamento',
    dose: '1 Dosis',
    time: '12:00',
    days: [1,2,3,4,5,6,0],
    period: 'comida' // default
  };
  
  currentEditingMedId = newId;
  openConfigModal(null, newId); 
  
  // Force pre-fill defaults because openConfigModal expects the DOM to exist sometimes
  document.getElementById('modal-med-name').textContent = 'Nuevo Medicamento';
  document.getElementById('modal-med-dose').textContent = '1 Dosis';
  document.getElementById('modal-med-time').value = '12:00';
  document.querySelectorAll('.day-checkbox').forEach(cb => cb.checked = true);
};


window.toggleConfigScreen = function() {
  const icon = document.getElementById('btn-toggle-config');
  if (APP.currentScreen !== 'config') {
    showScreen('config');
    icon.textContent = 'close';
    icon.classList.add('text-error');
  } else {
    showScreen('hoy');
    icon.textContent = 'settings';
    icon.classList.remove('text-error');
  }
};

window.openConfigModal = function(btnElement, forceMedId = null) {
  let medId = forceMedId;
  if (!medId && btnElement && typeof btnElement.closest === 'function') {
    const parentCard = btnElement.closest('[data-med]');
    if (parentCard) {
      medId = parentCard.dataset.med;
    } else {
      const wrapper = btnElement.closest('#card-omeprazol-am, #card-omeprazol-pm');
      if (wrapper) {
        medId = wrapper.id === 'card-omeprazol-am' ? 'omeprazol_am' : 'omeprazol_pm';
      }
    }

    if (!medId) {
      const parentUi = btnElement.closest('#ui-morfina, #ui-hidroferol');
      if (parentUi) medId = parentUi.id.replace('ui-', '');
    }
  }

  if (!medId) { alert("Error resolviendo ID de medicamento."); return; }
  
  currentEditingMedId = medId;
  const med = MEDICATIONS_DB[medId] || { name: 'Desconocido', dose: '', time: '12:00', days: [1,2,3,4,5,6,0] };

  document.getElementById('modal-med-name').textContent = med.name;
  document.getElementById('modal-med-dose').textContent = med.dose;
  document.getElementById('modal-med-time').value = med.time || '08:00';
  
  document.querySelectorAll('.day-checkbox').forEach(cb => {
    cb.checked = med.days && med.days.includes(parseInt(cb.value));
  });

  const select = document.getElementById('modal-periodic-select');
  if (med.periodic === 3) select.value = "3";
  else if (med.periodic === 15) select.value = "15";
  else select.value = "";

  const toggleBtn = document.getElementById('btn-toggle-med');
  if (med.deleted) {
      toggleBtn.innerHTML = '<span class="material-symbols-outlined">visibility</span> Reactivar Medicamento';
      toggleBtn.classList.replace('bg-error-container', 'bg-green-100');
      toggleBtn.classList.replace('text-on-error-container', 'text-green-800');
  } else {
      toggleBtn.innerHTML = '<span class="material-symbols-outlined">visibility_off</span> Ocultar/Desactivar';
      toggleBtn.classList.replace('bg-green-100', 'bg-error-container');
      toggleBtn.classList.replace('text-green-800', 'text-on-error-container');
  }

  const modal = document.getElementById('modal-config');
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    modal.children[0].classList.remove('scale-95');
  }, 10);
};

window.closeConfigModal = function() {
  const modal = document.getElementById('modal-config');
  modal.classList.add('opacity-0');
  modal.children[0].classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
    currentEditingMedId = null;
  }, 300);
};

window.saveMedConfig = async function() {
  if (!currentEditingMedId) return;
  
  const med = MEDICATIONS_DB[currentEditingMedId] || {};
  med.time = document.getElementById('modal-med-time').value;
  
  const days = [];
  document.querySelectorAll('.day-checkbox:checked').forEach(cb => {
    days.push(parseInt(cb.value));
  });
  med.days = days;

  const periodic = document.getElementById('modal-periodic-select').value;
  if(periodic) med.periodic = parseInt(periodic);
  else med.periodic = null;

  MEDICATIONS_DB[currentEditingMedId] = med;

  if (APP.db) {
    try {
      await setDoc(doc(APP.db, 'config', 'medicamentos_pilar'), {
        [currentEditingMedId]: med
      }, { merge: true });
    } catch(e) { console.error(e); }
  }
  
  applyDynamicVisibility();
  closeConfigModal();
};

window.toggleMedStatus = async function() {
  if (!currentEditingMedId) return;
  const med = MEDICATIONS_DB[currentEditingMedId];
  med.deleted = !med.deleted;
  
  if (APP.db) {
    try {
      await setDoc(doc(APP.db, 'config', 'medicamentos_pilar'), {
        [currentEditingMedId]: { deleted: med.deleted }
      }, { merge: true });
    } catch(e) { console.error(e); }
  }
  
  applyDynamicVisibility();
  closeConfigModal();
};

window.syncNativeAlarm = function() {
  if (!currentEditingMedId) return;
  const med = MEDICATIONS_DB[currentEditingMedId] || {};
  let timeStr = document.getElementById('modal-med-time').value || med.time || '08:00';
  let parts = timeStr.split(':');
  if (parts.length !== 2) return;
  
  let hour = parts[0];
  let minute = parts[1];
  const title = "💊 " + (med.name || "Pastilla");
  
  // Android Intent to set native alarm
  const intentStr = `intent:#Intent;action=android.intent.action.SET_ALARM;S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(title)};i.android.intent.extra.alarm.HOUR=${hour};i.android.intent.extra.alarm.MINUTES=${minute};B.android.intent.extra.alarm.SKIP_UI=false;end`;
  
  let a = document.createElement("a");
  
  let isAndroid = /android/i.test(navigator.userAgent || navigator.vendor || window.opera);
  if (isAndroid) {
      window.location.href = intentStr;
  } else {
      // Fallback: ICS Event
      let now = new Date();
      now.setHours(hour, minute, 0);
      let isodt = now.toISOString().replace(/-|:|\.\d\d\d/g, "");
      
      let icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pastillero Pilar//App//ES
BEGIN:VEVENT
UID:${Date.now()}@pastillero
DTSTAMP:${isodt}
DTSTART:${isodt}
SUMMARY:${title}
DESCRIPTION:Recordatorio de Medicación
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:${title}
TRIGGER:-PT0M
END:VALARM
END:VEVENT
END:VCALENDAR`;

      let blob = new Blob([icsContent], { type: 'text/calendar' });
      a.href = URL.createObjectURL(blob);
      a.download = `alarma_${currentEditingMedId}.ics`;
      a.click();
  }
};

async function loadDynamicConfig() {
  if (!APP.db) return;
  
  // Real-time listener for medication config
  onSnapshot(doc(APP.db, 'config', 'medicamentos_pilar'), (snap) => {
    if (snap.exists()) {
      const dbData = snap.data();
      console.log("🔄 Configuración de medicamentos actualizada desde la nube");
      // Merge with default DB
      for (const key in dbData) {
        if (MEDICATIONS_DB[key]) {
          MEDICATIONS_DB[key] = { ...MEDICATIONS_DB[key], ...dbData[key] };
        } else {
          MEDICATIONS_DB[key] = dbData[key];
        }
      }
      applyDynamicVisibility();
      // Re-render dashboard components if needed
      if (typeof updateFortasecUI === 'function') updateFortasecUI();
      if (typeof updatePeriodicUI === 'function') updatePeriodicUI();
    }
  });

  try {
    const snap = await getDoc(doc(APP.db, 'config', 'medicamentos_pilar'));
    if (!snap.exists()) {
        // First run: save defaults
        await setDoc(doc(APP.db, 'config', 'medicamentos_pilar'), MEDICATIONS_DB);
    }
  } catch(e) { console.error("Error loading initial config", e); }
}

// Ensure the UI matches logic
function applyDynamicVisibility() {
  const currentDay = new Date().getDay();
  // 1. Ocultar los que estén "deleted" o no toquen hoy (excepto especiales que van por last date)
  for (const [id, med] of Object.entries(MEDICATIONS_DB)) {
     const isDeleted = med.deleted === true;
     const correctDay = med.days && med.days.includes(currentDay);
     const isPeriodic = med.periodic;
     
     // Find the card in "screen-hoy"
     const elemHoy = document.querySelector('#screen-hoy [data-med="' + id + '"]') || 
                     document.querySelector('#screen-hoy #card-' + id.replace('_', '-'));
                     
     if (elemHoy) {
         if (isDeleted || (!correctDay && !isPeriodic)) {
             elemHoy.classList.add('hidden');
         } else {
             // Only remove hidden if it's not logically locked (like PM Omeprazol timer wrapper)
             // For simplicity, just remove hidden for now. The timer logic controls its own hidden state.
             if (!elemHoy.id.includes('timer-')) elemHoy.classList.remove('hidden');
         }
     }
  }
}


window.TODAY = TODAY;

// ══════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════
function showScreen(id) {
  // Clear all active states
  document.querySelectorAll('.screen, .screen-guided, .resting-screen, .screen-welcome').forEach(s => s.classList.remove('active'));
  
  const el = document.getElementById('screen-' + id);
  if (el) { 
    el.classList.add('active'); 
    APP.currentScreen = id; 
    console.log('Active Screen:', id);
  } else {
    console.warn('Screen not found:', id);
  }
  
  // Clean up guided state if transitioning back to normal screens
  if (id !== 'guided' && id !== 'resting' && id !== 'welcome') {
    APP.guided.active = false;
  }
}

function navigateToHoy() {
  const period = PERIOD();
  const checkinKey = `checkin_${TODAY()}_${period}`;
  
  // 1. If guided was active today, resume it immediately
  const storedGuided = localStorage.getItem(`guided_active_${TODAY()}`);
  if (storedGuided === 'true') {
    startGuidedMode(true); // true means resume
    return;
  }
  
  // 2. If it's a new session AND check-in is pending, show Welcome Splash
  const checkinData = JSON.parse(localStorage.getItem(checkinKey) || '{}');
  const checkinPending = !checkinData.temperatura || !checkinData.glucosa || !checkinData.oxigeno;

  if (!localStorage.getItem(`guided_started_${TODAY()}_${period}`) && checkinPending) {
    showScreen('welcome');
    return;
  }
  
  // 3. Normal flow (Always show the dashboard if we reach here)
  showScreen('hoy');
}

function startGuidedMode(resume = false) {
  APP.guided.active = true;
  APP.guided.period = PERIOD();
  APP.guided.steps = []; // Reset steps array to prevent duplication
  localStorage.setItem(`guided_active_${TODAY()}`, 'true');
  localStorage.setItem(`guided_started_${TODAY()}_${APP.guided.period}`, 'true');
  
  if (resume) {
    APP.guided.currentStep = parseInt(localStorage.getItem(`guided_step_${TODAY()}`) || '0');
  } else {
    APP.guided.currentStep = 0;
    localStorage.setItem(`guided_step_${TODAY()}`, '0');
  }
  
  // Load check-in data for this period
  const checkinKey = `checkin_${TODAY()}_${APP.guided.period}`;
  const checkinData = JSON.parse(localStorage.getItem(checkinKey) || '{}');

  // Helper for Periodic Logic
  const getDaysLeft = (id, maxDays) => {
    const lastDate = localStorage.getItem(`last_${id}_date`);
    if (!lastDate) return null;
    const diff = Math.floor((new Date() - new Date(lastDate)) / (1000 * 60 * 60 * 24));
    return maxDays - diff;
  };

  if (APP.guided.period === 'manana') {
    APP.guided.steps.push({ 
      type: 'welcome', 
      title: '¡Hola Pilar!', 
      msg: 'Qué alegría saludarte. Vamos a ver qué necesitamos hoy para que te sientas fenomenal.',
      voice: 'Buenos días Pilar. Qué alegría saludarte. Vamos a ver qué necesitamos hoy para que te sientas fenomenal. ¿Empezamos?'
    });
    
    if (!checkinData.temperatura) {
      APP.guided.steps.push({ type: 'vital', vital: 'temperatura', title: 'Tu Temperatura', voice: 'Pilar, vamos a ver qué tal vas de temperatura hoy. Por favor, dímelo con cuidado.', icon: 'thermostat', unit: '°C', default: 36.5, delta: 0.1 });
    }
    if (!checkinData.glucosa) {
      APP.guided.steps.push({ type: 'vital', vital: 'glucosa', title: 'Tu Azúcar', voice: 'Muy bien. Ahora vamos a registrar cuánto tienes de azúcar, para tenerlo todo bajo control.', icon: 'bloodtype', unit: 'mg', default: 110, delta: 5 });
    }
    if (!checkinData.oxigeno) {
      APP.guided.steps.push({ type: 'vital', vital: 'oxigeno', title: 'Tu Oxígeno', voice: 'Y por último, Pilar, pon el aparatito en el dedo y dime cuánto oxígeno marca. Así sabremos que respiras como una campeona.', icon: 'air', unit: '%', default: 98, delta: 1 });
    }
    
    if (!localStorage.getItem(`med_${TODAY()}_omeprazol_am`)) {
      APP.guided.steps.push({ 
        type: 'med', 
        med: 'omeprazol_am', 
        title: 'Protector Gástrico', 
        dose: '1 Cápsula', 
        voice: 'Ahora es el momento del protector gástrico. Tómalo con un poquito de agua para que tu estómago esté bien preparado.', 
        icon: 'pill' 
      });
      // Always add the wait step after Omeprazol med to ensure visibility
      APP.guided.steps.push({ 
        type: 'wait', 
        title: 'Tiempo de Espera', 
        voice: 'Pilar, ahora debemos tener un poquito de paciencia. El protector necesita treinta minutos para hacer su efecto antes de desayunar. Yo te avisaré.' 
      });
    } else if (localStorage.getItem(`omeprazol_timer_am_${TODAY()}`) && localStorage.getItem(`omeprazol_wait_finished_am_${TODAY()}`) !== 'true') {
      // If med taken but timer still running and NOT skipped, show the wait step
      APP.guided.steps.push({ 
        type: 'wait', 
        title: 'Tiempo de Espera', 
        voice: 'Recuerda Pilar que aún falta un ratito de espera por el protector gástrico. Ten un poco de paciencia, falta muy poco.' 
      });
    }

    // Special Reminders
    const dMorfina = getDaysLeft('morfina', 3);
    if (dMorfina !== null && dMorfina <= 0) {
      APP.guided.steps.push({ type: 'welcome', title: 'Aviso: Parche', msg: 'Hoy toca cambiar el parche de morfina.', voice: 'Aprovecho para recordarte, Pilar, que hoy toca cambiar el parche de morfina. Es importante para no tener molestias.' });
    }
    const dHidro = getDaysLeft('hidroferol', 15);
    if (dHidro !== null && dHidro <= 0) {
      APP.guided.steps.push({ type: 'welcome', title: 'Aviso: Hidroferol', msg: 'Hoy toca la ampolla de Hidroferol.', voice: 'También Pilar, hoy toca la ampolla de Hidroferol para tus huesos. Tómala con el desayuno.' });
    }

    // Breakfast meds
    const meds = [
      { id: 'valsartan', name: 'Valsartan', dose: '1 Comprimido', voice: 'el Valsartán para tu corazón' },
      { id: 'amlodipino', name: 'Amlodipino', dose: '1 Comprimido', voice: 'el Amlodipino para la tensión' },
      { id: 'trangorex_am', name: 'Trangorex', dose: '1 Comprimido', voice: 'el Trangorex para el ritmo del corazón' },
      { id: 'kreon_am', name: 'Kreon 35000', dose: '1 Cápsula', voice: 'tu cápsula de Kreon para la digestión' },
      { id: 'enoxaparina', name: 'Enoxaparina', dose: 'Inyectable SC', voice: 'la inyección de Enoxaparina' },
      { id: 'insulina_lantus_am', name: 'Insulina Lantus', dose: '10–12 UI SC', voice: 'las unidades de Insulina' }
    ];
    meds.forEach(m => {
      if (m.id === 'trangorex_am' && !IS_WEEKDAY()) return;
      if (!localStorage.getItem(`med_${TODAY()}_${m.id}`)) {
        APP.guided.steps.push({ type: 'med', med: m.id, title: m.name, dose: m.dose, voice: `Muy bien Pilar. Ahora vamos a tomar ${m.voice}. Son ${m.dose}. Hazlo con calma.`, icon: 'medication' });
      }
    });

    APP.guided.steps.push({ type: 'end', title: '¡Desayuno Terminado!', msg: 'Hemos cumplido con todo Pilar. ¡Qué orgullosa puedes estar!', voice: '¡Genial Pilar! Hemos terminado todas las tomas del desayuno correctamente. Qué orgullosa puedes estar de lo bien que te cuidas. Ahora descansa y vive la mañana. Yo te avisaré cuando llegue la comida.' });
  } else if (APP.guided.period === 'comida') {
    APP.guided.steps.push({ 
      type: 'welcome', 
      title: 'Hora de Comer', 
      msg: 'Pilar, qué olor más rico sale de la cocina. Vamos con la medicina.',
      voice: 'Hola Pilar. Qué olor más rico sale de la cocina. Antes de disfrutar de la comida, vamos a registrar tu medicina.'
    });
    if (!checkinData.glucosa) {
      APP.guided.steps.push({ type: 'vital', vital: 'glucosa', title: 'Tu Azúcar', voice: 'Por favor Pilar, indícame tu nivel de azúcar actual antes de la comida.', icon: 'bloodtype', unit: 'mg', default: 110, delta: 5 });
    }
    if (!localStorage.getItem(`med_${TODAY()}_kreon_comida`)) {
      APP.guided.steps.push({ type: 'med', med: 'kreon_comida', title: 'Kreon 35000 (Comida)', dose: '2 Cápsulas', voice: 'Tómate ahora tus dos cápsulas de Kreon para ayudarte con la digestión de la comida.', icon: 'medication' });
    }
    APP.guided.steps.push({ type: 'end', title: '¡Buen provecho!', msg: 'Ya está todo registrado.', voice: 'Muy bien Pilar, ya está todo listo. Que disfrutes mucho de la comida. ¡Buen provecho!' });
  } else if (APP.guided.period === 'merienda') {
    APP.guided.steps.push({ 
      type: 'welcome', 
      title: 'La Merienda', 
      msg: 'Es hora de merendar algo rico, Pilar. No olvidemos el Kreon.',
      voice: 'Hola Pilar. Es la hora de la merienda. Vamos a tomarnos el Kreon antes de que se enfríe lo que hayas preparado.'
    });
    if (!checkinData.glucosa) {
      APP.guided.steps.push({ type: 'vital', vital: 'glucosa', title: 'Tu Azúcar', voice: 'Por favor Pilar, indícame tu nivel de azúcar actual antes de merendar.', icon: 'bloodtype', unit: 'mg', default: 110, delta: 5 });
    }
    if (!localStorage.getItem(`med_${TODAY()}_kreon_merienda`)) {
      APP.guided.steps.push({ type: 'med', med: 'kreon_merienda', title: 'Kreon 35000 (Merienda)', dose: '3 Cápsulas', voice: 'Para merendar te tocan tres cápsulas de Kreon. Tómales con un poquito de agua.', icon: 'bakery_dining' });
    }
    APP.guided.steps.push({ type: 'end', title: 'A descansar', msg: 'Merienda registrada. ¡A disfrutar de la tarde!', voice: 'Estupendo Pilar. Ya hemos terminado por ahora. Disfruta de lo que queda de tarde y nos vemos en la cena.' });
  } else {
    // NOCHE
    APP.guided.steps.push({ 
      type: 'welcome', 
      title: 'Hora de Cenar', 
      msg: 'Ya se acaba el día, Pilar. Vamos con la última tanda de hoy.',
      voice: 'Hola Pilar. Ya se acaba el día y pronto podrás descansar. Vamos a hacer las últimas tareas de hoy para que duermas tranquila.'
    });
    if (!checkinData.glucosa) {
      APP.guided.steps.push({ type: 'vital', vital: 'glucosa', title: 'Tu Azúcar', voice: 'Por favor Pilar, indícame tu nivel de azúcar actual antes de la cena.', icon: 'bloodtype', unit: 'mg', default: 110, delta: 5 });
    }
    if (!localStorage.getItem(`med_${TODAY()}_omeprazol_pm`)) {
      APP.guided.steps.push({ type: 'med', med: 'omeprazol_pm', title: 'Protector Gástrico', dose: '1 Cápsula', voice: 'Empezamos con el protector de la noche. Tómalo ahora Pilar.', icon: 'pill' });
      APP.guided.steps.push({ type: 'wait', title: 'Tiempo de Espera', voice: 'Como siempre, vamos a esperar unos minutos antes de cenar para que el protector haga su función.' });
    } else if (localStorage.getItem(`omeprazol_timer_pm_${TODAY()}`) && localStorage.getItem(`omeprazol_wait_finished_pm_${TODAY()}`) !== 'true') {
      // If med taken but timer still running and NOT skipped, show the wait step
      APP.guided.steps.push({ type: 'wait', title: 'Tiempo de Espera', voice: 'Recuerda Pilar que aún falta un ratito de espera por el protector gástrico de la noche. Ten un poco de paciencia.' });
    }
    if (!localStorage.getItem(`med_${TODAY()}_kreon_noche`)) {
      APP.guided.steps.push({ type: 'med', med: 'kreon_noche', title: 'Kreon 35000 (Cena)', dose: '2 Cápsulas', voice: 'Ahora, Pilar, las dos cápsulas de Kreon para la cena.', icon: 'medication' });
    }
    if (!localStorage.getItem(`med_${TODAY()}_mirtazapina_noche`)) {
      APP.guided.steps.push({ type: 'med', med: 'mirtazapina_noche', title: 'Mirtazapina', dose: '1 Comprimido', voice: 'Y por último, la Mirtazapina, para que duermas de maravilla y tengas un sueño dulce y reparador.', icon: 'bedtime' });
    }
    APP.guided.steps.push({ type: 'end', title: '¡Buenas Noches!', msg: 'Has terminado todo tu plan de hoy perfectamente. ¡A descansar!', voice: '¡Felicidades Pilar! Has cumplido con todo el plan de hoy perfectamente. Eres un ejemplo de constancia. Ahora ya puedes descansar tranquila. ¡Buenas noches y dulces sueños!' });
  }

  showScreen('guided');
  renderGuidedStep();
}

function renderGuidedStep() {
  const step = APP.guided.steps[APP.guided.currentStep];
  if (!step) { exitGuidedMode(); return; }
  
  const container = document.getElementById('guided-content');
  container.innerHTML = '';
  
  if (step.voice) speak(step.voice);

  switch (step.type) {
    case 'welcome':
      container.innerHTML = `<h2 class="guided-title">${step.title}</h2><p class="guided-subtitle">${step.msg}</p><button onclick="nextGuidedStep()" class="guided-btn-main bg-primary text-white">EMPEZAR <span class="material-symbols-outlined">play_arrow</span></button>`;
      break;
    
    case 'vital':
      container.innerHTML = `
        <span class="material-symbols-outlined text-6xl text-primary mb-4">${step.icon}</span>
        <h2 class="guided-title">${step.title}</h2>
        <div class="flex items-center gap-4 mb-8">
          <button onclick="adjustGuidedVital(${step.delta * -1}, ${step.delta < 1 ? 1 : 0})" class="w-20 h-24 bg-surface-container rounded-2xl flex items-center justify-center active:scale-90 transition-all font-black text-4xl">－</button>
          <input id="guided-input-val" class="guided-input" type="number" value="${step.default}" readonly />
          <span class="text-4xl font-bold text-on-surface-variant">${step.unit}</span>
          <button onclick="adjustGuidedVital(${step.delta}, ${step.delta < 1 ? 1 : 0})" class="w-20 h-24 bg-surface-container rounded-2xl flex items-center justify-center active:scale-90 transition-all font-black text-4xl">＋</button>
        </div>
        <button onclick="saveGuidedVital('${step.vital}')" class="guided-btn-main bg-tertiary text-white">CONFIRMAR <span class="material-symbols-outlined">check_circle</span></button>
      `;
      break;
    
    case 'med':
      container.innerHTML = `
        <div class="w-24 h-24 bg-primary-container text-white rounded-full flex items-center justify-center mx-auto mb-6"><span class="material-symbols-outlined text-5xl icon-fill">${step.icon || 'pill'}</span></div>
        <h2 class="guided-title">${step.title}</h2>
        <p class="guided-subtitle text-3xl font-black text-primary">${step.dose}</p>
        <div class="flex flex-col gap-3 w-full max-w-sm mx-auto">
          <button onclick="saveGuidedMed('${step.med}')" class="guided-btn-main bg-primary text-white w-full">YA ME LA HE TOMADO <span class="material-symbols-outlined font-black">check</span></button>
          <button onclick="skipGuidedMed('${step.med}')" class="w-full px-8 py-3 bg-surface-variant text-on-surface rounded-2xl font-headline font-bold text-base flex items-center justify-center gap-2 active:scale-95 transition-all">OMITIR MEDICAMENTO <span class="material-symbols-outlined text-xl">skip_next</span></button>
        </div>
      `;
      break;
    
    case 'wait':
      container.innerHTML = `
        <h2 class="guided-title">${step.title}</h2>
        <p class="guided-subtitle" style="margin-bottom:1rem;">Espera 30 minutos antes de ${APP.guided.period === 'manana' ? 'desayunar' : 'cenar'}.</p>
        <div class="flex flex-col items-center">
          <div class="relative" style="width:200px;height:200px;">
            <svg class="absolute inset-0 w-full h-full" style="transform:rotate(-90deg)">
              <circle cx="100" cy="100" r="88" fill="transparent" stroke="#dadbd2" stroke-width="10"></circle>
              <circle id="guided-timer-circle" cx="100" cy="100" r="88" fill="transparent" stroke="#2196f3" stroke-width="10" stroke-dasharray="552.92" stroke-dashoffset="0" stroke-linecap="round"></circle>
            </svg>
            <div id="guided-timer" class="absolute inset-0 flex items-center justify-center text-5xl font-black font-headline text-primary">30:00</div>
          </div>
          <p class="text-on-surface-variant text-lg font-bold mt-4">⏳ Esperando absorción del Omeprazol</p>
        </div>
        <button onclick="skipGuidedWait()" class="mt-6 w-full px-8 py-4 bg-error text-white rounded-2xl font-headline font-bold text-base flex items-center justify-center gap-2 active:scale-95 transition-all">
          <span class="material-symbols-outlined">cancel</span>Omitir Espera (No Recomendado)
        </button>
      `;
      startGuidedTimer();
      break;
    
    case 'end':
      container.innerHTML = `<h2 class="guided-title">${step.title}</h2><p class="guided-subtitle text-2xl">${step.msg}</p><button onclick="enterRestingScreen()" class="guided-btn-main bg-primary text-white">ENTENDIDO <span class="material-symbols-outlined">check_circle</span></button>`;
      break;
  }
}

function nextGuidedStep() {
  APP.guided.currentStep++;
  localStorage.setItem(`guided_step_${TODAY()}`, APP.guided.currentStep.toString());
  renderGuidedStep();
}

function adjustGuidedVital(delta, dec) {
  const input = document.getElementById('guided-input-val');
  let val = parseFloat(input.value);
  input.value = (val + delta).toFixed(dec);
}

async function saveGuidedVital(type) {
  const val = parseFloat(document.getElementById('guided-input-val').value);
  const period = APP.guided.period;
  const now = new Date();
  
  // 1. Firebase Save (Incremental Merge)
  if (APP.db) {
    const docRef = doc(APP.db, 'constantes_pilar', TODAY());
    const updateObj = {};
    updateObj[`${period}.${type}`] = val;
    updateObj[`${period}.timestamp`] = now.toISOString();
    try {
      await updateDoc(docRef, updateObj);
    } catch (e) {
      // If doc doesn't exist yet, use setDoc
      await setDoc(docRef, { [period]: { [type]: val, timestamp: now.toISOString(), periodo: period } }, { merge: true });
    }
  }

  // 2. Local History Sync
  const hist = JSON.parse(localStorage.getItem('constantes_history') || '[]');
  let existing = hist.find(h => h.fecha === TODAY() && h.periodo === period);
  if (existing) {
    existing[type] = val;
    existing.timestamp = now.toISOString();
  } else {
    hist.unshift({ [type]: val, timestamp: now.toISOString(), periodo: period, fecha: TODAY() });
  }
  localStorage.setItem('constantes_history', JSON.stringify(hist.slice(0, 100)));

  // 3. Check-in Flag Sync (to satisfy dashboard logic)
  const checkinKey = `checkin_${TODAY()}_${period}`;
  const currentCheckin = JSON.parse(localStorage.getItem(checkinKey) || '{}');
  currentCheckin[type] = val;
  currentCheckin.timestamp = now.toISOString();
  currentCheckin.periodo = period;
  localStorage.setItem(checkinKey, JSON.stringify(currentCheckin));

  if (type === 'glucosa' && val > 200) {
    APP.guided.steps.splice(APP.guided.currentStep + 1, 0, {
      type: 'welcome',
      title: 'Precaución: Azúcar Alto',
      msg: 'Te sugiero ponerte una dosis de insulina rápida para compensar la comida.',
      voice: 'Atención Pilar. Tienes el azúcar por encima de 200. Te sugiero ponerte una dosis de insulina rápida para compensar la comida.',
      icon: 'vaccines'
    });
  }

  nextGuidedStep();
}

async function saveGuidedMed(medId) {
  try {
    await saveMedToma(medId, APP.guided.period);
    if (medId.includes('omeprazol')) {
      console.log('🕒 Iniciando temporizador de Omeprazol desde Modo Guiado...');
      try {
        startOmeprazolTimer(APP.guided.period);
      } catch (timerErr) {
        console.warn('⚠️ Error al actualizar tablero de fondo, pero el cronómetro seguirá:', timerErr);
      }
    }
    nextGuidedStep();
  } catch (e) {
    console.error('❌ Error guardando medicación guiada:', e);
    // Intentamos avanzar de todos modos para no bloquear a Pilar
    nextGuidedStep();
  }
}

window.skipGuidedMed = function(medId) {
  console.log('Skipping med in guided mode:', medId);
  nextGuidedStep();
};

window.startGuidedTimer = function() {
  const CIRCUMFERENCE = 552.92; // 2 * PI * 88
  const DURATION_SECS = 30 * 60; // 30 minutes
  
  const tick = () => {
    // Check if guided mode is active
    if (!APP.guided.active) return;
    const guiScreen = document.getElementById('screen-guided');
    if (!guiScreen || !guiScreen.classList.contains('active')) return;

    const today = (typeof TODAY === 'function') ? TODAY() : '';
    const periodStr = APP.guided.period || (typeof PERIOD === 'function' ? PERIOD() : 'manana');
    const suffix = periodStr === 'manana' ? 'am' : 'pm';
    
    // Recovery: if APP state is 0, check localStorage
    if (!APP.timerEnds[suffix]) {
      const stored = localStorage.getItem(`omeprazol_timer_${suffix}_${today}`);
      if (stored) {
        console.log(`📡 Recuperando tiempo de localStorage para ${suffix}: ${stored}`);
        APP.timerEnds[suffix] = parseInt(stored);
      }
    }

    const end = APP.timerEnds[suffix];
    
    // Bi-directional sync: check if timer was skipped/finished in full day view
    const externallyFinished = localStorage.getItem(`omeprazol_wait_finished_${suffix}_${today}`) === 'true';
    
    const display = document.getElementById('guided-timer');
    const circle = document.getElementById('guided-timer-circle');
    if (!display) return;
    
    // If no end time and not finished, we shouldn't be here, but we wait for it to appear
    if (!end && !externallyFinished) {
      setTimeout(tick, 500); 
      return;
    }
    
    const remaining = externallyFinished ? 0 : Math.max(0, Math.floor((end - Date.now()) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    
    display.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    
    // Update circular progress
    if (circle) {
      const elapsed = DURATION_SECS - remaining;
      const offset = (elapsed / DURATION_SECS) * CIRCUMFERENCE;
      circle.setAttribute('stroke-dashoffset', CIRCUMFERENCE - offset);
    }
    
    if (remaining <= 0) {
      display.textContent = '';
      display.innerHTML = '<span class="text-tertiary font-black text-4xl">¡LISTO!</span>';
      if (circle) {
        circle.setAttribute('stroke', '#22c55e');
        circle.setAttribute('stroke-dashoffset', '0');
      }
      // Remove skip button and add continue button
      const container = document.getElementById('guided-content');
      if (container && !container.querySelector('.btn-continue-guided')) {
        speak("Pilar, el tiempo de espera ha terminado. Ya puedes continuar.");
        const oldBtn = container.querySelector('button[onclick*="skipGuidedWait"]');
        if (oldBtn) oldBtn.remove();
        const btn = document.createElement('button');
        btn.onclick = nextGuidedStep;
        btn.className = "guided-btn-main bg-tertiary text-white mt-6 pointer-events-auto btn-continue-guided";
        btn.innerHTML = "CONTINUAR <span class='material-symbols-outlined'>arrow_forward</span>";
        container.querySelector('.guided-card')?.appendChild(btn) || container.appendChild(btn);
      }
    } else {
      setTimeout(tick, 1000);
    }
  };
  tick();
};

window.skipGuidedWait = function() {
  console.log('⏩ Omitiendo espera guiada del Omeprazol...');
  try {
    const today = (typeof TODAY === 'function') ? TODAY() : '';
    const suffix = (APP.guided && APP.guided.period === 'manana') ? 'am' : 'pm';
    
    // 1. Set the skip flag in localStorage (persists across both views)
    localStorage.setItem(`omeprazol_wait_finished_${suffix}_${today}`, 'true');
    
    // 2. Also cancel the full-day-view timer so it shows as finished there too
    if (APP.timers[suffix]) clearTimeout(APP.timers[suffix]);
    finishOmeprazolTimer(suffix);
    
    // 3. Advance to next guided step
    nextGuidedStep();
  } catch (e) {
    console.error('Error in skipGuidedWait:', e);
    // Fallback if anything fails — never block Pilar
    nextGuidedStep();
  }
};

function exitGuidedMode() {
  APP.guided.active = false;
  localStorage.removeItem(`guided_active_${TODAY()}`);
  localStorage.removeItem(`guided_step_${TODAY()}`);
  showScreen('hoy');
}

function enterRestingScreen() {
  showScreen('resting');
}

function exitRestingScreen() {
  showScreen('hoy');
}

window.startGuidedMode = startGuidedMode;
window.nextGuidedStep = nextGuidedStep;
window.adjustGuidedVital = adjustGuidedVital;
window.saveGuidedVital = saveGuidedVital;
window.saveGuidedMed = saveGuidedMed;
window.enterRestingScreen = enterRestingScreen;
window.exitRestingScreen = exitRestingScreen;
window.exitGuidedMode = exitGuidedMode;

// Tab bar
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('tab-active'); b.classList.add('tab-inactive'); });
    btn.classList.remove('tab-inactive'); btn.classList.add('tab-active');
    const target = btn.dataset.target;
    if (target === 'hoy') navigateToHoy();
    else if (target === 'sos') showScreen('sos');
    else if (target === 'historial') {
      showScreen('historial');
      loadFullHistory();
    }
  });
});

// ══════════════════════════════════════
// TRANGOREX WEEKDAY RULE
// ══════════════════════════════════════
function applyTrangorexRule() {
  const show = IS_WEEKDAY();
  const el = document.getElementById('card-trangorex-am');
  if (el) el.style.display = show ? '' : 'none';
}

// ══════════════════════════════════════
// QUICK CONSTANTES (Anytime)
// ══════════════════════════════════════
function updateLastConstantes() {
  const hist = JSON.parse(localStorage.getItem('constantes_history') || '[]');
  if (hist.length > 0) {
    const last = hist[0];
    document.getElementById('last-temp').textContent = last.temperatura || '--';
    document.getElementById('last-glucose').textContent = last.glucosa || '--';
    document.getElementById('last-o2').textContent = last.oxigeno || '--';
    const rawTime = last.timestamp || new Date();
    const time = new Date(rawTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('last-constantes-time').textContent = time;
  }
}

// Open modal from Nav Bar
document.getElementById('menu-btn-vitals')?.addEventListener('click', () => {
  document.getElementById('vitals-overlay').classList.remove('hidden');
});

document.getElementById('btn-save-constantes')?.addEventListener('click', async () => {
  const tempVal = document.getElementById('quick-temp').value;
  const glucoseVal = document.getElementById('quick-glucose').value;
  const o2Val = document.getElementById('quick-o2').value;

  if (!tempVal && !glucoseVal && !o2Val) {
    alert('Introduce al menos un valor para registrar.');
    return;
  }

  const temp = tempVal ? parseFloat(tempVal) : null;
  const gluc = glucoseVal ? parseFloat(glucoseVal) : null;
  const o2 = o2Val ? parseFloat(o2Val) : null;

  const now = new Date();
  const timestamp = now.toISOString();
  const period = PERIOD();
  const data = {
    glucosa: gluc,
    temperatura: temp,
    oxigeno: o2,
    timestamp: timestamp,
    periodo: period,
    fecha: TODAY(),
    hora: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  };

  // Save to local history
  const hist = JSON.parse(localStorage.getItem('constantes_history') || '[]');
  hist.unshift(data);
  if (hist.length > 100) hist.length = 100;
  localStorage.setItem('constantes_history', JSON.stringify(hist));

  // Save to Firebase with timestamp key
  if (APP.db) {
    try {
      const entryKey = `entry_${Date.now()}`;
      await setDoc(doc(APP.db, 'constantes_pilar', TODAY()), {
        [entryKey]: data
      }, { merge: true });
      console.log('✅ Constantes guardadas en Firebase');
    } catch (e) {
      console.warn('Error guardando constantes:', e);
    }
  }

  // Update UI and close modal
  updateLastConstantes();
  renderConstantesHistory();
  document.getElementById('vitals-overlay').classList.add('hidden');

  // Clear inputs
  document.getElementById('quick-temp').value = '';
  document.getElementById('quick-glucose').value = '';
  document.getElementById('quick-o2').value = '';

  // Refresh history if loaded
  if (HISTORY_DATA.loaded) {
    loadFullHistory();
  }

  // Show confirmation
  const btn = document.getElementById('btn-save-constantes');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Guardado ✓';
  btn.classList.add('bg-tertiary');
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.classList.remove('bg-tertiary');
  }, 1500);
});

// ══════════════════════════════════════
// CHECK-IN
// ══════════════════════════════════════
function adjustValue(id, delta, decimals) {
  const input = document.getElementById(id);
  if (!input) return;
  let val = parseFloat(input.value) || 0;
  input.value = (val + delta).toFixed(decimals);
  // Trigger input event for alerts (like fever check)
  input.dispatchEvent(new Event('input'));
}
window.adjustValue = adjustValue;

document.getElementById('input-temp').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  document.getElementById('temp-alert').classList.toggle('hidden', !(v > 37.5));
});

document.getElementById('btn-checkin-save').addEventListener('click', async () => {
  const temp = parseFloat(document.getElementById('input-temp').value);
  const gluc = parseFloat(document.getElementById('input-glucose').value);
  const o2 = parseFloat(document.getElementById('input-o2').value);
  
  if (isNaN(temp) || isNaN(gluc) || isNaN(o2)) { 
    alert('Por favor, introduce todos los valores.'); 
    return; 
  }
  
  const period = PERIOD();
  const data = { 
    glucosa: gluc, 
    temperatura: temp, 
    oxigeno: o2,
    timestamp: new Date().toISOString(), 
    periodo: period 
  };
  // Save locally
  localStorage.setItem(`checkin_${TODAY()}_${period}`, JSON.stringify(data));
  // Save history
  const hist = JSON.parse(localStorage.getItem('constantes_history') || '[]');
  hist.unshift({ ...data, fecha: TODAY() });
  if (hist.length > 50) hist.length = 50;
  localStorage.setItem('constantes_history', JSON.stringify(hist));
  // Save to Firebase if connected
  if (APP.db) {
    try { await setDoc(doc(APP.db, 'constantes_pilar', TODAY()), { [period]: data }, { merge: true }); } catch(e) { console.warn('Firebase write error:', e); }
  }
  renderConstantesHistory();
  navigateToHoy();
});

// ══════════════════════════════════════
// OMEPRAZOL 30-MIN TIMER
// ══════════════════════════════════════
function startOmeprazolTimer(period) {
  const suffix = period === 'manana' ? 'am' : 'pm';
  const DURATION = 30 * 60; // 30 minutes
  const endTime = Date.now() + DURATION * 1000;
  APP.timerEnds[suffix] = endTime;
  localStorage.setItem(`omeprazol_timer_${suffix}_${TODAY()}`, endTime);

  // Hide button, show timer (defensive checks for Guided Mode)
  document.getElementById(`btn-omeprazol-${suffix}`)?.classList.add('hidden');
  document.getElementById(`timer-omeprazol-${suffix}`)?.classList.remove('hidden');
  document.getElementById(`card-omeprazol-${suffix}`)?.classList.add('hidden');

  // Lock other meds
  lockMeds(suffix, true);
  tickTimer(suffix);
}

function tickTimer(suffix) {
  const end = APP.timerEnds[suffix];
  const remaining = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  document.getElementById(`timer-text-${suffix}`).textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  // Update SVG
  const circumference = 452.39;
  const DURATION = 30 * 60;
  const elapsed = DURATION - remaining;
  const offset = (elapsed / DURATION) * circumference;
  document.getElementById(`timer-circle-${suffix}`).setAttribute('stroke-dashoffset', circumference - offset);

  if (remaining <= 0) {
    finishOmeprazolTimer(suffix);
    return;
  }
  APP.timers[suffix] = setTimeout(() => tickTimer(suffix), 1000);
}

function finishOmeprazolTimer(suffix) {
  lockMeds(suffix, false);
  document.getElementById(`timer-omeprazol-${suffix}`).innerHTML = '<div class="text-center p-6"><span class="material-symbols-outlined text-tertiary text-5xl icon-fill">check_circle</span><h3 class="font-headline text-2xl font-bold text-tertiary mt-3">¡Tiempo cumplido!</h3><p class="text-on-surface-variant mt-1">Ya puedes tomar el resto de medicación.</p></div>';
  localStorage.removeItem(`omeprazol_timer_${suffix}_${TODAY()}`);
  localStorage.setItem(`omeprazol_wait_finished_${suffix}_${TODAY()}`, 'true');
}

window.cancelOmeprazolTimer = function(suffix) {
  if (APP.timers[suffix]) clearTimeout(APP.timers[suffix]);
  localStorage.setItem(`omeprazol_wait_finished_${suffix}_${TODAY()}`, 'true');
  finishOmeprazolTimer(suffix);
};

function lockMeds(suffix, locked) {
  const container = suffix === 'am' ? 'meds-manana-locked' : 'meds-noche-locked';
  const el = document.getElementById(container);
  if (locked) el.classList.add('locked-card'); else el.classList.remove('locked-card');
  const lockIcon = document.getElementById(`lock-icon-${suffix}`);
  lockIcon.textContent = locked ? 'lock' : 'lock_open';
}

function restoreTimers() {
  ['am','pm'].forEach(suffix => {
    // Check if the wait was already skipped/finished
    const wasSkipped = localStorage.getItem(`omeprazol_wait_finished_${suffix}_${TODAY()}`) === 'true';
    const stored = localStorage.getItem(`omeprazol_timer_${suffix}_${TODAY()}`);
    
    if (wasSkipped) {
      // Timer was skipped — show finished state, don't restart countdown
      if (stored) localStorage.removeItem(`omeprazol_timer_${suffix}_${TODAY()}`);
      const btn = document.getElementById(`btn-omeprazol-${suffix}`);
      const timerEl = document.getElementById(`timer-omeprazol-${suffix}`);
      const card = document.getElementById(`card-omeprazol-${suffix}`);
      if (btn) btn.classList.add('hidden');
      if (card) card.classList.add('hidden');
      if (timerEl) {
        timerEl.classList.remove('hidden');
        finishOmeprazolTimer(suffix);
      }
      return;
    }
    
    if (stored) {
      const end = parseInt(stored);
      if (end > Date.now()) {
        APP.timerEnds[suffix] = end;
        document.getElementById(`btn-omeprazol-${suffix}`)?.classList.add('hidden');
        document.getElementById(`timer-omeprazol-${suffix}`)?.classList.remove('hidden');
        document.getElementById(`card-omeprazol-${suffix}`)?.classList.add('hidden');
        lockMeds(suffix, true);
        tickTimer(suffix);
      } else {
        localStorage.removeItem(`omeprazol_timer_${suffix}_${TODAY()}`);
        finishOmeprazolTimer(suffix);
      }
    }
  });
}

document.getElementById('btn-omeprazol-am').addEventListener('click', async () => {
  const ts = await saveMedToma('omeprazol_am', 'manana');
  startOmeprazolTimer('manana');
});
document.getElementById('btn-omeprazol-pm').addEventListener('click', async () => {
  const ts = await saveMedToma('omeprazol_pm', 'noche');
  startOmeprazolTimer('noche');
});

// ══════════════════════════════════════
// MEDICATION TOMA BUTTONS
// ══════════════════════════════════════

// Morning med buttons
document.querySelectorAll('.btn-med-am').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const card = btn.closest('[data-med]');
    if (!card) return;
    const med = card.dataset.med;
    const ts = await saveMedToma(med, 'manana');
    markCardTakenUI(card, ts);
  });
});

// General toma buttons
document.querySelectorAll('.btn-toma').forEach(btn => {
  btn.addEventListener('click', async () => {
    const card = btn.closest('[data-med]');
    if (!card) return;
    const med = card.dataset.med;
    const periodo = med.includes('merienda') ? 'merienda' : med.includes('comida') ? 'comida' : 'noche';
    const ts = await saveMedToma(med, periodo);
    markCardTakenUI(card, ts);
  });
});

// Night meds (Kreon)
document.getElementById('btn-kreon-noche').addEventListener('click', async () => {
  const ts = await saveMedToma('kreon_noche', 'noche');
  markCardTakenUI(document.getElementById('btn-kreon-noche').closest('[data-med]'), ts);
});

// Night meds (Mirtazapina)
document.getElementById('btn-mirtazapina').addEventListener('click', async () => {
  const ts = await saveMedToma('mirtazapina_noche', 'noche');
  markCardTakenUI(document.getElementById('btn-mirtazapina').closest('[data-med]'), ts);
});

// Morning Insulina
document.getElementById('btn-insulina-lantus').addEventListener('click', async () => {
  const ts = await saveMedToma('insulina_lantus_am', 'am');
  markCardTakenUI(document.getElementById('btn-insulina-lantus').closest('[data-med]'), ts);
});

// ══════════════════════════════════════
// SOS: ORAMORPH 6-HOUR LOCKOUT
// ══════════════════════════════════════
function checkOramorphLockout() {
  const stored = localStorage.getItem(`oramorph_unlock_${TODAY()}`);
  if (stored) {
    const unlock = parseInt(stored);
    if (Date.now() < unlock) {
      APP.sosState.oramorphUnlock = unlock;
      document.getElementById('btn-oramorph').classList.add('opacity-60','pointer-events-none');
      document.getElementById('oramorph-lockout').classList.remove('hidden');
      tickOramorph();
      return;
    }
  }
  document.getElementById('btn-oramorph').classList.remove('opacity-60','pointer-events-none');
  document.getElementById('oramorph-lockout').classList.add('hidden');
}

function tickOramorph() {
  const remaining = Math.max(0, APP.sosState.oramorphUnlock - Date.now());
  if (remaining <= 0) { checkOramorphLockout(); return; }
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  document.getElementById('oramorph-timer-text').textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  setTimeout(tickOramorph, 1000);
}

document.getElementById('btn-oramorph').addEventListener('click', () => {
  if (APP.sosState.oramorphUnlock > Date.now()) return;
  const unlock = Date.now() + 6 * 3600000;
  localStorage.setItem(`oramorph_unlock_${TODAY()}`, unlock);
  saveMedToma('sos_oramorph', 'sos');
  checkOramorphLockout();
});

// ══════════════════════════════════════
// SOS: FORTASEC 8/DAY CAP
// ══════════════════════════════════════
function loadFortasec() {
  const stored = localStorage.getItem(`fortasec_${TODAY()}`);
  APP.sosState.fortasecCount = stored ? parseInt(stored) : 0;
  updateFortasecUI();
}

function updateFortasecUI() {
  document.getElementById('fortasec-counter').textContent = `${APP.sosState.fortasecCount}/8`;
  const btn = document.getElementById('btn-fortasec');
  if (APP.sosState.fortasecCount >= 8) {
    btn.disabled = true;
    btn.classList.add('opacity-40');
    btn.innerHTML = '<span class="material-symbols-outlined">block</span> LÍMITE ALCANZADO';
  }
}

document.getElementById('btn-fortasec').addEventListener('click', async () => {
  if (APP.sosState.fortasecCount >= 8) return;
  APP.sosState.fortasecCount++;
  localStorage.setItem(`fortasec_${TODAY()}`, APP.sosState.fortasecCount);
  saveMedToma('sos_fortasec', 'sos');
  // Also save count to Firebase for cross-device sync
  if (APP.db) {
    try {
      await setDoc(doc(APP.db, 'tomas_pilar', TODAY()), {
        sos_fortasec: { taken: true, count: APP.sosState.fortasecCount, timestamp: new Date().toISOString() }
      }, { merge: true });
    } catch(e) { console.warn('Fortasec sync error:', e); }
  }
  updateFortasecUI();
});

// ══════════════════════════════════════
// PERIODIC TASKS: MORFINA & HIDROFEROL
// ══════════════════════════════════════
function updatePeriodicUI() {
  const getDaysDiff = (isoStr) => {
    if (!isoStr) return null;
    const past = new Date(isoStr);
    const now = new Date();
    // Normalizar a medianoche para contar solo el salto de días
    past.setHours(0,0,0,0);
    now.setHours(0,0,0,0);
    return Math.floor((now - past) / (1000 * 60 * 60 * 24));
  };

  const updateCardUI = (id, lastDate, maxDays) => {
    const ui = document.getElementById(`ui-${id}`);
    const text = document.getElementById(`${id}-status-text`);
    const btn = document.getElementById(`btn-${id}`);
    
    // Si no hay botón (failsafe)
    if (!ui || !text || !btn) return;
    
    const diff = getDaysDiff(lastDate);

    if (diff === null) {
      text.textContent = 'Sin registros recientes.';
      ui.className = 'p-4 rounded-2xl border-2 border-surface-variant/50 transition-colors bg-white/40';
      return;
    }

    const daysLeft = maxDays - diff;
    const formatter = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' });
    const formattedDate = formatter.format(new Date(lastDate));

    if (daysLeft > 0) {
      text.innerHTML = `Faltan <strong>${daysLeft} días</strong> (Último: ${formattedDate})`;
      ui.className = 'p-4 rounded-2xl border-2 border-secondary/30 transition-colors bg-secondary/5';
      
      // Checkmark for taken inside button
      btn.innerHTML = `<span class="material-symbols-outlined text-xl">check</span> REGISTRADO EL ${formattedDate.toUpperCase()}`;
      btn.classList.add('opacity-70', 'pointer-events-none');
    } else if (daysLeft === 0) {
      text.innerHTML = `<span class="text-error font-black">¡TOCA HOY!</span> (Último: ${formattedDate})`;
      ui.className = 'p-4 rounded-2xl border-2 border-error/50 transition-colors bg-error/10';
      
      // Reset button to allow taking it
      btn.innerHTML = `<span class="material-symbols-outlined text-xl">touch_app</span> REGISTRAR CAMBIO HOY`;
      btn.classList.remove('opacity-70', 'pointer-events-none');
    } else {
      text.innerHTML = `<span class="text-error font-black">¡VENCIDO HACE ${Math.abs(daysLeft)} DÍAS!</span> (Último: ${formattedDate})`;
      ui.className = 'p-4 rounded-2xl border-2 border-error transition-colors bg-error/10 shake';
      
      btn.innerHTML = `<span class="material-symbols-outlined text-xl">warning</span> REGISTRAR CAMBIO ATRASADO`;
      btn.classList.remove('opacity-70', 'pointer-events-none');
      btn.classList.add('bg-error-container', 'text-error', 'border-error');
    }
  };

  updateCardUI('morfina', localStorage.getItem('last_morfina_date'), 3);
  updateCardUI('hidroferol', localStorage.getItem('last_hidroferol_date'), 15);
}

async function markPeriodicTask(taskId) {
  const ts = new Date().toISOString();
  localStorage.setItem(`last_${taskId}_date`, ts);
  updatePeriodicUI();
  
  if (APP.db) {
    try {
      await setDoc(doc(APP.db, 'tomas_pilar', 'historico_periodico'), {
        [taskId]: ts
      }, { merge: true });
    } catch (e) { console.warn('Sync periodico fallido', e); }
  }
}

document.getElementById('btn-morfina').addEventListener('click', () => markPeriodicTask('morfina'));
document.getElementById('btn-hidroferol').addEventListener('click', () => markPeriodicTask('hidroferol'));

// ══════════════════════════════════════
// FIREBASE CONFIGURATION
// ══════════════════════════════════════

function connectFirebase(config) {
  try {
    const app = initializeApp(config);
    APP.db = getFirestore(app);
    APP.messaging = getMessaging(app);
    APP.firebaseReady = true;
    document.getElementById('firebase-status-text').textContent = 'Conectado: ' + config.projectId;
    document.getElementById('firebase-status-badge').textContent = 'Online';
    document.getElementById('firebase-status-badge').classList.remove('bg-white/30');
    document.getElementById('firebase-status-badge').classList.add('bg-green-200','text-green-800');
    
    startFirebaseListeners();
    loadDynamicConfig();
    loadFullHistory();
    
    if ('Notification' in window && Notification.permission === 'granted') {
      registrarTokenFCM();
    }
    setupForegroundMessaging();
  } catch(e) { console.error('Firebase init error:', e); }
}

async function registrarTokenFCM() {
  if (!APP.messaging) return;
  console.log("☁️ Intentando registrar token FCM...");
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Get our sw.js registration to tell Firebase to use it for messaging
    let swRegistration = null;
    if ('serviceWorker' in navigator) {
      swRegistration = await navigator.serviceWorker.getRegistration('/');
      console.log('📋 SW Registration for FCM:', swRegistration?.active?.scriptURL);
    }

    const tokenOptions = { vapidKey: VAPID_KEY };
    if (swRegistration) {
      tokenOptions.serviceWorkerRegistration = swRegistration;
    }

    const token = await getToken(APP.messaging, tokenOptions);
    if (token) {
      if (APP.db) {
        await setDoc(doc(APP.db, 'dispositivos', APP.deviceId), {
          fcmToken: token,
          ultimoRegistro: serverTimestamp(),
          os: navigator.platform,
          userAgent: navigator.userAgent
        }, { merge: true });
        console.log('✅ Token FCM guardado');
        updateNotifUI();
      }
    }
  } catch (err) { console.error('❌ Error FCM:', err); }
}

// ══════════════════════════════════════
// FOREGROUND MESSAGE HANDLER
// When the app IS open, FCM data messages arrive here.
// We show a visual alarm overlay + play the alarm sound.
// ══════════════════════════════════════
function setupForegroundMessaging() {
  if (!APP.messaging) return;

  onMessage(APP.messaging, (payload) => {
    console.log('🔔 Foreground FCM message:', payload);
    const data = payload.data || {};

    if (data.type === 'MED_ALARM') {
      // Show visual alarm overlay
      showForegroundAlarm(data);
    }
  });
}

function showForegroundAlarm(data) {
  const title = data.title || '⏰ Hora del medicamento';
  const body = data.body || 'Es la hora de tu medicamento.';

  // Play alarm sound
  if (APP.playAlarmSound) APP.playAlarmSound();

  // Vibrate aggressively
  if (navigator.vibrate) {
    navigator.vibrate([1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000]);
  }

  // Also show a browser notification (in case user switches tabs)
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, {
      body: body,
      icon: './icons/icon-192.png',
      requireInteraction: true,
      tag: 'pastillero-foreground-alarm'
    });
    n.onclick = () => { window.focus(); n.close(); };
  }

  // Show the panic overlay repurposed as alarm overlay
  const overlay = document.getElementById('panic-overlay');
  if (overlay) {
    const contentDiv = overlay.querySelector('.bg-white');
    if (contentDiv) {
      // Temporarily change the overlay content to show medication alarm
      const originalHTML = contentDiv.innerHTML;
      contentDiv.innerHTML = `
        <div class="text-center">
          <div class="w-24 h-24 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span class="material-symbols-outlined text-6xl icon-fill">medication</span>
          </div>
          <h2 class="font-headline font-black text-3xl text-primary tracking-tight">${title}</h2>
          <p class="text-on-surface-variant text-lg mt-2 font-medium">${body}</p>
        </div>
        <div class="space-y-3">
          <button onclick="this.closest('.panic-overlay').classList.add('hidden'); if(window.stopAlarmSound) window.stopAlarmSound(); if(navigator.vibrate) navigator.vibrate(0);"
            class="flex items-center justify-center gap-3 w-full h-16 bg-primary text-white rounded-2xl font-headline font-black text-lg active:scale-95 transition-all shadow-md">
            <span class="material-symbols-outlined">check_circle</span> ENTENDIDO
          </button>
        </div>
      `;
      overlay.classList.remove('hidden');

      // Restore original content when closed
      const observer = new MutationObserver((mutations) => {
        if (overlay.classList.contains('hidden')) {
          contentDiv.innerHTML = originalHTML;
          observer.disconnect();
        }
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    }
  }
}

function startFirebaseListeners() {
  if (!APP.db) return;
  
  // Listen to periodic tasks
  onSnapshot(doc(APP.db, 'tomas_pilar', 'historico_periodico'), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    let updated = false;
    
    if (data.morfina && data.morfina !== localStorage.getItem('last_morfina_date')) {
      localStorage.setItem('last_morfina_date', data.morfina);
      updated = true;
    }
    if (data.hidroferol && data.hidroferol !== localStorage.getItem('last_hidroferol_date')) {
      localStorage.setItem('last_hidroferol_date', data.hidroferol);
      updated = true;
    }
    if (updated) updatePeriodicUI();
  });
  // Listen to today's tomas — SYNC BUTTON STATES FROM REMOTE CHANGES
  onSnapshot(doc(APP.db, 'tomas_pilar', TODAY()), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    console.log('🔄 Tomas sync:', data);

    // 1. Detect and handle removals (Synchronize deletions across devices)
    document.querySelectorAll('[data-med]').forEach(card => {
      const medId = card.dataset.med;
      const isTakenLocally = !!localStorage.getItem(`med_${TODAY()}_${medId}`);
      const isTakenRemotely = data[medId]?.taken;
      
      if (isTakenLocally && !isTakenRemotely) {
        console.log(`🗑️ Detectada eliminación remota de ${medId}, reseteando UI`);
        localStorage.removeItem(`med_${TODAY()}_${medId}`);
        resetCardUI(medId);
      }
    });

    ['am', 'pm'].forEach(suffix => {
      const medId = `omeprazol_${suffix}`;
      const isTakenLocally = !!localStorage.getItem(`med_${TODAY()}_${medId}`);
      const isTakenRemotely = data[medId]?.taken;
      if (isTakenLocally && !isTakenRemotely) {
        localStorage.removeItem(`med_${TODAY()}_${medId}`);
        resetCardUI(medId);
      }
    });

    // 2. Handle additions/updates
    Object.keys(data).forEach(medId => {
      if (medId.startsWith('_')) return;
      
      if (data[medId]?.taken) {
        const key = `med_${TODAY()}_${medId}`;
        const timestamp = data[medId].timestamp || new Date().toISOString();
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, timestamp);
        }

        if (medId === 'omeprazol_am' || medId === 'omeprazol_pm') {
          const suffix = medId === 'omeprazol_am' ? 'am' : 'pm';
          const btn = document.getElementById(`btn-omeprazol-${suffix}`);
          const timerEl = document.getElementById(`timer-omeprazol-${suffix}`);
          
          if (btn && !btn.classList.contains('hidden')) {
            const elapsed = Date.now() - new Date(timestamp).getTime();
            const DURATION = 30 * 60 * 1000;
            if (elapsed < DURATION) {
              if (APP.timers[suffix]) clearTimeout(APP.timers[suffix]);
              APP.timerEnds[suffix] = new Date(timestamp).getTime() + DURATION;
              localStorage.setItem(`omeprazol_timer_${suffix}_${TODAY()}`, APP.timerEnds[suffix]);
              btn.classList.add('hidden');
              timerEl.classList.remove('hidden');
              document.getElementById(`card-omeprazol-${suffix}`).classList.add('hidden');
              lockMeds(suffix, true);
              tickTimer(suffix);
            } else {
              btn.classList.add('hidden');
              timerEl.classList.remove('hidden');
              document.getElementById(`card-omeprazol-${suffix}`).classList.add('hidden');
              finishOmeprazolTimer(suffix);
            }
          }
        } else {
          document.querySelectorAll(`[data-med="${medId}"]`).forEach(card => {
            const isTakenUI = card.classList.contains('!bg-[#22c55e]');
            if (!isTakenUI) {
              markCardTakenUI(card, timestamp);
            }
          });
        }
        
        if (medId === 'sos_fortasec' && data[medId].count) {
          APP.sosState.fortasecCount = data[medId].count;
          localStorage.setItem(`fortasec_${TODAY()}`, data[medId].count);
          updateFortasecUI();
        }
      }
    });
  });
  // Listen to constantes — full real-time sync
  onSnapshot(doc(APP.db, 'constantes_pilar', TODAY()), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    console.log('🔄 Constantes sync:', data);
    // If remote check-in exists for current period, save locally
    const period = PERIOD();
    if (data[period]) {
      const checkinKey = `checkin_${TODAY()}_${period}`;
      if (!localStorage.getItem(checkinKey)) {
        localStorage.setItem(checkinKey, JSON.stringify(data[period]));
        if (APP.currentScreen === 'checkin') {
          navigateToHoy();
        }
      }
    }
    // Rebuild local constantes_history from all remote entries for today
    const remoteEntries = [];
    ['manana','comida','merienda','noche'].forEach(p => {
      if (data[p]) remoteEntries.push({ ...data[p], periodo: p, fecha: TODAY() });
    });
    Object.keys(data).forEach(key => {
      if (key.startsWith('entry_') && data[key]) {
        remoteEntries.push({ ...data[key], fecha: TODAY() });
      }
    });
    // Sort newest first
    remoteEntries.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    // Merge into local history (replace today's entries, keep other days)
    const hist = JSON.parse(localStorage.getItem('constantes_history') || '[]');
    const otherDays = hist.filter(h => h.fecha !== TODAY());
    const merged = [...remoteEntries, ...otherDays].slice(0, 100);
    localStorage.setItem('constantes_history', JSON.stringify(merged));
    // Update dashboard header with latest entry
    updateLastConstantes();
    // The collection listener will detect this change and rebuild the history automatically
    
    // Update Sync Heartbeat
    const syncTimeEl = document.getElementById('sync-time');
    if (syncTimeEl) {
      const now = new Date();
      syncTimeEl.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      document.getElementById('sync-indicator').classList.remove('bg-yellow-100', 'text-yellow-700');
      document.getElementById('sync-indicator').classList.add('bg-green-100', 'text-green-700');
    }
  });

  // ══════════════════════════════════════
  // FULL HISTORY COLLECTION SYNC — ALL DEVICES
  // ══════════════════════════════════════
  
  // 1. TOMAS COLLECTION SYNC
  onSnapshot(query(collection(APP.db, 'tomas_pilar'), orderBy('__name__', 'desc'), limit(30)), (snap) => {
    console.log('🔄 Rebuilding Tomas Global History...');
    const fullHistory = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const fecha = docSnap.id;
      if (fecha === 'historico_periodico' || fecha.startsWith('_')) return;
      Object.keys(data).forEach(medId => {
        if (medId.startsWith('_')) return;
        if (data[medId]?.taken) {
          const timestamp = data[medId].timestamp || new Date().toISOString();
          const p = medId.includes('merienda') ? 'merienda' : (medId.includes('comida') ? 'comida' : (medId.includes('noche') || medId.includes('pm') ? 'noche' : 'manana'));
          fullHistory.push({ med: medId, periodo: p, timestamp, fecha });
        }
      });
    });
    // Sort newest FIRST globally
    fullHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    localStorage.setItem('tomas_history', JSON.stringify(fullHistory.slice(0, 100)));
    renderTomasHistory();
  });

  // 2. CONSTANTES COLLECTION SYNC
  onSnapshot(query(collection(APP.db, 'constantes_pilar'), orderBy('__name__', 'desc'), limit(30)), (snap) => {
    console.log('🔄 Rebuilding Constantes Global History...');
    const fullHist = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const fecha = docSnap.id;
      if (fecha.startsWith('_')) return;
      
      // Collect all entries in this day
      ['manana','comida','merienda','noche'].forEach(p => {
        if (data[p]) fullHist.push({ ...data[p], periodo: p, fecha });
      });
      Object.keys(data).forEach(key => {
        if (key.startsWith('entry_')) fullHist.push({ ...data[key], fecha });
      });
    });
    // Sort newest FIRST globally
    fullHist.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    localStorage.setItem('constantes_history', JSON.stringify(fullHist.slice(0, 100)));
    renderConstantesHistory();
    updateLastConstantes(); // Ensure dashboard header is also synced
  });

  // 3. ALERTAS URGENTES LISTENER — ALL DEVICES — Moved inside to ensure APP.db is ready
  const alertsRef = collection(APP.db, 'alertas_urgentes');
  const qAlerts = query(alertsRef, orderBy('hora_local', 'desc'), limit(1));
  
  onSnapshot(qAlerts, (snapshot) => {
    if (snapshot.empty) return;
    
    const docSnap = snapshot.docs[0];
    const alertData = docSnap.data();
    const alertTime = new Date(alertData.hora_local);

    if (alertTime > APP._connectedAt) {
      APP._connectedAt = alertTime;
      console.log('🚨 NUEVA ALERTA DE PÁNICO DETECTADA:', alertData);

      document.getElementById('panic-overlay').classList.remove('hidden');

      const isSender = alertData.senderId === APP.deviceId;
      
      if (!isSender) {
        console.log('🔔 Sonando alarma en dispositivo receptor');
        if (APP.playAlarmSound) APP.playAlarmSound();
        if (navigator.vibrate) {
          navigator.vibrate([1000, 500, 1000, 500, 1000, 1000]);
        }
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(isSender ? '✅ Alerta enviada' : '🚨 ¡ALERTA DE PÁNICO!', {
            body: alertData.mensaje || 'Pilar ha pulsado el botón de pánico',
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            tag: 'panic-alert-' + (isSender ? 'sender' : 'receiver'),
            renotify: true,
            silent: isSender,
            requireInteraction: !isSender,
            vibrate: isSender ? [] : [500, 200, 500, 200, 500, 200, 1000]
          }).catch(e => console.warn('SW notification failed:', e));
        });
      }
    }
  });
}

  // ══════════════════════════════════════
  // ALARM SOUND GENERATOR (Custom MP3 Buffer)
  // ══════════════════════════════════════
  APP._alarmBuffer = null;
  APP._alarmSource = null;
  APP._audioCtx = null;

  async function loadAlarmBuffer() {
    console.log('🎵 Cargando sonido de alerta...');
    const ctx = APP._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    APP._audioCtx = ctx;

    try {
      const response = await fetch('./alerta.mp3');
      const arrayBuffer = await response.arrayBuffer();
      APP._alarmBuffer = await ctx.decodeAudioData(arrayBuffer);
      console.log('✅ Sonido de alerta decodificado y listo');
    } catch (e) {
      console.error('❌ Error cargando alerta.mp3:', e);
      // Fallback a beep si falla la carga
    }
  }

  APP.playAlarmSound = function() {
    const ctx = APP._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    APP._audioCtx = ctx;
    
    // Resume if it's suspended (browsers often suspend background contexts)
    if (ctx.state === 'suspended') ctx.resume();

    // Stop any existing alarm first
    APP.stopAlarmSound();

    if (!APP._alarmBuffer) {
      console.warn('⚠️ Alarma no cargada aún. Intentando cargar...');
      loadAlarmBuffer(); 
      return; 
    }

    try {
      const source = ctx.createBufferSource();
      source.buffer = APP._alarmBuffer;
      source.loop = true;
      source.connect(ctx.destination);
      source.start(0);
      APP._alarmSource = source;
      console.log('🔔 Alarm ringing (MP3)...');
    } catch (e) {
      console.warn('Audio alarm source failed:', e);
    }
  };

  APP.stopAlarmSound = function() {
    if (APP._alarmSource) {
      try {
        APP._alarmSource.stop();
      } catch(e) {}
      APP._alarmSource = null;
    }
  };

  // Make stopAlarmSound available globally for the close button
  window.stopAlarmSound = APP.stopAlarmSound;


// ══════════════════════════════════════
// PANIC BUTTON
// ══════════════════════════════════════
async function sendPanicAlert() {
  // 1. Show overlay immediately on THIS device (Local visual confirmation ONLY)
  document.getElementById('panic-overlay').classList.remove('hidden');
  // We NO LONGER play the sound here (as requested, only sound on other devices)
  // But we vibrate slightly to confirm the button was pressed
  if (navigator.vibrate) navigator.vibrate(200);

  // 2. Save to Firebase alertas_urgentes — this triggers ALL other devices
  if (APP.db) {
    try {
      await addDoc(collection(APP.db, 'alertas_urgentes'), {
        tipo: 'PANICO',
        paciente: 'Pilar',
        senderId: APP.deviceId, // Important to distinguish sender
        timestamp: serverTimestamp(),
        hora_local: new Date().toISOString(),
        pantalla_activa: APP.currentScreen || 'unknown',
        mensaje: 'Pilar ha pulsado el botón de pánico'
      });
      console.log('🚨 Alerta de pánico enviada a Firebase');
    } catch(e) {
      console.error('Error enviando alerta:', e);
    }
  }
  // 4. Save locally as backup
  const alerts = JSON.parse(localStorage.getItem('panic_history') || '[]');
  alerts.unshift({ timestamp: new Date().toISOString(), screen: APP.currentScreen });
  localStorage.setItem('panic_history', JSON.stringify(alerts));
}

document.getElementById('btn-panic').addEventListener('click', () => {
  sendPanicAlert();
});

document.getElementById('btn-test-alarm')?.addEventListener('click', () => {
  // Show overlay and play sound locally only
  document.getElementById('panic-overlay').classList.remove('hidden');
  if (APP.playAlarmSound) APP.playAlarmSound();
  if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
});

document.getElementById('btn-close-panic').addEventListener('click', () => {
  document.getElementById('panic-overlay').classList.add('hidden');
  // Stop alarm sound and vibration
  if (window.stopAlarmSound) window.stopAlarmSound();
  if (navigator.vibrate) navigator.vibrate(0);
});

// ══════════════════════════════════════
// HISTORY RENDERING
// ══════════════════════════════════════
function renderConstantesHistory() {
  const hist = JSON.parse(localStorage.getItem('constantes_history') || '[]');
  const tbody = document.getElementById('table-constantes');
  if (tbody) tbody.innerHTML = hist.slice(0, 10).map(h => {
    const o2Span = h.oxigeno ? `<br><span class="text-[9px] text-tertiary">O2: ${h.oxigeno}%</span>` : '';
    return `<tr>
      <td class="p-3 text-[10px]">
        <p class="font-bold">${h.fecha}</p>
        <p class="text-on-surface-variant opacity-60">${h.periodo}</p>
      </td>
      <td class="p-3">
        <span class="font-black text-primary">${h.glucosa || '--'}</span> <span class="text-[9px]">mg</span>
      </td>
      <td class="p-3">
        <span class="font-black text-secondary">${h.temperatura || '--'}</span> <span class="text-[9px]">°C</span>
        ${o2Span}
      </td>
    </tr>`;
  }).join('');
}

function renderTomasHistory() {
  const hist = JSON.parse(localStorage.getItem('tomas_history') || '[]');
  const container = document.getElementById('list-tomas');
  if (container) {
    container.innerHTML = hist.slice(0, 15).map(h => {
      const time = new Date(h.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const medName = MED_NAMES[h.med] || h.med.replace(/_/g,' ');
      return `<div class="flex items-center bg-surface-container-high rounded-2xl p-3 gap-3">
        <div class="w-10 h-10 rounded-xl bg-secondary-container/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-lg icon-fill">medication</span>
        </div>
        <div class="flex-1">
          <p class="font-headline font-bold text-sm">${medName}</p>
          <p class="text-on-surface-variant text-xs">${h.periodo} — ${h.fecha}</p>
        </div>
        <div class="flex items-center gap-3">
          <p class="font-headline text-sm font-bold text-primary">${time}</p>
          <button onclick="event.stopPropagation(); if(confirm('¿Anular esta toma?')) deleteMedToma('${h.med}', '${h.fecha}')" class="w-8 h-8 rounded-full bg-error/10 text-error flex items-center justify-center hover:bg-error/20 active:scale-90 transition-all">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════
// FIREBASE HISTORY LOADER
// ══════════════════════════════════════
const HISTORY_DATA = {
  days: {},
  loaded: false
};

const MED_NAMES = {
  'omeprazol_am': 'Omeprazol (Mañana)',
  'omeprazol_pm': 'Omeprazol (Noche)',
  'kreon_am': 'Kreon 35000 (Desayuno)',
  'kreon_almuerzo': 'Kreon 35000 (Almuerzo)',
  'kreon_comida': 'Kreon 35000 (Comida)',
  'kreon_merienda': 'Kreon 35000 (Merienda)',
  'kreon_noche': 'Kreon 35000 (Cena)',
  'valsartan': 'Valsartan/HTZ',
  'amlodipino': 'Amlodipino 5mg',
  'trangorex_am': 'Trangorex 200mg',
  'enoxaparina': 'Enoxaparina 100mg',
  'insulina_lantus_am': 'Insulina Lantus',
  'mirtazapina_noche': 'Mirtazapina 15mg',
  'sos_oramorph': 'Oramorph (SOS)',
  'sos_fortasec': 'Fortasec (SOS)'
};

const MED_DOSES = {
  'omeprazol_am': '1 Cápsula',
  'omeprazol_pm': '1 Cápsula',
  'kreon_am': '1 Cápsula',
  'kreon_almuerzo': '1 Cápsula',
  'kreon_comida': '2 Cápsulas',
  'kreon_merienda': '3 Cápsulas',
  'kreon_noche': '2 Cápsulas',
  'valsartan': '1 Comprimido',
  'amlodipino': '1 Comprimido',
  'trangorex_am': '1 Comprimido',
  'enoxaparina': 'Inyectable SC',
  'insulina_lantus_am': '10-12 UI',
  'mirtazapina_noche': '1 Comprimido',
  'sos_oramorph': '1 ml',
  'sos_fortasec': '1 Cápsula'
};

async function loadFullHistory() {
  if (!APP.db) {
    alert('Firebase no está conectado');
    return;
  }

  document.getElementById('history-loading').classList.remove('hidden');
  document.getElementById('history-empty').classList.add('hidden');
  document.getElementById('history-by-day').innerHTML = '';

  try {
    // Get last 30 days of tomas
    const tomasSnapshot = await getDocs(collection(APP.db, 'tomas_pilar'));
    const constantesSnapshot = await getDocs(collection(APP.db, 'constantes_pilar'));
    const alertasSnapshot = await getDocs(collection(APP.db, 'alertas_urgentes'));

    HISTORY_DATA.days = {};

    // Process tomas
    tomasSnapshot.forEach(doc => {
      if (doc.id.startsWith('_') || doc.id === 'historico_periodico') return;
      const data = doc.data();
      if (data._reset) return; // Skip reset markers

      const date = doc.id;
      if (!HISTORY_DATA.days[date]) HISTORY_DATA.days[date] = { meds: {}, constantes: {} };

      Object.keys(data).forEach(medId => {
        if (medId.startsWith('_')) return;
        if (data[medId]?.taken) {
          HISTORY_DATA.days[date].meds[medId] = {
            taken: true,
            timestamp: data[medId].timestamp
          };
        }
      });
    });

    // Process constantes (supports both period-based and entry-based formats)
    constantesSnapshot.forEach(doc => {
      if (doc.id.startsWith('_')) return;
      const data = doc.data();
      const date = doc.id;
      if (!HISTORY_DATA.days[date]) HISTORY_DATA.days[date] = { meds: {}, constantes: {} };

      // Process period-based entries (old format)
      ['manana', 'comida', 'merienda', 'noche'].forEach(period => {
        if (data[period]) {
          if (!HISTORY_DATA.days[date].constantes.entries) {
            HISTORY_DATA.days[date].constantes.entries = [];
          }
          HISTORY_DATA.days[date].constantes.entries.push({
            ...data[period],
            periodo: period
          });
        }
      });

      // Process entry-based entries (new format: entry_XXXXX)
      Object.keys(data).forEach(key => {
        if (key.startsWith('entry_') && data[key]) {
          if (!HISTORY_DATA.days[date].constantes.entries) {
            HISTORY_DATA.days[date].constantes.entries = [];
          }
          HISTORY_DATA.days[date].constantes.entries.push(data[key]);
        }
      });

      // Sort entries by timestamp
      if (HISTORY_DATA.days[date].constantes.entries) {
        HISTORY_DATA.days[date].constantes.entries.sort((a, b) =>
          new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
        );
      }
    });

    // Count panic alerts
    let panicCount = 0;
    alertasSnapshot.forEach(doc => {
      if (doc.data().tipo === 'PANICO') panicCount++;
    });
    HISTORY_DATA.panicCount = panicCount;

    HISTORY_DATA.loaded = true;
    renderHistoryByDay();
    renderCharts();
    updateStats();

  } catch (e) {
    console.error('Error loading history:', e);
    document.getElementById('history-empty').classList.remove('hidden');
  } finally {
    document.getElementById('history-loading').classList.add('hidden');
  }
}

function renderHistoryByDay() {
  const container = document.getElementById('history-by-day');
  const dates = Object.keys(HISTORY_DATA.days).sort().reverse();

  if (dates.length === 0) {
    document.getElementById('history-empty').classList.remove('hidden');
    return;
  }

  container.innerHTML = dates.map(date => {
    const dayData = HISTORY_DATA.days[date];
    const meds = Object.keys(dayData.meds);

    const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    const medsList = meds.map(medId => {
      const med = dayData.meds[medId];
      const time = med.timestamp ? new Date(med.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--';
      const name = MED_NAMES[medId] || medId.replace(/_/g, ' ');
      const dose = MED_DOSES[medId] ? `<span class="text-[10px] bg-surface-variant px-2 py-0.5 rounded-full text-on-surface ml-2">${MED_DOSES[medId]}</span>` : '';
      return `<div class="flex items-center justify-between py-2 border-b border-outline-variant/20 last:border-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium flex items-center">${name} ${dose}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-tertiary font-bold">${time}</span>
          <button onclick="event.stopPropagation(); if(confirm('¿Anular esta toma?')) deleteMedToma('${medId}', '${date}')" class="w-8 h-8 rounded-full bg-error/10 text-error flex items-center justify-center hover:bg-error/20 active:scale-90 transition-all">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>`;
    }).join('');

    const constantesEntries = dayData.constantes.entries || [];
    const constantesHtml = constantesEntries.length > 0 ?
      constantesEntries.map(c => {
        const time = c.timestamp ? new Date(c.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : (c.hora || '--:--');
        const periodLabel = c.periodo || '';
        return `<div class="flex items-center justify-between text-xs py-1">
          <span class="text-on-surface-variant">${time} ${periodLabel ? `<span class="capitalize opacity-70">(${periodLabel})</span>` : ''}</span>
          <div class="flex gap-3">
            <span class="text-primary font-bold">${c.glucosa} mg/dL</span>
            <span class="text-secondary font-bold">${c.temperatura}°C</span>
          </div>
        </div>`;
      }).join('') : '<p class="text-xs text-on-surface-variant">Sin constantes</p>';

    return `<div class="bg-surface-container-high rounded-2xl overflow-hidden">
      <div class="bg-primary/10 px-4 py-3 flex justify-between items-center">
        <h4 class="font-headline font-bold text-sm capitalize">${formattedDate}</h4>
        <span class="text-xs bg-primary text-white px-2 py-0.5 rounded-full">${meds.length} tomas</span>
      </div>
      <div class="p-4 space-y-3">
        <div class="space-y-1">${medsList}</div>
        <div class="pt-2 border-t border-outline-variant/20">
          <p class="text-xs font-bold text-on-surface-variant mb-1">Constantes:</p>
          ${constantesHtml}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderCharts() {
  // Destroy existing charts if any
  if (HISTORY_DATA.charts) {
    HISTORY_DATA.charts.forEach(chart => chart.destroy());
  }
  HISTORY_DATA.charts = [];

  // Weekly compliance chart
  const ctxWeekly = document.getElementById('chart-weekly').getContext('2d');
  const last7Days = [];
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const expectedMedsPerDay = 9; // Approximate expected medications per day

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    last7Days.push({
      label: dayNames[d.getDay()],
      date: dateStr,
      count: HISTORY_DATA.days[dateStr]?.meds ? Object.keys(HISTORY_DATA.days[dateStr].meds).length : 0
    });
  }

  HISTORY_DATA.charts.push(new Chart(ctxWeekly, {
    type: 'bar',
    data: {
      labels: last7Days.map(d => d.label),
      datasets: [{
        label: 'Medicamentos tomados',
        data: last7Days.map(d => d.count),
        backgroundColor: 'rgba(33, 150, 243, 0.8)',
        borderColor: 'rgba(33, 150, 243, 1)',
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: expectedMedsPerDay + 2 }
      }
    }
  }));

  // Medication distribution (doughnut)
  const ctxMeds = document.getElementById('chart-meds').getContext('2d');
  const medCounts = {};
  Object.values(HISTORY_DATA.days).forEach(day => {
    Object.keys(day.meds).forEach(medId => {
      medCounts[medId] = (medCounts[medId] || 0) + 1;
    });
  });

  const topMeds = Object.entries(medCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  HISTORY_DATA.charts.push(new Chart(ctxMeds, {
    type: 'doughnut',
    data: {
      labels: topMeds.map(([id]) => MED_NAMES[id] || id.replace(/_/g, ' ')),
      datasets: [{
        data: topMeds.map(([, count]) => count),
        backgroundColor: [
          'rgba(33, 150, 243, 0.8)',
          'rgba(255, 152, 0, 0.8)',
          'rgba(76, 175, 80, 0.8)',
          'rgba(156, 39, 176, 0.8)',
          'rgba(244, 67, 54, 0.8)',
          'rgba(0, 150, 136, 0.8)'
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 } } }
      }
    }
  }));

  // Vitals chart
  const ctxVitals = document.getElementById('chart-vitals').getContext('2d');
  const vitalsData = { labels: [], glucose: [], temp: [], o2: [] };

  last7Days.forEach(d => {
    vitalsData.labels.push(d.label);
    const dayData = HISTORY_DATA.days[d.date];
    if (dayData && dayData.constantes && dayData.constantes.entries && dayData.constantes.entries.length > 0) {
      const lastEntry = dayData.constantes.entries[0];
      vitalsData.glucose.push(lastEntry.glucosa || null);
      vitalsData.temp.push(lastEntry.temperatura || null);
      vitalsData.o2.push(lastEntry.oxigeno || null);
    } else {
      vitalsData.glucose.push(null);
      vitalsData.temp.push(null);
      vitalsData.o2.push(null);
    }
  });

  HISTORY_DATA.charts.push(new Chart(ctxVitals, {
    type: 'line',
    data: {
      labels: vitalsData.labels,
      datasets: [{
        label: 'Glucosa (mg/dL)',
        data: vitalsData.glucose,
        borderColor: 'rgba(33, 150, 243, 1)',
        backgroundColor: 'rgba(33, 150, 243, 0.1)',
        fill: true,
        tension: 0.3,
        yAxisID: 'y1'
      }, {
        label: 'Temperatura (°C)',
        data: vitalsData.temp,
        borderColor: 'rgba(255, 152, 0, 1)',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        fill: false,
        tension: 0.3,
        yAxisID: 'y'
      }, {
        label: 'Oxígeno (% SpO2)',
        data: vitalsData.o2,
        borderColor: 'rgba(76, 175, 80, 1)',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        fill: false,
        tension: 0.3,
        yAxisID: 'y1'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Temp (°C)', font: { size: 10, weight: 'bold' } },
          suggestedMin: 35,
          suggestedMax: 38
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Glucosa / O2', font: { size: 10, weight: 'bold' } },
          grid: { drawOnChartArea: false },
          suggestedMin: 70
        }
      }
    }
  }));
}

function updateStats() {
  const dates = Object.keys(HISTORY_DATA.days);
  let totalTomas = 0;
  dates.forEach(date => {
    totalTomas += Object.keys(HISTORY_DATA.days[date].meds).length;
  });

  const avgPerDay = dates.length > 0 ? (totalTomas / dates.length) : 0;
  const expectedPerDay = 9; // Expected medications per day
  const cumplimiento = dates.length > 0 ? Math.round((avgPerDay / expectedPerDay) * 100) : 0;

  document.getElementById('stat-total-tomas').textContent = totalTomas;
  document.getElementById('stat-dias-registrados').textContent = dates.length;
  document.getElementById('stat-cumplimiento').textContent = Math.min(100, cumplimiento) + '%';
  document.getElementById('stat-alertas').textContent = HISTORY_DATA.panicCount || 0;
}

// Tab switching
document.getElementById('tab-historial-lista').addEventListener('click', () => {
  document.getElementById('tab-historial-lista').classList.add('bg-primary', 'text-white');
  document.getElementById('tab-historial-lista').classList.remove('text-on-surface-variant');
  document.getElementById('tab-historial-graficos').classList.remove('bg-primary', 'text-white');
  document.getElementById('tab-historial-graficos').classList.add('text-on-surface-variant');
  document.getElementById('view-historial-lista').classList.remove('hidden');
  document.getElementById('view-historial-graficos').classList.add('hidden');
});

document.getElementById('tab-historial-graficos').addEventListener('click', () => {
  document.getElementById('tab-historial-graficos').classList.add('bg-primary', 'text-white');
  document.getElementById('tab-historial-graficos').classList.remove('text-on-surface-variant');
  document.getElementById('tab-historial-lista').classList.remove('bg-primary', 'text-white');
  document.getElementById('tab-historial-lista').classList.add('text-on-surface-variant');
  document.getElementById('view-historial-graficos').classList.remove('hidden');
  document.getElementById('view-historial-lista').classList.add('hidden');

  // Load history if not loaded
  if (!HISTORY_DATA.loaded && APP.db) {
    loadFullHistory();
  }
});

document.getElementById('btn-load-history').addEventListener('click', loadFullHistory);



// ══════════════════════════════════════
// NOTIFICATION STATUS LOGIC
// ══════════════════════════════════════
function updateNotifUI() {
  const status = Notification?.permission || 'unsupported';
  const textEl = document.getElementById('notif-status-text');
  const iconEl = document.getElementById('notif-status-icon');
  const btnEl = document.getElementById('btn-request-notif');
  const pwaGuide = document.getElementById('pwa-guide');

  if (!textEl || !iconEl) return;

  if (status === 'granted') {
    textEl.textContent = 'Activas ✅';
    textEl.className = 'text-xs text-green-600 font-bold';
    iconEl.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-green-100 text-green-700';
    iconEl.innerHTML = '<span class="material-symbols-outlined text-xl">notifications_active</span>';
    if (btnEl) btnEl.classList.add('hidden');
    if (pwaGuide) pwaGuide.classList.add('hidden');
  } else if (status === 'denied') {
    textEl.textContent = 'Bloqueadas ❌ (Cambia en ajustes)';
    textEl.className = 'text-xs text-error font-bold';
    iconEl.className = 'w-10 h-10 rounded-full flex items-center justify-center bg-error-container/20 text-error';
    iconEl.innerHTML = '<span class="material-symbols-outlined text-xl">notifications_off</span>';
    if (btnEl) btnEl.classList.add('hidden');
  } else {
    textEl.textContent = 'Pendiente de activar';
    textEl.className = 'text-xs text-on-surface-variant';
    if (btnEl) btnEl.classList.remove('hidden');
    // Show PWA guide specifically for iOS if permission is default
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone) {
      if (pwaGuide) pwaGuide.classList.remove('hidden');
    }
  }
}

// ══════════════════════════════════════
// RESTORE STATE ON LOAD
// ══════════════════════════════════════
function restoreMedStates() {
  // Check which meds were already taken today
  document.querySelectorAll('[data-med]').forEach(card => {
    const med = card.dataset.med;
    const stored = localStorage.getItem(`med_${TODAY()}_${med}`);
    if (stored) {
      markCardTakenUI(card, stored);
    }
  });
  // Omeprazol buttons
  ['am','pm'].forEach(s => {
    const stored = localStorage.getItem(`med_${TODAY()}_omeprazol_${s}`);
    if (stored) {
      const card = document.getElementById(`card-omeprazol-${s}`);
      if (card) markCardTakenUI(card, stored);
    }
  });
}

// ══════════════════════════════════════
// LOCAL ALARM CHECKER
// ══════════════════════════════════════
function checkLocalAlarms() {
  const now = new Date();
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${currentHour}:${currentMinute}`;
  const currentDay = now.getDay();
  
  // Ensure we have loaded config
  if (!MEDICATIONS_DB) return;
  
  for (const [id, med] of Object.entries(MEDICATIONS_DB)) {
    if (med.deleted) continue;
    
    // Check periodicity
    let takeToday = false;
    if (med.periodic) {
       let lastTick = localStorage.getItem(`last_${id}_date`);
       if (lastTick) {
         const daysDiff = Math.floor((now - new Date(lastTick)) / (1000 * 60 * 60 * 24));
         if (daysDiff >= med.periodic) takeToday = true;
       } else {
         takeToday = true;
       }
    } else if (med.days && med.days.includes(currentDay)) {
       takeToday = true;
    }
    
    if (takeToday && med.time === currentTime) {
      const takenKey = `med_${TODAY()}_${id}`;
      // Use time + minute to run once
      const alarmKey = `local_alarm_${TODAY()}_${currentTime}_${id}`;
      
      if (!localStorage.getItem(takenKey) && !localStorage.getItem(alarmKey)) {
        console.log(`⏰ [ALARM LOCAL] Disparando: ${med.name}`);
        localStorage.setItem(alarmKey, 'true');
        
        if (typeof showForegroundAlarm === 'function') {
           showForegroundAlarm({
             title: `⏰ ${med.name}`,
             body: `Toca tu medicación: ${med.dose || ''}`,
             medId: id
           });
        }
      }
    }
  }
}

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
function init() {
  // Configurar reloj de alarmas locales cada 10 segundos
  setInterval(checkLocalAlarms, 10000);

  // Date label
  const dateStr = SPANISH_DATE();
  const dateEl = document.getElementById('current-date-hoy');
  if (dateEl) dateEl.textContent = dateStr;
  const oldDateEl = document.getElementById('hoy-date');
  if (oldDateEl) oldDateEl.textContent = dateStr;

  applyTrangorexRule();
  restoreTimers();
  restoreMedStates();
  checkOramorphLockout();
  loadFortasec();
  updatePeriodicUI();
  updateLastConstantes();
  renderConstantesHistory();
  renderTomasHistory();
  loadAlarmBuffer(); // Pre-load custom siren MP3

  // Notification button request
  document.getElementById('btn-request-notif')?.addEventListener('click', () => {
    registrarTokenFCM().then(() => {
      updateNotifUI();
    });
  });
  updateNotifUI();

  // Request notification permission for panic alerts across devices
  if ('Notification' in window && Notification.permission === 'default') {
    // Show a gentle prompt after 2s so the user understands the context
    setTimeout(() => {
      Notification.requestPermission().then(perm => {
        console.log('Notification permission:', perm);
      });
    }, 2000);
  }

  // Preload voices
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  }

  // Auto-connect Firebase
  connectFirebase(FIREBASE_CONFIG);

  // ══════════════════════════════════════
  // AUDIO UNLOCKER FOR MOBILE — Fixes "No sound" issue
  // ══════════════════════════════════════
  const unlockAudio = () => {
    console.log('🔊 Intentando desbloquear audio...');
    if (!APP._audioCtx) {
      APP._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (APP._audioCtx.state === 'suspended') {
      APP._audioCtx.resume().then(() => {
        console.log('✅ Audio desbloqueado correctamente');
        // Play tiny silent beep to verify
        const osc = APP._audioCtx.createOscillator();
        const g = APP._audioCtx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(APP._audioCtx.destination);
        osc.start(0); osc.stop(0.01);
      });
    }
    // Remove listeners after first successful unlock
    ['click', 'touchstart', 'mousedown', 'keydown'].forEach(evt => 
      document.body.removeEventListener(evt, unlockAudio)
    );
  };
  ['click', 'touchstart', 'mousedown', 'keydown'].forEach(evt => 
    document.body.addEventListener(evt, unlockAudio)
  );

  // Initial navigation
  navigateToHoy();
}

// ══════════════════════════════════════
// GLOBAL EXPORTS (For HTML onclick handlers)
// ══════════════════════════════════════
window.TODAY = TODAY;
window.deleteMedToma = deleteMedToma;

init();

