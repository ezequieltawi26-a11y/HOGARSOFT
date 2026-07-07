const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método no permitido" }) };
  }

  try {
    const { to, message, filename, base64Pdf } = JSON.parse(event.body || "{}");
    if (!to || !base64Pdf) {
      return { statusCode: 400, body: JSON.stringify({ error: "Faltan datos (to, base64Pdf)." }) };
    }

    const SID = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_WHATSAPP_FROM;
    const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const NETLIFY_TOKEN = process.env.NETLIFY_AUTH_TOKEN;

    if (!SID || !TOKEN || !FROM) {
      return { statusCode: 500, body: JSON.stringify({ error: "Twilio no está configurado todavía (faltan variables de entorno)." }) };
    }
    if (!SITE_ID || !NETLIFY_TOKEN) {
      return { statusCode: 500, body: JSON.stringify({ error: "Falta configurar NETLIFY_AUTH_TOKEN (ver instrucciones)." }) };
    }

    // 1) Guardar el PDF en Netlify Blobs para que Twilio lo pueda descargar
    const store = getStore({ name: "pdfs-whatsapp", siteID: SITE_ID, token: NETLIFY_TOKEN });
    const id = crypto.randomBytes(8).toString("hex");
    const buffer = Buffer.from(base64Pdf, "base64");
    await store.set(id, buffer);

    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
    const pdfUrl = `${baseUrl}/.netlify/functions/get-pdf?id=${id}`;

    // 2) Armar el número y el mensaje
    const numeroDestino = String(to).replace(/\D/g, "");
    const from = FROM.startsWith("whatsapp:") ? FROM : `whatsapp:${FROM}`;

    const params = new URLSearchParams();
    params.append("From", from);
    params.append("To", `whatsapp:+${numeroDestino}`);
    params.append("Body", message || "Documento adjunto.");
    params.append("MediaUrl", pdfUrl);

    // 3) Llamar a la API de Twilio
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await resp.json();

    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data.message || "Error de Twilio", detalle: data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, sid: data.sid }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
