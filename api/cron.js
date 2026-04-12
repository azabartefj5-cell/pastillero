const admin = require('firebase-admin');
const moment = require('moment-timezone');

// Inicializar Firebase Admin de forma segura
let firebaseInitialized = false;
try {
  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saEnv && !admin.apps.length) {
    const serviceAccount = JSON.parse(saEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
  } else if (admin.apps.length) {
    firebaseInitialized = true;
  }
} catch (e) {
  console.error("Error crítico inicializando Firebase Admin:", e.message);
}

module.exports = async (req, res) => {
  if (!firebaseInitialized) {
    return res.status(200).json({ 
      error: "CONFIG_MISSING", 
      message: "Falta configurar la variable FIREBASE_SERVICE_ACCOUNT en Vercel o el JSON es inválido." 
    });
  }

  const db = admin.firestore();
  
  // 1. Obtener la hora y el día actual en España
  const now = moment().tz("Europe/Madrid");
  const currentTime = now.format("HH:mm");
  const currentDay = now.day(); // 0 is Sunday, 1 is Monday ... etc.
  console.log(`Cron ejecutado. Hora actual en España: ${currentTime}, Día: ${currentDay}`);

  try {
    // 2. Obtener los tokens FCM de todos los dispositivos registrados
    const dispositivosSnap = await db.collection('dispositivos').get();
    const allTokens = [];
    dispositivosSnap.forEach(doc => {
      const token = doc.data().fcmToken;
      if (token) allTokens.push(token);
    });

    if (allTokens.length === 0) {
      return res.status(200).json({ 
        message: "No hay tokens FCM registrados.", 
        debug: {
          project: admin.instanceId ? "Admin Inicializado" : "Desconocido",
          collection_empty: dispositivosSnap.empty,
          docs_count: dispositivosSnap.size,
          hint: "Abre la APP en el móvil, ve a Configuración y pulsa 'Activar Notificaciones' si no están activas."
        }
      });
    }

    // 3. Cargar las configuraciones dinámicas de la base de datos central de medicamentos
    const alarmasRef = await db.collection('config').doc('medicamentos_pilar').get();
    if (!alarmasRef.exists) {
      return res.status(200).json({ message: "No hay medicamentos configurados en la base de datos." });
    }
    const dinamicos = alarmasRef.data();

    // 4. Analizar medicamentos periódicos
    const periodicoRef = await db.collection('tomas_pilar').doc('historico_periodico').get();
    const periodico = periodicoRef.exists ? periodicoRef.data() : {};

    let alarmsToSend = [];

    // Iterar la nueva estructura de medicamentos configurables
    for (const [id, med] of Object.entries(dinamicos)) {
       // Omitimos los eliminados
       if (med.deleted) continue;
       
       // Si no es la hora de este medicamento, pasamos al siguiente
       if (med.time !== currentTime) continue;
       
       // Verificamos si toca hoy por días explícitos o ciclo periódico
       let takeToday = false;
       let pushBody = "Es la hora de tu medicamento.";
       
       if (med.periodic) {
           // Lógica de periodicos (cada X días)
           let lastTick = (id === 'morfina' ? periodico.morfina?.lastTick : (id === 'hidroferol' ? periodico.hidroferol?.lastTick : null));
           
           if (lastTick) {
             const daysDiff = now.diff(moment(lastTick), 'days');
             if (daysDiff >= med.periodic) {
                 takeToday = true;
                 pushBody = `Hoy toca ${med.name} (cada ${med.periodic} días).`;
             }
           } else {
             // Si nunca se ha tomado, avisamos para que registre el primero
             takeToday = true;
           }
       } else if (med.days && med.days.includes(currentDay)) {
           // Corresponde al día de la semana actual
           takeToday = true;
           pushBody = `Toca ${med.name} (${med.dose}).`;
       }
       
       if (takeToday) {
           alarmsToSend.push({
               title: `⏰ ${med.name}`,
               body: pushBody
           });
       }
    }

    if (alarmsToSend.length === 0) {
      const allMedTimes = Object.entries(dinamicos).map(([id, m]) => `${m.name}: ${m.time} (Hoy: ${m.days?.includes(currentDay)})`);
      return res.status(200).json({ 
        message: "Cron ejecutado. No hay alarmas a esta hora.", 
        currentTime, 
        currentDay,
        meds_checked: allMedTimes,
        devices: allTokens.length 
      });
    }

    // 5. Enviar Pushes a TODOS los dispositivos registrados
    const messages = [];
    allTokens.forEach(token => {
      alarmsToSend.forEach(alarma => {
        messages.push({
          token: token,
          notification: {
            title: alarma.title,
            body: alarma.body
          },
          data: {
            url: "./index.html"
          }
        });
      });
    });

    // Enviar todos los mensajes en lotes de forma eficiente
    const response = await admin.messaging().sendEach(messages);

    return res.status(200).json({ 
      success: true, 
      sent_notifications: messages.length, 
      success_count: response.successCount,
      failure_count: response.failureCount
    });

  } catch (error) {
    console.error("Error en el cron:", error);
    return res.status(500).json({ error: error.message });
  }
};
