const admin = require('firebase-admin');
const moment = require('moment-timezone');

// Inicializar Firebase Admin
// La clave JSON debe estar en la variable de entorno FIREBASE_SERVICE_ACCOUNT en Vercel
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error("Error inicializando Firebase Admin. Revisa FIREBASE_SERVICE_ACCOUNT", e);
  }
}

module.exports = async (req, res) => {
  // Asegurarnos de que Firebase Admin está inicializado
  if (!admin.apps.length) {
    return res.status(500).json({ error: "Firebase no configurado correctamente en el servidor." });
  }

  const db = admin.firestore();
  
  // 1. Obtener la hora y el día actual en España
  const now = moment().tz("Europe/Madrid");
  const currentTime = now.format("HH:mm");
  const currentDay = now.day(); // 0 is Sunday, 1 is Monday ... etc.
  console.log(`Cron ejecutado. Hora actual en España: ${currentTime}, Día: ${currentDay}`);

  try {
    // 2. Obtener el token FCM de Pilar
    const dispositivosSnap = await db.collection('dispositivos').get();
    let pilarToken = null;
    dispositivosSnap.forEach(doc => {
      // Tomamos el primer token válido
      if (doc.data().fcmToken) {
        pilarToken = doc.data().fcmToken;
      }
    });

    if (!pilarToken) {
      return res.status(200).json({ message: "No hay token FCM registrado. Pilar debe activar las notificaciones primero." });
    }

    // 3. Cargar las configuraciones dinámicas de la base de datos central de medicamentos
    const alarmasRef = await db.collection('config').doc('medicamentos_pilar').get();
    if (!alarmasRef.exists) {
      return res.status(200).json({ message: "No hay medicamentos configurados en la base de datos." });
    }
    const dinamicos = alarmasRef.data();

    // 4. Analizar medicamentos periodicos (Morfina, Hidroferol)
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
           let lastTick = null;
           if (id === 'morfina' && periodico.morfina) lastTick = periodico.morfina.lastTick;
           else if (id === 'hidroferol' && periodico.hidroferol) lastTick = periodico.hidroferol.lastTick;
           // O fallback para otros genéricos si lo guardásemos
           
           if (lastTick) {
             const daysDiff = now.diff(moment(lastTick), 'days');
             if (daysDiff >= med.periodic) {
                 takeToday = true;
                 pushBody = \`Hoy toca \${med.name} (cada \${med.periodic} días).\`;
             }
           } else {
             // Si nunca se ha tomado, avisamos para que registre el primero
             takeToday = true;
           }
       } else if (med.days && med.days.includes(currentDay)) {
           // Corresponde al día de la semana actual
           takeToday = true;
           pushBody = \`Toca \${med.name} (\${med.dose}).\`;
       }
       
       if (takeToday) {
           alarmsToSend.push({
               title: \`⏰ \${med.name}\`,
               body: pushBody
           });
       }
    }

    if (alarmsToSend.length === 0) {
      return res.status(200).json({ message: "Cron ejecutado. No hay alarmas programadas para esta hora exacta." });
    }

    // 5. Enviar Pushes
    let promises = alarmsToSend.map(alarma => {
      return admin.messaging().send({
        token: pilarToken,
        notification: {
          title: alarma.title,
          body: alarma.body
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK", // Para compatibilidad
          url: "./index.html"
        }
      });
    });

    await Promise.all(promises);

    return res.status(200).json({ success: true, message: \`Enviadas \${alarmsToSend.length} alarmas.\` });

  } catch (error) {
    console.error("Error en el cron:", error);
    return res.status(500).json({ error: error.message });
  }
};
