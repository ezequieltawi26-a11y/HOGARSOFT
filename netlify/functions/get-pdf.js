const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) return { statusCode: 400, body: "Falta el parámetro id" };

  try {
    const store = getStore("pdfs-whatsapp");
    const data = await store.get(id, { type: "arrayBuffer" });
    if (!data) return { statusCode: 404, body: "PDF no encontrado o ya expiró" };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=orden.pdf",
      },
      body: Buffer.from(data).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: "Error: " + e.message };
  }
};
