import React, { useState, useEffect, useMemo } from "react";
import { pdfOrden, pdfReciboEntrega, pdfPago, enviarPDF } from "./pdf.js";

/* ============================================================
   CONTROL TEXTIL — Sistema de producción para indumentaria
   Flujo: Tela → Taller de corte → Taller de costura → Fábrica
   ============================================================ */

const C = {
  bg: "#F4F3EE",
  card: "#FFFFFF",
  ink: "#22242B",
  sub: "#6B6E78",
  line: "#E3E1D9",
  indigo: "#2C3E6B",
  indigoDark: "#1F2C4E",
  hilo: "#C98A2D",
  ok: "#2E7D4F",
  warn: "#C88A00",
  bad: "#C0392B",
  okBg: "#E4F3EA",
  warnBg: "#FBF1D9",
  badBg: "#FAE5E1",
};

const hoy = () => new Date().toISOString().slice(0, 10);
const fmt = (n) =>
  (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const money = (n) => "$ " + fmt(n);
const fFecha = (f) => {
  if (!f) return "—";
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y}`;
};
const diasEntre = (a, b) =>
  Math.round((new Date(b) - new Date(a)) / 86400000);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const VACIO = {
  productos: [],
  talleres: [],
  telas: [],
  telasCatalogo: [],
  ordenes: [],
  pagos: [],
  whatsappFabrica: "",
  pagosTela: [],
  borradores: [],
};

/* ---------- Cálculos por orden ---------- */
function calcOrden(o) {
  const ent = o.entregasCorte || [];
  const rec = o.recepciones || [];
  const cortadas = ent.reduce((s, e) => s + Number(e.cantidad), 0);
  const aceptadasCostura = ent.filter((e) => e.aceptada !== false).reduce((s, e) => s + Number(e.cantidad), 0);
  const enTransitoCorte = cortadas - aceptadasCostura;
  const enviadasFabrica = rec.reduce((s, e) => s + Number(e.cantidad), 0);
  const recibidas = rec.filter((e) => e.aceptada !== false).reduce((s, e) => s + Number(e.cantidad), 0);
  const enTransitoFabrica = enviadasFabrica - recibidas;
  const teoricas = Number(o.prendasTeoricas) || 0;
  const faltanteCorte = Number(o.faltanteCorte) || 0;
  const faltanteCostura = Number(o.faltanteCostura) || 0;
  const enCorte = o.corteCerrado ? 0 : Math.max(teoricas - cortadas, 0);
  const enCostura = o.costuraCerrado ? 0 : Math.max(aceptadasCostura - enviadasFabrica, 0);
  const metrosTeoricos = cortadas * Number(o.consumoUsado || 0);
  const metrosReales = Number(o.metrosReales) || 0;
  const desperdicio = metrosReales > 0 ? metrosReales - metrosTeoricos : 0;
  const pctDesp = metrosReales > 0 ? (desperdicio / metrosReales) * 100 : 0;
  const consumoN = Number(o.consumoUsado || 0);
  const metrosEnv = Number(o.metrosEnviados || 0);
  const pctDespTeorico = metrosEnv > 0 && consumoN > 0 ? Math.max(((metrosEnv - teoricas * consumoN) / metrosEnv) * 100, 0) : 0;

  let estado = "En producción";
  let color = "warn";
  const fpCorte = o.fechaPrometidaCorte || "";
  const fpCostura = o.fechaPrometidaCostura || o.fechaPrometida || "";
  const fechaVigente = enCorte > 0 && fpCorte ? fpCorte : fpCostura;
  const atraso = fechaVigente ? diasEntre(fechaVigente, hoy()) : 0;
  const etapa = enCorte > 0 && fpCorte ? "Corte" : "Costura";
  const terminada = teoricas > 0 && enCorte === 0 && enCostura === 0 && enTransitoCorte === 0 && enTransitoFabrica === 0;
  if (terminada) {
    estado = faltanteCorte + faltanteCostura > 0 ? "Finalizado con faltantes" : "Finalizado";
    color = "ok";
  } else if (fechaVigente && atraso > 0) {
    estado = `${etapa} atrasado ${atraso} día${atraso === 1 ? "" : "s"}`;
    color = "bad";
  } else if (fechaVigente) {
    const restan = -atraso;
    estado = restan <= 3 ? `A tiempo (${restan} d. restantes)` : "A tiempo";
    color = restan <= 3 ? "warn" : "ok";
  }
  return { cortadas, aceptadasCostura, enTransitoCorte, enviadasFabrica, recibidas, enTransitoFabrica, teoricas, enCorte, enCostura, faltanteCorte, faltanteCostura, metrosTeoricos, metrosReales, desperdicio, pctDesp, pctDespTeorico, estado, color, fpCorte, fpCostura, atraso: Math.max(atraso, 0) };
}

function calcDesperdicioOrden(data, o) {
  const k = calcOrden(o);
  const metros = Number(o.metrosEnviados) || 0;
  const usados = k.cortadas * Number(o.consumoUsado || 0);
  const faltanteTotal = Math.max(metros - usados, 0);
  const pct = metros > 0 ? (faltanteTotal / metros) * 100 : 0;
  const exceso = Math.max(pct - 4, 0);
  const metrosExceso = metros > 0 ? (metros * exceso) / 100 : 0;
  const monto = o.corteCerrado ? metrosExceso * precioTelaDeProducto(data, o.productoId) : 0;
  return { metros, usados, faltanteTotal, pct, exceso, metrosExceso, monto };
}

/* ---------- Deuda por taller ---------- */
function deudaTaller(data, tallerId) {
  let devengado = 0;
  data.ordenes.forEach((o) => {
    const k = calcOrden(o);
    if (o.tallerCorteId === tallerId) devengado += k.cortadas * Number(o.precioCorte || 0) - calcDesperdicioOrden(data, o).monto;
    if (o.tallerCosturaId === tallerId) devengado += k.recibidas * Number(o.precioCostura || 0);
  });
  const pagado = data.pagos
    .filter((p) => p.tallerId === tallerId)
    .reduce((s, p) => s + Number(p.monto), 0);
  return { devengado, pagado, saldo: devengado - pagado };
}

/* ---------- Precio promedio de la tela ---------- */
function precioTelaPromedio(data) {
  const m = data.telas.reduce((s, t) => s + Number(t.metros), 0);
  const v = data.telas.reduce((s, t) => s + Number(t.metros) * precioDeTela(data, t.telaId), 0);
  return m > 0 ? v / m : 0;
}

function precioDeTela(data, telaId) {
  const t = data.telasCatalogo.find((x) => x.id === telaId);
  return t ? Number(t.precioMetro) || 0 : 0;
}
function precioTelaDeProducto(data, productoId) {
  const p = data.productos.find((x) => x.id === productoId);
  if (!p) return precioTelaPromedio(data);
  if (p.telaId) return precioDeTela(data, p.telaId);
  if (p.tipoTela) {
    const porNombre = data.telasCatalogo.find((t) => t.nombre.trim().toLowerCase() === p.tipoTela.trim().toLowerCase());
    if (porNombre) return Number(porNombre.precioMetro) || 0;
  }
  return precioTelaPromedio(data);
}
function deudaProveedor(data, proveedor) {
  const telaIds = data.telasCatalogo.filter((t) => (t.proveedor || "Sin proveedor") === proveedor).map((t) => t.id);
  const devengado = data.telas.filter((t) => telaIds.includes(t.telaId)).reduce((s, t) => s + Number(t.metros) * precioDeTela(data, t.telaId), 0);
  const pagado = (data.pagosTela || []).filter((p) => p.proveedor === proveedor).reduce((s, p) => s + Number(p.monto), 0);
  return { devengado, pagado, saldo: devengado - pagado };
}

function stockDeTela(data, telaId) {
  const comprado = data.telas.filter((c) => c.telaId === telaId).reduce((s, c) => s + Number(c.metros), 0);
  const enviado = data.ordenes
    .filter((o) => (data.productos.find((p) => p.id === o.productoId) || {}).telaId === telaId)
    .reduce((s, o) => s + Number(o.metrosEnviados || 0), 0);
  return comprado - enviado;
}

/* ---------- Stock de tela ---------- */
function stockTela(data) {
  const comprado = data.telas.reduce((s, t) => s + Number(t.metros), 0);
  const enviado = data.ordenes.reduce((s, o) => s + Number(o.metrosEnviados || 0), 0);
  return { comprado, enviado, disponible: comprado - enviado };
}

/* ============ Conexión con Supabase (base de datos) ============ */
const leerConfig = () => {
  try { return JSON.parse(localStorage.getItem("textil-config") || "null"); } catch { return null; }
};
async function nubeCargar(cfg) {
  const r = await fetch(`${cfg.url}/rest/v1/almacen?clave=eq.datos&select=valor`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!r.ok) throw new Error("conexion");
  const j = await r.json();
  return j[0]?.valor || null;
}
async function nubeGuardar(cfg, datos) {
  const r = await fetch(`${cfg.url}/rest/v1/almacen`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ clave: "datos", valor: datos }),
  });
  if (!r.ok) throw new Error("guardar");
}

/* ============ Pantalla de configuración (primera vez) ============ */
function Configuracion({ alListo }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [probando, setProbando] = useState(false);

  const conectar = async () => {
    if (!url || !key || !pin) return setError("Completá los tres campos.");
    setProbando(true);
    setError("");
    const cfg = { url: url.trim().replace(/\/$/, ""), key: key.trim(), pin: pin.trim() };
    try {
      await nubeCargar(cfg);
      localStorage.setItem("textil-config", JSON.stringify(cfg));
      alListo(cfg);
    } catch (e) {
      setError("No se pudo conectar. Revisá la URL y la clave, y que hayas creado la tabla en Supabase.");
    }
    setProbando(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "grid", placeItems: "center", padding: 16, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, maxWidth: 440, width: "100%" }}>
        <h2 style={{ margin: "0 0 4px", color: C.indigoDark }}>Control Textil</h2>
        <p style={{ color: C.sub, marginTop: 0 }}>Configuración inicial (una sola vez por dispositivo). Pegá los datos de tu proyecto de Supabase.</p>
        <Campo label="URL del proyecto (Project URL)">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
        </Campo>
        <div style={{ height: 10 }} />
        <Campo label="Clave pública (anon public key)">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi..." />
        </Campo>
        <div style={{ height: 10 }} />
        <Campo label="Elegí un PIN de acceso (para entrar a la app)">
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Ej: 4582" />
        </Campo>
        {error && <div style={{ color: C.bad, marginTop: 10, fontWeight: 600 }}>{error}</div>}
        <BotonP onClick={conectar} style={{ width: "100%", marginTop: 16, opacity: probando ? 0.6 : 1 }}>
          {probando ? "Conectando…" : "Conectar y empezar"}
        </BotonP>
      </div>
    </div>
  );
}

/* ============ Pantalla de ingreso ============ */
function Ingreso({ cfg, data, alEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(false);
  const probar = () => {
    const u = usuario.trim().toLowerCase();
    if (u === "admin" && clave === cfg.pin) return alEntrar({ tipo: "admin" });
    const t = data.talleres.find(
      (x) => (x.usuario || "").trim().toLowerCase() === u && u !== "" && String(x.clave || "") === clave
    );
    if (t) return alEntrar({ tipo: "taller", tallerId: t.id });
    setError(true);
  };
  return (
    <div style={{ minHeight: "100vh", background: C.indigoDark, display: "grid", placeItems: "center", padding: 16, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 340, width: "100%", textAlign: "center" }}>
        <h2 style={{ margin: "0 0 2px", color: C.indigoDark }}>CONTROL TEXTIL</h2>
        <div style={{ width: 40, height: 3, background: C.hilo, margin: "6px auto 16px", borderRadius: 2 }} />
        <input value={usuario} onChange={(e) => { setUsuario(e.target.value); setError(false); }} placeholder="Usuario" style={{ marginBottom: 8 }} autoFocus />
        <input type="password" value={clave} onChange={(e) => { setClave(e.target.value); setError(false); }} onKeyDown={(e) => e.key === "Enter" && probar()} placeholder="Contraseña" />
        {error && <div style={{ color: C.bad, marginTop: 8, fontWeight: 600 }}>Usuario o contraseña incorrectos.</div>}
        <BotonP onClick={probar} style={{ width: "100%", marginTop: 14 }}>Entrar</BotonP>
        <div style={{ fontSize: 11, color: C.sub, marginTop: 10 }}>Dueño: usuario «admin» y tu PIN. Talleres: el usuario y contraseña que les creó el dueño.</div>
      </div>
    </div>
  );
}

/* ============================================================ */
export default function App() {
  const [cfg, setCfg] = useState(leerConfig);
  const [sesion, setSesionRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem("textil-sesion") || "null"); } catch { return null; }
  });
  const setSesion = (v) => {
    setSesionRaw(v);
    try {
      if (v) localStorage.setItem("textil-sesion", JSON.stringify(v));
      else localStorage.removeItem("textil-sesion");
    } catch (e) {}
  };
  const [data, setData] = useState(VACIO);
  const [vista, setVista] = useState("panel");
  const [ordenAbierta, setOrdenAbierta] = useState(null);
  const [cargado, setCargado] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!cfg) return;
    (async () => {
      try {
        const v = await nubeCargar(cfg);
        if (v) setData({ ...VACIO, ...v });
      } catch (e) {
        setAviso("No se pudieron cargar los datos. Revisá tu conexión.");
      }
      setCargado(true);
    })();
  }, [cfg]);

  const guardar = async (nuevo) => {
    setData(nuevo);
    try {
      await nubeGuardar(cfg, nuevo);
    } catch (e) {
      setAviso("No se pudo guardar. Verificá tu conexión a internet.");
      setTimeout(() => setAviso(""), 4000);
    }
  };

  const notificar = (msg) => {
    setAviso(msg);
    setTimeout(() => setAviso(""), 2500);
  };

  if (!cfg) return <Configuracion alListo={(c) => setCfg(c)} />;
  if (!cargado)
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg, color: C.sub, fontFamily: "system-ui" }}>
        Cargando…
      </div>
    );
  if (!sesion) return <Ingreso cfg={cfg} data={data} alEntrar={setSesion} />;

  /* ---- Vista de taller (acceso limitado) ---- */
  if (sesion.tipo === "taller") {
    const taller = data.talleres.find((t) => t.id === sesion.tallerId);
    if (!taller) { setSesion(null); return null; }
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 14 }}>
        <style>{`
          * { box-sizing: border-box; }
          input, select, textarea { font: inherit; padding: 8px 10px; border: 1px solid ${C.line}; border-radius: 8px; background:#fff; width:100%; }
          button { font: inherit; cursor: pointer; border: none; border-radius: 8px; }
          table { border-collapse: collapse; width: 100%; }
          th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: ${C.sub}; padding: 8px 10px; border-bottom: 2px solid ${C.line}; white-space: nowrap; }
          td { padding: 9px 10px; border-bottom: 1px solid ${C.line}; vertical-align: top; }
          tr:last-child td { border-bottom: none; }
          .tabla { overflow-x: auto; }
        `}</style>
        <header style={{ background: C.indigoDark, color: "#fff", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 800 }}>CONTROL TEXTIL — {taller.nombre}</span>
          <button onClick={() => setSesion(null)} style={{ background: C.hilo, color: C.indigoDark, padding: "7px 14px", fontWeight: 700, borderRadius: 20 }}>Salir</button>
        </header>
        {aviso && (
          <div style={{ position: "fixed", top: 14, right: 14, zIndex: 50, background: C.indigo, color: "#fff", padding: "10px 16px", borderRadius: 10 }}>{aviso}</div>
        )}
        <main style={{ maxWidth: 900, margin: "0 auto", padding: "20px 14px 60px" }}>
          <VistaTaller data={data} guardar={guardar} notificar={notificar} taller={taller} />
        </main>
      </div>
    );
  }

  let porConfirmar = 0;
  data.ordenes.forEach((o) => {
    if (o.propuestaReduccion?.estado === "pendiente") porConfirmar++;
    if (o.cierreCortePropuesto?.estado === "pendiente") porConfirmar++;
    (o.entregasCorte || []).forEach((e) => { if (e.aceptada === false) porConfirmar++; });
    (o.recepciones || []).forEach((e) => { if (e.aceptada === false) porConfirmar++; });
  });

  const menu = [
    ["panel", "Panel"],
    ["confirmar", `Confirmar${porConfirmar ? " (" + porConfirmar + ")" : ""}`],
    ["envio", "Enviar"],
    ["stock", "Stock"],
    ["ordenes", "Órdenes"],
    ["borradores", "Borradores"],
    ["productos", "Productos"],
    ["telas", "Telas"],
    ["talleres", "Talleres"],
    ["pagos", "Pagos"],
    ["reportes", "Reportes"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 14 }}>
      <style>{`
        * { box-sizing: border-box; }
        input, select, textarea { font: inherit; padding: 8px 10px; border: 1px solid ${C.line}; border-radius: 8px; background:#fff; width:100%; }
        input:focus, select:focus, textarea:focus { outline: 2px solid ${C.indigo}; outline-offset: 1px; }
        button { font: inherit; cursor: pointer; border: none; border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; }
        th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: ${C.sub}; padding: 8px 10px; border-bottom: 2px solid ${C.line}; white-space: nowrap; }
        td { padding: 9px 10px; border-bottom: 1px solid ${C.line}; vertical-align: top; }
        tr:last-child td { border-bottom: none; }
        .tabla { overflow-x: auto; }
        @media print { .no-print { display: none !important; } }
      `}</style>

      {/* ---------- Encabezado ---------- */}
      <header className="no-print" style={{ background: C.indigoDark, color: "#fff", padding: "14px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: ".02em" }}>CONTROL TEXTIL</span>
          <span style={{ width: 34, height: 3, background: C.hilo, borderRadius: 2, alignSelf: "center" }} />
        </div>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {menu.map(([k, n]) => (
            <button
              key={k}
              onClick={() => { setVista(k); setOrdenAbierta(null); }}
              style={{
                padding: "7px 13px",
                background: vista === k ? C.hilo : "transparent",
                color: vista === k ? C.indigoDark : "#D8DCE8",
                fontWeight: vista === k ? 700 : 500,
                borderRadius: 20,
              }}
            >
              {n}
            </button>
          ))}
        </nav>
        <button onClick={() => setSesion(null)} style={{ marginLeft: "auto", background: "transparent", color: "#D8DCE8", padding: "7px 13px", borderRadius: 20 }}>Salir</button>
      </header>

      {aviso && (
        <div style={{ position: "fixed", top: 14, right: 14, zIndex: 50, background: C.indigo, color: "#fff", padding: "10px 16px", borderRadius: 10, boxShadow: "0 4px 14px rgba(0,0,0,.25)" }}>
          {aviso}
        </div>
      )}

      <main style={{ maxWidth: 1150, margin: "0 auto", padding: "20px 14px 60px" }}>
        {vista === "panel" && <Panel data={data} ir={(v, o) => { setVista(v); setOrdenAbierta(o || null); }} />}
        {vista === "productos" && <Productos data={data} guardar={guardar} notificar={notificar} />}
        {vista === "telas" && <Telas data={data} guardar={guardar} notificar={notificar} />}
        {vista === "talleres" && <Talleres data={data} guardar={guardar} notificar={notificar} />}
        {vista === "ordenes" && !ordenAbierta && <Ordenes data={data} guardar={guardar} abrir={setOrdenAbierta} notificar={notificar} />}
        {vista === "ordenes" && ordenAbierta && (
          <DetalleOrden data={data} guardar={guardar} ordenId={ordenAbierta} volver={() => setOrdenAbierta(null)} notificar={notificar} />
        )}
        {vista === "borradores" && <Borradores data={data} guardar={guardar} notificar={notificar} />}
        {vista === "confirmar" && <ConfirmarAdmin data={data} guardar={guardar} notificar={notificar} />}
        {vista === "envio" && <EnvioAdmin data={data} guardar={guardar} notificar={notificar} />}
        {vista === "stock" && <StockAdmin data={data} />}
        {vista === "pagos" && <Pagos data={data} guardar={guardar} notificar={notificar} />}
        {vista === "reportes" && <Reportes data={data} />}
      </main>
    </div>
  );
}

/* ============ Componentes básicos ============ */
const Card = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>
);
const Titulo = ({ children, extra }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "4px 0 16px" }}>
    <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800 }}>{children}</h2>
    {extra}
  </div>
);
const BotonP = ({ children, ...p }) => (
  <button {...p} style={{ background: C.indigo, color: "#fff", padding: "9px 16px", fontWeight: 600, ...p.style }}>{children}</button>
);
const BotonS = ({ children, ...p }) => (
  <button {...p} style={{ background: "#EDEBE4", color: C.ink, padding: "8px 14px", fontWeight: 600, ...p.style }}>{children}</button>
);
const Campo = ({ label, children }) => (
  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.sub }}>
    <div style={{ marginBottom: 4 }}>{label}</div>
    {children}
  </label>
);
const Chip = ({ tipo, children }) => {
  const m = { ok: [C.okBg, C.ok], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad] };
  const [bg, fg] = m[tipo] || [C.line, C.sub];
  return (
    <span style={{ background: bg, color: fg, fontWeight: 700, fontSize: 12, padding: "3px 10px", borderRadius: 12, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
};
const Vacio = ({ children }) => (
  <div style={{ padding: "26px 10px", textAlign: "center", color: C.sub }}>{children}</div>
);

/* Botón de borrar con confirmación en dos pasos */
function BotonBorrar({ onConfirm }) {
  const [seguro, setSeguro] = useState(false);
  useEffect(() => {
    if (!seguro) return;
    const t = setTimeout(() => setSeguro(false), 3500);
    return () => clearTimeout(t);
  }, [seguro]);
  return seguro ? (
    <button onClick={onConfirm} style={{ background: C.bad, color: "#fff", padding: "5px 10px", fontWeight: 700 }}>¿Seguro?</button>
  ) : (
    <BotonS onClick={() => setSeguro(true)} style={{ padding: "5px 10px", color: C.bad }}>Borrar</BotonS>
  );
}

/* Recibo por WhatsApp (PDF con un toque) */
const soloNumeros = (s) => String(s || "").replace(/\D/g, "");
function ReciboWA({ data, recibo, cerrar }) {
  if (!recibo) return null;
  return (
    <div className="no-print" style={{ position: "fixed", bottom: 14, left: 14, right: 14, zIndex: 60, maxWidth: 500, margin: "0 auto", background: "#fff", border: `2px solid #25D366`, borderRadius: 12, padding: 14, boxShadow: "0 6px 22px rgba(0,0,0,.3)" }}>
      <b>Operación guardada — enviar recibo (PDF) por WhatsApp</b>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {recibo.envios.map((e, i) => {
          const t = data.talleres.find((x) => x.id === e.tallerId);
          return (
            <button
              key={i}
              onClick={async () => {
                const { doc, nombre } = e.crear();
                await enviarPDF(doc, nombre, t, e.texto);
              }}
              style={{ background: "#25D366", color: "#fff", padding: "8px 14px", fontWeight: 700 }}
            >
              📄 {e.etiqueta} → {t?.nombre || "taller"}
            </button>
          );
        })}
        <BotonS onClick={cerrar}>Cerrar</BotonS>
      </div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>
        Se abre WhatsApp con el PDF ya adjunto: solo elegís el contacto y tocás enviar.
      </div>
    </div>
  );
}

/* Barra "hilo": recorrido de las prendas por etapa */
function BarraHilo({ k }) {
  const total = k.teoricas || 1;
  const seg = (n, color) => (
    <div style={{ width: `${(n / total) * 100}%`, background: color, height: "100%" }} />
  );
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "#E9E7DF", border: `1px solid ${C.line}` }}>
        {seg(k.recibidas, C.ok)}
        {seg(k.enTransitoFabrica, "#8FD0A8")}
        {seg(k.enCostura, C.hilo)}
        {seg(k.enTransitoCorte, "#E2CD9C")}
        {seg(k.enCorte, "#B9C0D4")}
        {seg(k.faltanteCorte + k.faltanteCostura, C.bad)}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: C.sub, marginTop: 5 }}>
        <span><b style={{ color: "#8A93AB" }}>●</b> En corte: {fmt(k.enCorte)}</span>
        {k.enTransitoCorte > 0 && <span><b style={{ color: "#C9A94F" }}>●</b> Por aceptar (costura): {fmt(k.enTransitoCorte)}</span>}
        <span><b style={{ color: C.hilo }}>●</b> En costura: {fmt(k.enCostura)}</span>
        {k.enTransitoFabrica > 0 && <span><b style={{ color: "#4FA870" }}>●</b> Por aceptar (fábrica): {fmt(k.enTransitoFabrica)}</span>}
        <span><b style={{ color: C.ok }}>●</b> En fábrica: {fmt(k.recibidas)}</span>
        {k.faltanteCorte + k.faltanteCostura > 0 && (
          <span><b style={{ color: C.bad }}>●</b> Faltantes: {fmt(k.faltanteCorte + k.faltanteCostura)}</span>
        )}
      </div>
    </div>
  );
}

/* ============ VISTA DE TALLER (acceso limitado) ============ */
function VistaTaller({ data, guardar, notificar, taller }) {
  const esCorte = taller.tipo === "corte";
  const d = deudaTaller(data, taller.id);
  const [tab, setTab] = useState("aceptar");
  const [rapido, setRapido] = useState({ productoId: "", cantidad: "", fecha: hoy() });
  const [envC, setEnvC] = useState({ ordenId: "", cantidad: "", tipo: "parcial", fecha: hoy() });
  const [specColores, setSpecColores] = useState([{ color: "", cantidad: "" }]);
  const [specMedidas, setSpecMedidas] = useState([{ nombre: "", medida: "" }]);

  const todas = data.ordenes
    .map((o) => ({ o, k: calcOrden(o) }))
    .filter(({ o }) => (esCorte ? o.tallerCorteId === taller.id : o.tallerCosturaId === taller.id));
  const activas = todas.filter(({ k }) => !k.estado.startsWith("Finalizado"));

  const stockProd = {};
  activas.forEach(({ o, k }) => {
    const disp = esCorte ? k.enCorte : k.enCostura;
    if (disp > 0) stockProd[o.productoId] = (stockProd[o.productoId] || 0) + disp;
  });

  const actualizarOrden = (o, cambios, movimiento, msg) => {
    const ordenes = data.ordenes.map((x) =>
      x.id === o.id ? { ...x, ...cambios, movimientos: [...(x.movimientos || []), { fecha: hoy(), detalle: movimiento }] } : x
    );
    guardar({ ...data, ordenes });
    notificar(msg);
  };

  const aceptarEntrega = (o, i, e) => {
    const entregas = o.entregasCorte.map((x, j) => (j === i ? { ...x, aceptada: true } : x));
    actualizarOrden(o, { entregasCorte: entregas },
      `El taller de costura ${taller.nombre} aceptó ${fmt(e.cantidad)} prendas del corte.`,
      "Aceptado. Ya está en tu taller.");
  };

  const enviarRapido = () => {
    const disponible = stockProd[rapido.productoId] || 0;
    const c = Number(rapido.cantidad);
    if (!rapido.productoId) return notificar("Elegí un producto.");
    if (!c || c <= 0) return notificar("Ingresá una cantidad válida.");
    if (c > disponible) return notificar(`Solo tenés ${fmt(disponible)} unidades. No podés enviar más.`);
    let resto = c;
    let ordenRef = null;
    const ordenes = data.ordenes.map((o) => {
      if (resto <= 0 || o.productoId !== rapido.productoId) return o;
      const k = calcOrden(o);
      if (esCorte) {
        if (o.tallerCorteId !== taller.id || o.corteCerrado || k.enCorte <= 0) return o;
        const q = Math.min(resto, k.enCorte);
        resto -= q;
        return { ...o, entregasCorte: [...(o.entregasCorte || []), { fecha: rapido.fecha, cantidad: q, aceptada: false }], movimientos: [...(o.movimientos || []), { fecha: hoy(), detalle: `El taller de corte ${taller.nombre} envió ${fmt(q)} prendas a costura (pendiente de aceptación).` }] };
      } else {
        if (o.tallerCosturaId !== taller.id || o.costuraCerrado || k.enCostura <= 0) return o;
        const q = Math.min(resto, k.enCostura);
        resto -= q;
        if (!ordenRef) ordenRef = { numero: o.numero, id: o.id, pendiente: k.enCostura - q };
        return { ...o, recepciones: [...(o.recepciones || []), { fecha: rapido.fecha, cantidad: q, estado: "A revisar", responsable: taller.nombre, obs: "", aceptada: false }], movimientos: [...(o.movimientos || []), { fecha: hoy(), detalle: `El taller de costura ${taller.nombre} envió ${fmt(q)} prendas a fábrica (pendiente de aceptación).` }] };
      }
    });
    guardar({ ...data, ordenes });
    notificar(`Se enviaron ${fmt(c)} prendas. Falta que ${esCorte ? "la costura" : "la fábrica"} las acepte.`);
    if (!esCorte && ordenRef) {
      const pdfFab = pdfReciboEntrega({
        numero: ordenRef.numero, fecha: fFecha(rapido.fecha),
        tallerEntrega: taller.nombre, recibe: "Fábrica",
        nroRecibo: `#REC-${ordenRef.numero}-${taller.nombre}`,
        producto: nombreProducto(data, rapido.productoId), colores: (data.productos.find((p) => p.id === rapido.productoId) || {}).colores,
        cantidad: fmt(c), pendiente: fmt(ordenRef.pendiente),
        observaciones: "Envío pendiente de aceptación por fábrica.",
      });
      enviarPDF(pdfFab, `recibo-envio-fabrica-${ordenRef.numero}.pdf`, { whatsapp: data.whatsappFabrica }, `Orden #${ordenRef.numero}: ${nombreProducto(data, rapido.productoId)} — envío de ${fmt(c)} prendas a fábrica.`);
    }
    setRapido({ ...rapido, cantidad: "" });
  };

  /* Pendientes por aceptar */
  const pendientes = [];
  activas.forEach(({ o }) => {
    if (esCorte) {
      (o.entregasCorte || []).forEach((e) => { if (e.aceptada === false) pendientes.push({ o, e, mio: true }); });
    } else {
      (o.entregasCorte || []).forEach((e, i) => { if (e.aceptada === false) pendientes.push({ o, e, i }); });
    }
  });

  /* Cuenta del mes actual (se reinicia cada principio de mes) */
  const mesIni = hoy().slice(0, 8) + "01";
  let trabajoMes = 0;
  todas.forEach(({ o }) => {
    if (esCorte) (o.entregasCorte || []).forEach((e) => { if (e.fecha >= mesIni) trabajoMes += Number(e.cantidad) * Number(o.precioCorte || 0); });
    else (o.recepciones || []).forEach((e) => { if (e.aceptada !== false && e.fecha >= mesIni) trabajoMes += Number(e.cantidad) * Number(o.precioCostura || 0); });
  });
  const pagosMes = data.pagos.filter((p) => p.tallerId === taller.id && p.fecha >= mesIni).reduce((s, p) => s + Number(p.monto), 0);

  const Dato = ({ l, v, color }) => (
    <div>
      <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>{l}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.ink }}>{v}</div>
    </div>
  );

  const botones = [
    ["aceptar", `Por aceptar${pendientes.length ? " (" + pendientes.length + ")" : ""}`],
    ["saldo", "Lo que me deben"],
    ["enviar", "Enviar productos"],
    ["stock", "Mi stock"],
    ...(esCorte ? [["descuentos", "Descuentos"]] : []),
    ["ordenes", "Todas las órdenes"],
  ];

  const [prop, setProp] = useState({});
  const proponer = (o, k) => {
    const n = Number(prop[o.id]);
    if (!n || n <= 0) return notificar("Ingresá una cantidad válida.");
    if (n >= k.teoricas) return notificar(`Tiene que ser menor a ${fmt(k.teoricas)}.`);
    if (n < k.cortadas) return notificar(`No puede ser menor a lo ya enviado (${fmt(k.cortadas)}).`);
    actualizarOrden(o, { propuestaReduccion: { cantidad: n, fecha: hoy(), estado: "pendiente" } },
      `El taller de corte propuso entregar ${fmt(n)} prendas en lugar de ${fmt(k.teoricas)}.`,
      "Propuesta enviada al dueño. Esperá su aceptación.");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {botones.map(([k, n]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "9px 15px", borderRadius: 20, fontWeight: 700, background: tab === k ? C.indigo : "#EDEBE4", color: tab === k ? "#fff" : C.ink }}>{n}</button>
        ))}
      </div>

      {tab === "aceptar" && (
        <Card>
          <b>{esCorte ? "Mis envíos esperando aceptación" : "Prendas por aceptar"}</b>
          {pendientes.length === 0 ? (
            <Vacio>No hay nada pendiente de aceptar.</Vacio>
          ) : (
            <div style={{ marginTop: 10 }}>
              {pendientes.map((p, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                  <span>
                    <b>Orden #{p.o.numero}</b> — {nombreProducto(data, p.o.productoId)}<br />
                    {fFecha(p.e.fecha)} — <b>{fmt(p.e.cantidad)} prendas</b>
                  </span>
                  {p.mio ? (
                    <Chip tipo="warn">Esperando a costura</Chip>
                  ) : (
                    <BotonP onClick={() => aceptarEntrega(p.o, p.i, p.e)} style={{ padding: "7px 14px" }}>Aceptar</BotonP>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "saldo" && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <b>Lo que me deben (total)</b>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 12, marginTop: 10 }}>
              <Dato l="Trabajo realizado" v={money(d.devengado)} />
              <Dato l="Ya cobrado" v={money(d.pagado)} color={C.ok} />
              <Dato l="A cobrar" v={money(d.saldo)} color={d.saldo > 0 ? C.bad : C.ok} />
            </div>
          </Card>
          <Card style={{ marginBottom: 14 }}>
            <b>Trabajo hecho por partida</b>
            {(() => {
              const filas = todas
                .map(({ o, k }) => ({
                  o,
                  unidades: esCorte ? k.cortadas : k.recibidas,
                  precio: Number(esCorte ? o.precioCorte : o.precioCostura) || 0,
                }))
                .filter((f) => f.unidades > 0);
              if (filas.length === 0) return <Vacio>Todavía no hiciste unidades.</Vacio>;
              const totU = filas.reduce((a, f) => a + f.unidades, 0);
              const totM = filas.reduce((a, f) => a + f.unidades * f.precio, 0);
              return (
                <div className="tabla" style={{ marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Partida</th><th>Producto</th><th>Unidades hechas</th><th>Monto a cobrar</th></tr></thead>
                    <tbody>
                      {filas.map((f) => (
                        <tr key={f.o.id}>
                          <td><b>#{f.o.numero}</b></td>
                          <td>{nombreProducto(data, f.o.productoId)}</td>
                          <td>{fmt(f.unidades)} u.</td>
                          <td style={{ fontWeight: 800 }}>{money(f.unidades * f.precio)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "#FAF9F5" }}><td colSpan={2}><b>TOTAL</b></td><td><b>{fmt(totU)} u.</b></td><td style={{ fontWeight: 800 }}>{money(totM)}</td></tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Card>
          <Card style={{ marginBottom: 14 }}>
            <b>Pagos que me hicieron</b>
            {(() => {
              const misPagos = data.pagos.filter((p) => p.tallerId === taller.id);
              if (misPagos.length === 0) return <Vacio>Todavía no recibiste pagos.</Vacio>;
              return (
                <div className="tabla" style={{ marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Fecha</th><th>Monto</th><th>Detalle</th></tr></thead>
                    <tbody>
                      {misPagos.slice().reverse().map((p) => (
                        <tr key={p.id}><td>{fFecha(p.fecha)}</td><td style={{ fontWeight: 800, color: C.ok }}>{money(p.monto)}</td><td>{p.obs || "—"}</td></tr>
                      ))}
                      <tr style={{ background: "#FAF9F5" }}><td><b>TOTAL COBRADO</b></td><td style={{ fontWeight: 800, color: C.ok }}>{money(d.pagado)}</td><td></td></tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Card>
          <Card>
            <b>Este mes (desde el {fFecha(mesIni)})</b>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 12, marginTop: 10 }}>
              <Dato l="Trabajo del mes" v={money(trabajoMes)} />
              <Dato l="Cobrado en el mes" v={money(pagosMes)} color={C.ok} />
            </div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>Se reinicia automáticamente cada principio de mes.</div>
          </Card>
        </>
      )}

      {tab === "enviar" && esCorte && (() => {
        const partidas = activas.filter(({ o, k }) => !o.corteCerrado && k.enCorte > 0 && o.cierreCortePropuesto?.estado !== "pendiente");
        const item = partidas.find(({ o }) => o.id === envC.ordenId);
        const guardarEspec = () => {
          if (!item) return notificar("Elegí la partida primero.");
          actualizarOrden(item.o,
            { coloresSpec: (specColores || []).filter((c) => c.color.trim()), medidasSpec: (specMedidas || []).filter((m) => m.nombre.trim()) },
            "El taller de corte actualizó el desglose de colores y medidas.",
            "Especificación guardada.");
        };
        const enviarPartida = () => {
          if (!item) return notificar("Elegí la partida.");
          const { o, k } = item;
          const c = Number(envC.cantidad);
          if (!c || c <= 0) return notificar("Ingresá una cantidad válida.");
          if (c > k.enCorte) return notificar(`Solo te quedan ${fmt(k.enCorte)} prendas en esa partida.`);
          const cambios = { entregasCorte: [...(o.entregasCorte || []), { fecha: envC.fecha, cantidad: c, aceptada: false }] };
          let msg = "Envío registrado. La costura debe aceptarlo.";
          let mov = `El taller de corte ${taller.nombre} envió ${fmt(c)} prendas a costura (pendiente de aceptación).`;
          if (envC.tipo === "total" && c < k.enCorte) {
            cambios.cierreCortePropuesto = { faltante: k.enCorte - c, fecha: hoy(), estado: "pendiente" };
            mov += ` Además pidió cerrar la partida con ${fmt(k.enCorte - c)} faltantes.`;
            msg = "Envío registrado. El dueño debe aceptar el faltante.";
          }
          actualizarOrden(o, cambios, mov, msg);
          const prod = data.productos.find((x) => x.id === o.productoId) || {};
          const pdfCostura = pdfOrden({
            numero: o.numero, fecha: fFecha(envC.fecha), fechaEntrega: fFecha(k.fpCostura),
            taller: nombreTaller(data, o.tallerCosturaId), destino: "costura",
            producto: nombreProducto(data, o.productoId), colores: prod.colores, medida: prod.medida,
            cantidad: fmt(c),
            esParcial: envC.tipo === "parcial",
            cantidadOriginal: fmt(k.teoricas), cantidadEntregada: fmt(k.cortadas + c), faltanteOrden: fmt(Math.max(k.teoricas - (k.cortadas + c), 0)),
            coloresSpec: (specColores || []).filter((c) => c.color.trim()).length ? specColores.filter((c) => c.color.trim()) : o.coloresSpec,
            medidasSpec: (specMedidas || []).filter((m) => m.nombre.trim()).length ? specMedidas.filter((m) => m.nombre.trim()) : o.medidasSpec,
            insumos: [["Tela cortada (cortes listos para armar)", fmt(c) + " prendas", "Entregados por el taller de corte " + taller.nombre]],
            observaciones: o.observaciones,
          });
          if ((specColores || []).some((c) => c.color.trim()) || (specMedidas || []).some((m) => m.nombre.trim())) guardarEspec();
          enviarPDF(pdfCostura, `orden-confeccion-${o.numero}.pdf`, data.talleres.find((t) => t.id === o.tallerCosturaId), `Orden #${o.numero}: cortes entregados (${fmt(c)} prendas). Orden de confección adjunta.`);
          setEnvC({ ordenId: "", cantidad: "", tipo: "parcial", fecha: hoy() });
        };
        return (
          <Card style={{ borderLeft: `4px solid ${C.indigo}` }}>
            <b>Enviar a costura (por partida)</b>
            {partidas.length === 0 ? (
              <Vacio>No tenés partidas con prendas para enviar.</Vacio>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 8, alignItems: "end", marginTop: 10 }}>
                  <Campo label="N° de partida">
                    <select value={envC.ordenId} onChange={(e) => setEnvC({ ...envC, ordenId: e.target.value })}>
                      <option value="">Elegir…</option>
                      {partidas.map(({ o, k }) => (
                        <option key={o.id} value={o.id}>#{o.numero} — {nombreProducto(data, o.productoId)} (pend.: {fmt(k.enCorte)})</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Cantidad que mando"><input type="number" value={envC.cantidad} onChange={(e) => setEnvC({ ...envC, cantidad: e.target.value })} /></Campo>
                  <Campo label="¿Mando todo o parcial?">
                    <select value={envC.tipo} onChange={(e) => setEnvC({ ...envC, tipo: e.target.value })}>
                      <option value="parcial">Parcial (sigo cortando)</option>
                      <option value="total">Total (termino la partida)</option>
                    </select>
                  </Campo>
                  <Campo label="Fecha"><input type="date" value={envC.fecha} onChange={(e) => setEnvC({ ...envC, fecha: e.target.value })} /></Campo>
                  <BotonP onClick={enviarPartida}>Enviar</BotonP>
                </div>

                {item && (
                  <div style={{ marginTop: 14, background: "#FAF9F5", border: `1px solid ${C.line}`, borderRadius: 8, padding: 12 }}>
                    <b style={{ fontSize: 13 }}>Desglose de colores y cantidades (no toca el stock)</b>
                    {specColores.map((c, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input placeholder="Color" value={c.color} onChange={(e) => { const a = [...specColores]; a[i] = { ...a[i], color: e.target.value }; setSpecColores(a); }} />
                        <input placeholder="Cantidad" type="number" style={{ maxWidth: 120 }} value={c.cantidad} onChange={(e) => { const a = [...specColores]; a[i] = { ...a[i], cantidad: e.target.value }; setSpecColores(a); }} />
                        <BotonS onClick={() => setSpecColores(specColores.filter((_, j) => j !== i))}>✕</BotonS>
                      </div>
                    ))}
                    <BotonS style={{ marginTop: 8 }} onClick={() => setSpecColores([...specColores, { color: "", cantidad: "" }])}>+ Agregar color</BotonS>

                    <div style={{ marginTop: 14 }}>
                      <b style={{ fontSize: 13 }}>Medidas de cada prenda</b>
                      {specMedidas.map((m, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <input placeholder="Pieza (ej: Sábana ajustable)" value={m.nombre} onChange={(e) => { const a = [...specMedidas]; a[i] = { ...a[i], nombre: e.target.value }; setSpecMedidas(a); }} />
                          <input placeholder="Medida (ej: 200cm)" style={{ maxWidth: 160 }} value={m.medida} onChange={(e) => { const a = [...specMedidas]; a[i] = { ...a[i], medida: e.target.value }; setSpecMedidas(a); }} />
                          <BotonS onClick={() => setSpecMedidas(specMedidas.filter((_, j) => j !== i))}>✕</BotonS>
                        </div>
                      ))}
                      <BotonS style={{ marginTop: 8 }} onClick={() => setSpecMedidas([...specMedidas, { nombre: "", medida: "" }])}>+ Agregar medida</BotonS>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <BotonS onClick={guardarEspec}>Guardar especificación</BotonS>
                    </div>
                  </div>
                )}
                {item && Number(envC.cantidad) > 0 && (() => {
                  const c = Number(envC.cantidad);
                  const metros = Number(item.o.metrosEnviados);
                  const consumo = Number(item.o.consumoUsado);
                  const usados = (item.k.cortadas + c) * consumo;
                  const faltan = Math.max(metros - usados, 0);
                  const pct = metros > 0 ? (faltan / metros) * 100 : 0;
                  return (
                    <div style={{ marginTop: 10, background: "#FAF9F5", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px" }}>
                      <b>Antes de confirmar:</b>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 10, marginTop: 8 }}>
                        <div><div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>TELA RECIBIDA</div><b>{fmt(metros)} m</b></div>
                        <div><div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>METROS ENTREGADOS (con este envío)</div><b>{fmt(usados)} m</b></div>
                        <div><div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>METROS FALTANTES</div><b style={{ color: faltan > 0 ? C.bad : C.ok }}>{fmt(faltan)} m</b></div>
                        <div><div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>DESPERDICIO</div><b style={{ color: pct > 4 ? C.bad : C.ok }}>{fmt(pct)} %</b></div>
                        <div><div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>DIFERENCIA SOBRE EL 4%</div><b style={{ color: pct > 4 ? C.bad : C.ok }}>{fmt(Math.max(pct - 4, 0))} %</b></div>
                        <div><div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>PLATA A DESCONTAR</div><b style={{ color: pct > 4 ? C.bad : C.ok }}>{money((metros * Math.max(pct - 4, 0) / 100) * precioTelaDeProducto(data, item.o.productoId))}</b></div>
                      </div>
                    </div>
                  );
                })()}
                {item && envC.tipo === "total" && Number(envC.cantidad) > 0 && Number(envC.cantidad) < item.k.enCorte && (
                  <div style={{ marginTop: 10, background: C.warnBg, borderRadius: 8, padding: "9px 12px", color: C.warn, fontWeight: 600 }}>
                    Vas a cerrar la partida con {fmt(item.k.enCorte - Number(envC.cantidad))} prendas faltantes. El dueño debe aceptarlo. Si el desperdicio de tela pasa el 4%, se descuenta la diferencia.
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })()}

      {tab === "enviar" && !esCorte && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <b>Stock en mi taller (por producto)</b>
            {Object.keys(stockProd).length === 0 ? (
              <Vacio>No tenés prendas disponibles para enviar.</Vacio>
            ) : (
              <div className="tabla" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Producto</th><th>Unidades</th></tr></thead>
                  <tbody>
                    {Object.entries(stockProd).map(([pid, cant]) => (
                      <tr key={pid}><td><b>{nombreProducto(data, pid)}</b></td><td style={{ fontWeight: 800 }}>{fmt(cant)} u.</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {Object.keys(stockProd).length > 0 && (
            <Card style={{ borderLeft: `4px solid ${C.indigo}` }}>
              <b>Enviar a {esCorte ? "costura" : "fábrica"}</b>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 8, alignItems: "end", marginTop: 10 }}>
                <Campo label="Producto">
                  <select value={rapido.productoId} onChange={(e) => setRapido({ ...rapido, productoId: e.target.value })}>
                    <option value="">Elegir…</option>
                    {Object.entries(stockProd).map(([pid, cant]) => (
                      <option key={pid} value={pid}>{nombreProducto(data, pid)} ({fmt(cant)} disp.)</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Cantidad"><input type="number" value={rapido.cantidad} onChange={(e) => setRapido({ ...rapido, cantidad: e.target.value })} /></Campo>
                <Campo label="Fecha"><input type="date" value={rapido.fecha} onChange={(e) => setRapido({ ...rapido, fecha: e.target.value })} /></Campo>
                <BotonP onClick={enviarRapido}>Enviar</BotonP>
              </div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>Se descuenta de tus órdenes más antiguas primero. Nunca podés enviar más de lo que tenés.</div>
            </Card>
          )}
        </>
      )}

      {tab === "stock" && (
        <Card>
          <b>Mercadería en mi taller (por producto)</b>
          {Object.keys(stockProd).length === 0 ? <Vacio>No tenés mercadería ahora.</Vacio> : (
            <div className="tabla" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Producto</th><th>Unidades</th></tr></thead>
                <tbody>
                  {Object.entries(stockProd).map(([pid, cant]) => (
                    <tr key={pid}><td><b>{nombreProducto(data, pid)}</b></td><td style={{ fontWeight: 800 }}>{fmt(cant)} u.</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "descuentos" && esCorte && (
        <Card>
          <b>Descuentos por desperdicio de tela</b>
          {(() => {
            const conDesc = todas.filter(({ o }) => o.corteCerrado && calcDesperdicioOrden(data, o).monto > 0);
            if (conDesc.length === 0) return <Vacio>No tenés descuentos. ¡Bien!</Vacio>;
            const totalDesc = conDesc.reduce((a, { o }) => a + calcDesperdicioOrden(data, o).monto, 0);
            return (
              <div className="tabla" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Partida</th><th>Producto</th><th>Metros entregados</th><th>Metros faltantes</th><th>Faltante más del 4%</th><th>% que faltó</th><th>Monto a descontar</th></tr></thead>
                  <tbody>
                    {conDesc.map(({ o }) => {
                      const d = calcDesperdicioOrden(data, o);
                      return (
                        <tr key={o.id}>
                          <td><b>#{o.numero}</b></td>
                          <td>{nombreProducto(data, o.productoId)}</td>
                          <td>{fmt(d.usados)} m</td>
                          <td style={{ fontWeight: 700 }}>{fmt(d.faltanteTotal)} m</td>
                          <td style={{ color: C.bad, fontWeight: 700 }}>{fmt(d.metrosExceso)} m</td>
                          <td style={{ color: C.bad, fontWeight: 700 }}>{fmt(d.pct)} %</td>
                          <td style={{ color: C.bad, fontWeight: 800 }}>{money(d.monto)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "#FAF9F5" }}><td colSpan={6}><b>TOTAL A DESCONTAR</b></td><td style={{ color: C.bad, fontWeight: 800 }}>{money(totalDesc)}</td></tr>
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Card>
      )}

      {tab === "ordenes" && (
        <>
          {todas.length === 0 && <Card><Vacio>Todavía no tenés órdenes.</Vacio></Card>}
          {todas.slice().reverse().map(({ o, k }) => (
            <Card key={o.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <b>Orden #{o.numero} — {nombreProducto(data, o.productoId)}</b>
                <Chip tipo={k.color}>{k.estado}</Chip>
              </div>
              <BarraHilo k={k} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px,1fr))", gap: 12, margin: "12px 0" }}>
                {esCorte ? (
                  <>
                    <Dato l="A cortar" v={fmt(k.teoricas)} />
                    <Dato l="Enviadas" v={fmt(k.cortadas)} />
                    <Dato l="Pendientes" v={fmt(k.enCorte)} color={C.hilo} />
                    <Dato l="Entrega" v={fFecha(k.fpCorte)} />
                    <Dato l="Desperdicio de tela" v={fmt(k.pctDespTeorico) + " %"} color={k.pctDespTeorico > 10 ? C.bad : C.sub} />
                  </>
                ) : (
                  <>
                    <Dato l="En mi taller" v={fmt(k.enCostura)} color={C.hilo} />
                    <Dato l="Enviadas a fábrica" v={fmt(k.enviadasFabrica)} />
                    <Dato l="Entrega" v={fFecha(k.fpCostura)} />
                  </>
                )}
              </div>
              {esCorte && (() => {
                const metros = Number(o.metrosEnviados);
                const consumo = Number(o.consumoUsado);
                const usados = k.cortadas * consumo;
                const faltan = Math.max(metros - usados, 0);
                const pct = metros > 0 ? (faltan / metros) * 100 : 0;
                return (
                  <div style={{ background: "#FAF9F5", border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 13 }}>
                    Tela que me entregaron: <b>{fmt(metros)} m</b> · Entregué en prendas: <b>{fmt(usados)} m</b> · Faltan: <b style={{ color: faltan > 0 ? C.bad : C.ok }}>{fmt(faltan)} m</b> · {o.corteCerrado ? "Desperdicio" : "Desperdicio si cierro ahora"}: <b style={{ color: pct > 4 ? C.bad : C.ok }}>{fmt(pct)} %</b>
                  </div>
                );
              })()}
              {esCorte && o.cierreCortePropuesto?.estado === "pendiente" && (
                <div style={{ marginBottom: 10 }}><Chip tipo="warn">Pediste cerrar con {fmt(o.cierreCortePropuesto.faltante)} faltantes — esperando al dueño</Chip></div>
              )}
              {esCorte && o.corteCerrado && calcDesperdicioOrden(data, o).monto > 0 && (
                <div style={{ marginBottom: 10 }}><Chip tipo="bad">Descuento por desperdicio: {money(calcDesperdicioOrden(data, o).monto)}</Chip></div>
              )}
              {!esCorte && (
                <table style={{ marginBottom: 10 }}>
                  <thead><tr><th>Entregas del corte</th><th>Cantidad</th><th>Estado</th></tr></thead>
                  <tbody>
                    {(o.entregasCorte || []).length === 0 && <tr><td colSpan={3} style={{ color: C.sub }}>El corte no envió nada todavía.</td></tr>}
                    {(o.entregasCorte || []).map((e, i) => (
                      <tr key={i}><td>{fFecha(e.fecha)}</td><td><b>{fmt(e.cantidad)}</b></td><td><Chip tipo={e.aceptada === false ? "warn" : "ok"}>{e.aceptada === false ? "Por aceptar" : "Aceptada"}</Chip></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <table>
                <thead><tr><th>{esCorte ? "Mis envíos a costura" : "Mis envíos a fábrica"}</th><th>Cantidad</th><th>Estado</th></tr></thead>
                <tbody>
                  {(esCorte ? o.entregasCorte || [] : o.recepciones || []).length === 0 && <tr><td colSpan={3} style={{ color: C.sub }}>Sin envíos todavía.</td></tr>}
                  {(esCorte ? o.entregasCorte || [] : o.recepciones || []).map((e, i) => (
                    <tr key={i}><td>{fFecha(e.fecha)}</td><td><b>{fmt(e.cantidad)}</b></td><td><Chip tipo={e.aceptada === false ? "warn" : "ok"}>{e.aceptada === false ? "Por aceptar" : esCorte ? "Aceptada por costura" : "Aceptada por fábrica"}</Chip></td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </>
      )}

      {tab !== "descuentos" && (
      <Card style={{ marginTop: 16, background: "#FAF9F5" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px,1fr))", gap: 12 }}>
          <Dato l="Órdenes activas" v={fmt(activas.length)} />
          <Dato l="Prendas en mi taller" v={fmt(Object.values(stockProd).reduce((a, b) => a + b, 0))} color={C.hilo} />
          <Dato l="Por aceptar" v={fmt(pendientes.length)} />
          <Dato l="A cobrar" v={money(d.saldo)} color={d.saldo > 0 ? C.bad : C.ok} />
        </div>
      </Card>
      )}
    </div>
  );
}

/* ============ ADMIN: ENVÍOS A CONFIRMAR ============ */
function ConfirmarAdmin({ data, guardar, notificar }) {
  const act = (o, cambios, mov, msg) => {
    const ordenes = data.ordenes.map((x) => (x.id === o.id ? { ...x, ...cambios, movimientos: [...(x.movimientos || []), { fecha: hoy(), detalle: mov }] } : x));
    guardar({ ...data, ordenes });
    notificar(msg);
  };
  const items = [];
  data.ordenes.forEach((o) => {
    const k = calcOrden(o);
    if (o.propuestaReduccion?.estado === "pendiente") items.push({ tipo: "red", o, k });
    if (o.cierreCortePropuesto?.estado === "pendiente") items.push({ tipo: "cierre", o, k });
    (o.entregasCorte || []).forEach((e, i) => { if (e.aceptada === false) items.push({ tipo: "corte", o, e, i }); });
    (o.recepciones || []).forEach((e, i) => { if (e.aceptada === false) items.push({ tipo: "fab", o, e, i }); });
  });
  return (
    <div>
      <Titulo>Envíos y cambios a confirmar</Titulo>
      <Card>
        {items.length === 0 ? <Vacio>No hay nada pendiente de confirmar.</Vacio> : items.map((it, idx) => {
          const { o } = it;
          return (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
              <div>
                <b>Orden #{o.numero}</b> — {nombreProducto(data, o.productoId)}<br />
                {it.tipo === "red" && (
                  <span>El taller de corte <b>{nombreTaller(data, o.tallerCorteId)}</b> propone entregar <b>{fmt(o.propuestaReduccion.cantidad)}</b> prendas en lugar de {fmt(it.k.teoricas)}. Desperdicio resultante: <b style={{ color: C.bad }}>{fmt(((Number(o.metrosEnviados) - o.propuestaReduccion.cantidad * Number(o.consumoUsado)) / Number(o.metrosEnviados)) * 100)}%</b> de la tela.</span>
                )}
                {it.tipo === "cierre" && (() => {
                  const metros = Number(o.metrosEnviados);
                  const usados = it.k.cortadas * Number(o.consumoUsado);
                  const faltanteTotal = Math.max(metros - usados, 0);
                  const pct = metros > 0 ? (faltanteTotal / metros) * 100 : 0;
                  const exceso = Math.max(pct - 4, 0);
                  const metrosExceso = metros > 0 ? (metros * exceso) / 100 : 0;
                  const desc = metrosExceso * precioTelaDeProducto(data, o.productoId);
                  return (
                    <span>
                      El corte <b>{nombreTaller(data, o.tallerCorteId)}</b> quiere cerrar la partida con <b>{fmt(o.cierreCortePropuesto.faltante)} prendas faltantes</b>.<br />
                      Desperdicio de tela: <b style={{ color: pct > 4 ? C.bad : C.ok }}>{fmt(pct)}%</b> (se cobra lo que pasa del 4%: {fmt(metrosExceso)} m).<br />
                      Plata a descontar: <b style={{ color: C.bad }}>{money(desc)}</b>
                    </span>
                  );
                })()}
                {it.tipo === "corte" && <span>Corte → Costura: <b>{fmt(it.e.cantidad)} prendas</b> ({fFecha(it.e.fecha)})</span>}
                {it.tipo === "fab" && <span>Costura → Fábrica: <b>{fmt(it.e.cantidad)} prendas</b> ({fFecha(it.e.fecha)})</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {it.tipo === "red" ? (
                  <>
                    <BotonP onClick={() => act(o, { prendasTeoricas: o.propuestaReduccion.cantidad, propuestaReduccion: { ...o.propuestaReduccion, estado: "aceptada" } }, `Se aceptó la propuesta del corte: la orden pasa a ${fmt(o.propuestaReduccion.cantidad)} prendas.`, "Propuesta aceptada.")}>Aceptar</BotonP>
                    <BotonS style={{ color: C.bad }} onClick={() => act(o, { propuestaReduccion: { ...o.propuestaReduccion, estado: "rechazada" } }, "Se rechazó la propuesta de reducción del corte.", "Propuesta rechazada.")}>Rechazar</BotonS>
                  </>
                ) : it.tipo === "cierre" ? (
                  <>
                    <BotonP onClick={() => {
                      act(o, { corteCerrado: true, faltanteCorte: o.cierreCortePropuesto.faltante, cierreCortePropuesto: { ...o.cierreCortePropuesto, estado: "aceptada" } },
                        `Se aceptó el cierre de corte con ${fmt(o.cierreCortePropuesto.faltante)} faltantes.`,
                        "Cierre aceptado. El descuento se calcula con el precio actual de la tela.");
                    }}>Aceptar</BotonP>
                    <BotonS style={{ color: C.bad }} onClick={() => act(o, { cierreCortePropuesto: { ...o.cierreCortePropuesto, estado: "rechazada" } }, "Se rechazó el cierre con faltante propuesto por el corte.", "Rechazado.")}>Rechazar</BotonS>
                  </>
                ) : it.tipo === "corte" ? (
                  <BotonP onClick={() => act(o, { entregasCorte: o.entregasCorte.map((x, j) => (j === it.i ? { ...x, aceptada: true } : x)) }, `Se aceptó la entrega de ${fmt(it.e.cantidad)} prendas en costura.`, "Aceptado.")}>Aceptar</BotonP>
                ) : (
                  <BotonP onClick={() => act(o, { recepciones: o.recepciones.map((x, j) => (j === it.i ? { ...x, aceptada: true, estado: "OK" } : x)) }, `La fábrica aceptó ${fmt(it.e.cantidad)} prendas de costura.`, "Aceptado. Stock actualizado.")}>Aceptar</BotonP>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/* ============ ADMIN: ENVÍO RÁPIDO ============ */
function EnvioAdmin({ data, guardar, notificar }) {
  const [f, setF] = useState({ flujo: "corte", productoId: "", cantidad: "", fecha: hoy() });
  const stock = {};
  data.ordenes.forEach((o) => {
    const k = calcOrden(o);
    const cerr = f.flujo === "corte" ? o.corteCerrado : o.costuraCerrado;
    const disp = f.flujo === "corte" ? k.enCorte : k.enCostura;
    if (!cerr && disp > 0) stock[o.productoId] = (stock[o.productoId] || 0) + disp;
  });
  const enviar = () => {
    const c = Number(f.cantidad);
    const disp = stock[f.productoId] || 0;
    if (!f.productoId) return notificar("Elegí un producto.");
    if (!c || c <= 0) return notificar("Cantidad inválida.");
    if (c > disp) return notificar(`Solo hay ${fmt(disp)} unidades disponibles.`);
    let resto = c;
    let ordenRef = null;
    const ordenes = data.ordenes.map((o) => {
      if (resto <= 0 || o.productoId !== f.productoId) return o;
      const k = calcOrden(o);
      if (f.flujo === "corte") {
        if (o.corteCerrado || k.enCorte <= 0) return o;
        const q = Math.min(resto, k.enCorte); resto -= q;
        if (!ordenRef) ordenRef = o;
        return { ...o, entregasCorte: [...(o.entregasCorte || []), { fecha: f.fecha, cantidad: q, aceptada: false }], movimientos: [...(o.movimientos || []), { fecha: hoy(), detalle: `El dueño registró envío de ${fmt(q)} prendas de corte a costura (pendiente de aceptación).` }] };
      } else {
        if (o.costuraCerrado || k.enCostura <= 0) return o;
        const q = Math.min(resto, k.enCostura); resto -= q;
        if (!ordenRef) ordenRef = o;
        return { ...o, recepciones: [...(o.recepciones || []), { fecha: f.fecha, cantidad: q, estado: "A revisar", responsable: "Admin", obs: "", aceptada: false }], movimientos: [...(o.movimientos || []), { fecha: hoy(), detalle: `El dueño registró envío de ${fmt(q)} prendas de costura a fábrica (pendiente de aceptación).` }] };
      }
    });
    guardar({ ...data, ordenes });
    notificar(`Envío de ${fmt(c)} prendas registrado. Queda pendiente de aceptación.`);
    if (ordenRef) {
      const prod = data.productos.find((x) => x.id === f.productoId) || {};
      if (f.flujo === "corte") {
        const pdfCostura = pdfOrden({
          numero: ordenRef.numero, fecha: fFecha(f.fecha), fechaEntrega: fFecha(ordenRef.fechaPrometidaCostura || ordenRef.fechaPrometida),
          taller: nombreTaller(data, ordenRef.tallerCosturaId), destino: "costura",
          producto: nombreProducto(data, f.productoId), colores: prod.colores, medida: prod.medida,
          cantidad: fmt(c),
          coloresSpec: ordenRef.coloresSpec, medidasSpec: ordenRef.medidasSpec,
          insumos: [["Tela cortada (cortes listos para armar)", fmt(c) + " prendas", "Entregados por el taller de corte " + nombreTaller(data, ordenRef.tallerCorteId)]],
          observaciones: ordenRef.observaciones,
        });
        enviarPDF(pdfCostura, `orden-confeccion-${ordenRef.numero}.pdf`, data.talleres.find((t) => t.id === ordenRef.tallerCosturaId), `Orden #${ordenRef.numero}: cortes entregados (${fmt(c)} prendas). Orden de confección adjunta.`);
      } else {
        const pdfFab = pdfReciboEntrega({
          numero: ordenRef.numero, fecha: fFecha(f.fecha),
          tallerEntrega: nombreTaller(data, ordenRef.tallerCosturaId), recibe: "Fábrica",
          nroRecibo: `#REC-${ordenRef.numero}-Admin`,
          producto: nombreProducto(data, f.productoId), colores: prod.colores,
          cantidad: fmt(c), pendiente: "—",
          observaciones: "Envío registrado por el dueño, pendiente de aceptación.",
        });
        enviarPDF(pdfFab, `recibo-envio-fabrica-${ordenRef.numero}.pdf`, { whatsapp: data.whatsappFabrica }, `Orden #${ordenRef.numero}: envío de ${fmt(c)} prendas a fábrica.`);
      }
    }
    setF({ ...f, cantidad: "" });
  };
  return (
    <div>
      <Titulo>Envío rápido de productos</Titulo>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 8, alignItems: "end" }}>
          <Campo label="Recorrido">
            <select value={f.flujo} onChange={(e) => setF({ ...f, flujo: e.target.value, productoId: "" })}>
              <option value="corte">Corte → Costura</option>
              <option value="costura">Costura → Fábrica</option>
            </select>
          </Campo>
          <Campo label="Producto">
            <select value={f.productoId} onChange={(e) => setF({ ...f, productoId: e.target.value })}>
              <option value="">Elegir…</option>
              {Object.entries(stock).map(([pid, cant]) => <option key={pid} value={pid}>{nombreProducto(data, pid)} ({fmt(cant)} disp.)</option>)}
            </select>
          </Campo>
          <Campo label="Cantidad"><input type="number" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value })} /></Campo>
          <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
          <BotonP onClick={enviar}>Enviar</BotonP>
        </div>
        <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>Se descuenta de las órdenes más antiguas. El envío queda pendiente hasta que se acepte en «Confirmar».</div>
      </Card>
    </div>
  );
}

/* ============ ADMIN: STOCK POR PRODUCTO Y TALLER ============ */
function StockAdmin({ data }) {
  const filas = {};
  data.ordenes.forEach((o) => {
    const k = calcOrden(o);
    const p = filas[o.productoId] || { corte: 0, costura: 0, fabrica: 0 };
    p.corte += k.enCorte;
    p.costura += k.enCostura;
    p.fabrica += k.recibidas;
    filas[o.productoId] = p;
  });
  return (
    <div>
      <Titulo>Stock de mercadería</Titulo>
      <Card style={{ marginBottom: 16 }}>
        <b>Por producto</b>
        {Object.keys(filas).length === 0 ? <Vacio>Sin mercadería en producción.</Vacio> : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Producto</th><th>En corte</th><th>En costura</th><th>En fábrica</th><th>Total</th></tr></thead>
              <tbody>
                {Object.entries(filas).map(([pid, p]) => (
                  <tr key={pid}>
                    <td><b>{nombreProducto(data, pid)}</b></td>
                    <td>{fmt(p.corte)}</td>
                    <td style={{ color: C.hilo, fontWeight: 700 }}>{fmt(p.costura)}</td>
                    <td style={{ color: C.ok, fontWeight: 700 }}>{fmt(p.fabrica)}</td>
                    <td style={{ fontWeight: 800 }}>{fmt(p.corte + p.costura + p.fabrica)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <StockPorTaller data={data} />
    </div>
  );
}

/* ============ BORRADORES (especificación, sin tocar stock) ============ */
function Borradores({ data, guardar, notificar }) {
  const [f, setF] = useState(null);
  const nuevo = () => setF({
    fecha: hoy(), producto: "", especificaciones: "", curvaTalles: "",
    tallerId: "", observaciones: "",
  });
  const salvar = () => {
    if (!f.producto.trim()) return notificar("Poné al menos el nombre del producto.");
    const numero = f.numero || (data.borradores.reduce((m, b) => Math.max(m, b.numero || 0), 0) + 1);
    const borradores = f.id
      ? data.borradores.map((b) => (b.id === f.id ? { ...f, numero } : b))
      : [...data.borradores, { ...f, id: uid(), numero }];
    guardar({ ...data, borradores });
    setF(null);
    notificar(f.id ? "Borrador modificado." : `Borrador #${numero} guardado.`);
  };

  return (
    <div>
      <Titulo extra={<BotonP onClick={nuevo}>+ Nuevo borrador</BotonP>}>Borradores de pedido</Titulo>
      <div style={{ fontSize: 12, color: C.sub, marginBottom: 14 }}>
        Esto es solo una especificación para armar el pedido. No descuenta tela ni afecta el stock.
      </div>

      {f && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.indigo}` }}>
          <b>{f.id ? "Editar borrador" : "Nuevo borrador"}</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10, marginTop: 12 }}>
            <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
            <Campo label="Producto (texto libre) *"><input value={f.producto} onChange={(e) => setF({ ...f, producto: e.target.value })} placeholder="Ej: Remera oversize cuello redondo" /></Campo>
            <Campo label="Taller (opcional)">
              <select value={f.tallerId} onChange={(e) => setF({ ...f, tallerId: e.target.value })}>
                <option value="">Sin definir todavía</option>
                {data.talleres.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Campo>
          </div>
          <div style={{ marginTop: 10 }}>
            <Campo label="Curva de talles (texto libre)">
              <input value={f.curvaTalles} onChange={(e) => setF({ ...f, curvaTalles: e.target.value })} placeholder="Ej: S:10, M:20, L:20, XL:10" />
            </Campo>
          </div>
          <div style={{ marginTop: 10 }}>
            <Campo label="Especificaciones (texto libre)">
              <textarea rows={3} value={f.especificaciones} onChange={(e) => setF({ ...f, especificaciones: e.target.value })} placeholder="Tela, color, terminaciones, detalles de costura, etc." />
            </Campo>
          </div>
          <div style={{ marginTop: 10 }}>
            <Campo label="Observaciones"><input value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Campo>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BotonP onClick={salvar}>Guardar borrador</BotonP>
            <BotonS onClick={() => setF(null)}>Cancelar</BotonS>
          </div>
        </Card>
      )}

      <Card>
        {data.borradores.length === 0 ? (
          <Vacio>Sin borradores todavía. Creá el primero con «+ Nuevo borrador».</Vacio>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {data.borradores.slice().reverse().map((b) => (
              <div key={b.id} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <b>Borrador #{b.numero} — {b.producto}</b>
                  <span style={{ color: C.sub, fontSize: 12 }}>{fFecha(b.fecha)}</span>
                </div>
                {b.curvaTalles && <div style={{ marginTop: 6 }}><b style={{ fontSize: 12, color: C.sub }}>Talles: </b>{b.curvaTalles}</div>}
                {b.especificaciones && <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}><b style={{ fontSize: 12, color: C.sub }}>Especificaciones: </b>{b.especificaciones}</div>}
                {b.tallerId && <div style={{ marginTop: 6, fontSize: 13 }}><b style={{ fontSize: 12, color: C.sub }}>Taller: </b>{nombreTaller(data, b.tallerId)}</div>}
                {b.observaciones && <div style={{ marginTop: 6, fontSize: 13, color: C.sub }}>Obs.: {b.observaciones}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <BotonS style={{ padding: "5px 10px" }} onClick={() => setF({ ...b })}>Editar</BotonS>
                  <BotonBorrar onConfirm={() => { guardar({ ...data, borradores: data.borradores.filter((x) => x.id !== b.id) }); notificar("Borrador borrado."); }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ PANEL ============ */
function Panel({ data, ir }) {
  const st = stockTela(data);
  const kpis = data.ordenes.map((o) => ({ o, k: calcOrden(o) }));
  const activas = kpis.filter(({ k }) => k.estado !== "Finalizado");
  const enCorte = activas.reduce((s, { k }) => s + k.enCorte, 0);
  const enCostura = activas.reduce((s, { k }) => s + k.enCostura, 0);
  const terminadas = kpis.reduce((s, { k }) => s + k.recibidas, 0);
  const atrasadas = kpis.filter(({ k }) => k.color === "bad" && k.estado !== "Finalizado");
  const deudaTotal = data.talleres.reduce((s, t) => s + Math.max(deudaTaller(data, t.id).saldo, 0), 0);
  const pagadoTotal = data.pagos.reduce((s, p) => s + Number(p.monto), 0);
  const despTotal = kpis.reduce((s, { k }) => s + Math.max(k.desperdicio, 0), 0);
  const valorProceso = activas.reduce(
    (s, { o, k }) => s + (k.enCorte + k.enCostura) * (Number(o.precioCorte || 0) + Number(o.precioCostura || 0)),
    0
  );

  const Kpi = ({ label, valor, sub, color }) => (
    <Card style={{ padding: "13px 15px" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: C.sub, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.ink, margin: "3px 0 1px" }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: C.sub }}>{sub}</div>}
    </Card>
  );

  return (
    <div>
      <Titulo>Panel general</Titulo>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 10 }}>
        <Kpi label="Tela disponible" valor={fmt(st.disponible) + " m"} sub={`Comprados: ${fmt(st.comprado)} m`} />
        <Kpi label="Prendas en corte" valor={fmt(enCorte)} />
        <Kpi label="Prendas en costura" valor={fmt(enCostura)} color={C.hilo} />
        <Kpi label="Stock terminado" valor={fmt(terminadas)} color={C.ok} />
        <Kpi label="Órdenes atrasadas" valor={atrasadas.length} color={atrasadas.length ? C.bad : C.ok} />
        <Kpi label="Desperdicio de tela" valor={fmt(despTotal) + " m"} />
        <Kpi label="Deuda a talleres" valor={money(deudaTotal)} color={deudaTotal ? C.bad : C.ok} sub={`Pagado: ${money(pagadoTotal)}`} />
        <Kpi label="Producción en proceso" valor={money(valorProceso)} sub="Valor de trabajo pendiente" />
      </div>

      {atrasadas.length > 0 && (
        <Card style={{ marginTop: 16, borderLeft: `4px solid ${C.bad}` }}>
          <b style={{ color: C.bad }}>⚠ Alertas — trabajos atrasados</b>
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Orden</th><th>Producto</th><th>Prometida</th><th>Atraso</th><th>Estado</th></tr></thead>
              <tbody>
                {atrasadas.map(({ o, k }) => (
                  <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => ir("ordenes", o.id)}>
                    <td><b>#{o.numero}</b></td>
                    <td>{nombreProducto(data, o.productoId)}</td>
                    <td>{fFecha(k.fpCostura)}</td>
                    <td>{k.atraso} días</td>
                    <td><Chip tipo="bad">{k.estado}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card style={{ marginTop: 16 }}>
        <b>Órdenes en curso</b>
        {activas.length === 0 ? (
          <Vacio>No hay órdenes activas. Creá una desde la pestaña «Órdenes».</Vacio>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {activas.map(({ o, k }) => (
              <div key={o.id} onClick={() => ir("ordenes", o.id)} style={{ cursor: "pointer", border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div><b>#{o.numero}</b> · {nombreProducto(data, o.productoId)} · {fmt(k.teoricas)} prendas</div>
                  <Chip tipo={k.color}>{k.estado}</Chip>
                </div>
                <BarraHilo k={k} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <b>Deuda por taller</b>
        {data.talleres.length === 0 ? (
          <Vacio>Todavía no cargaste talleres.</Vacio>
        ) : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Taller</th><th>Devengado</th><th>Pagado</th><th>Saldo</th></tr></thead>
              <tbody>
                {data.talleres.map((t) => {
                  const d = deudaTaller(data, t.id);
                  return (
                    <tr key={t.id}>
                      <td><b>{t.nombre}</b> <span style={{ color: C.sub }}>({t.tipo})</span></td>
                      <td>{money(d.devengado)}</td>
                      <td>{money(d.pagado)}</td>
                      <td style={{ color: d.saldo > 0 ? C.bad : C.ok, fontWeight: 700 }}>{money(d.saldo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const nombreProducto = (data, id) => data.productos.find((p) => p.id === id)?.nombre || "—";
const nombreTaller = (data, id) => data.talleres.find((t) => t.id === id)?.nombre || "—";

/* ============ PRODUCTOS ============ */
function Productos({ data, guardar, notificar }) {
  const [form, setForm] = useState(null);
  const [verHist, setVerHist] = useState(null);
  const [catForm, setCatForm] = useState(null);
  const nuevo = () =>
    setForm({ id: null, codigo: "", nombre: "", medida: "", colores: "", estado: "Activo", consumoTela: "", telaId: "", anchoTela: "", unidad: "metros", precioCorte: "", precioCostura: "", observaciones: "" });
  const guardarTela = () => {
    if (!catForm.nombre || !catForm.precioMetro) return notificar("Completá nombre y precio de la tela.");
    const nombreLimpio = catForm.nombre.trim().toLowerCase();
    const existente = data.telasCatalogo.find(
      (t) => t.nombre.trim().toLowerCase() === nombreLimpio && t.id !== catForm.id
    );
    if (existente) {
      const telasCatalogo = data.telasCatalogo.map((t) => (t.id === existente.id ? { ...existente, proveedor: catForm.proveedor, precioMetro: catForm.precioMetro } : t));
      guardar({ ...data, telasCatalogo });
      setCatForm(null);
      return notificar(`Ya existía "${existente.nombre}". Se actualizó su precio, no se duplicó.`);
    }
    const telasCatalogo = catForm.id
      ? data.telasCatalogo.map((t) => (t.id === catForm.id ? catForm : t))
      : [...data.telasCatalogo, { ...catForm, id: uid() }];
    guardar({ ...data, telasCatalogo });
    setCatForm(null);
    notificar("Tela guardada.");
  };

  const salvar = () => {
    if (!form.codigo || !form.nombre || !form.consumoTela) return notificar("Completá código, nombre y consumo de tela.");
    let productos;
    if (form.id) {
      productos = data.productos.map((p) => {
        if (p.id !== form.id) return p;
        const cambios = [];
        ["codigo", "nombre", "medida", "colores", "estado", "consumoTela", "telaId", "anchoTela", "unidad", "precioCorte", "precioCostura", "observaciones"].forEach((c) => {
          if (String(p[c] ?? "") !== String(form[c] ?? "")) cambios.push(`${c}: "${p[c] ?? ""}" → "${form[c]}"`);
        });
        const historial = cambios.length ? [...(p.historial || []), { fecha: hoy(), detalle: cambios.join(" · ") }] : p.historial || [];
        return { ...form, historial };
      });
      notificar("Producto actualizado.");
    } else {
      productos = [...data.productos, { ...form, id: uid(), historial: [{ fecha: hoy(), detalle: "Alta de producto" }] }];
      notificar("Producto creado.");
    }
    guardar({ ...data, productos });
    setForm(null);
  };

  return (
    <div>
      <Titulo extra={<BotonP onClick={nuevo}>+ Nuevo producto</BotonP>}>Productos</Titulo>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <b>Tipos de tela (nombre y precio por metro)</b>
          <BotonS onClick={() => setCatForm({ id: null, nombre: "", proveedor: "", precioMetro: "" })}>+ Nueva tela</BotonS>
        </div>
        {catForm && (
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 10, background: "#FAF9F5", border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
            <div style={{ width: 200 }}><Campo label="Nombre de la tela"><input value={catForm.nombre} onChange={(e) => setCatForm({ ...catForm, nombre: e.target.value })} placeholder="Ej: Jersey 24/1" /></Campo></div>
            <div style={{ width: 180 }}><Campo label="Proveedor"><input value={catForm.proveedor} onChange={(e) => setCatForm({ ...catForm, proveedor: e.target.value })} /></Campo></div>
            <div style={{ width: 150 }}><Campo label="Precio por metro"><input type="number" step="0.01" value={catForm.precioMetro} onChange={(e) => setCatForm({ ...catForm, precioMetro: e.target.value })} /></Campo></div>
            <BotonP onClick={guardarTela}>Guardar</BotonP>
            <BotonS onClick={() => setCatForm(null)}>Cancelar</BotonS>
          </div>
        )}
        {data.telasCatalogo.length === 0 ? (
          <Vacio>Sin telas cargadas todavía.</Vacio>
        ) : (
          <div className="tabla" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Nombre</th><th>Proveedor</th><th>Precio por metro</th><th>Saldo del proveedor</th><th></th></tr></thead>
              <tbody>
                {data.telasCatalogo.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.nombre}</b></td>
                    <td>{t.proveedor || "—"}</td>
                    <td>{money(t.precioMetro)}</td>
                    <td style={{ color: deudaProveedor(data, t.proveedor || "Sin proveedor").saldo > 0 ? C.bad : C.ok, fontWeight: 700 }}>{money(deudaProveedor(data, t.proveedor || "Sin proveedor").saldo)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <BotonS style={{ padding: "5px 10px" }} onClick={() => setCatForm({ ...t })}>Editar</BotonS>{" "}
                      <BotonBorrar onConfirm={() => { guardar({ ...data, telasCatalogo: data.telasCatalogo.filter((x) => x.id !== t.id) }); notificar("Tela borrada."); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.indigo}` }}>
          <b>{form.id ? "Editar ficha técnica" : "Nueva ficha técnica"}</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10, marginTop: 12 }}>
            <Campo label="Código *"><input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></Campo>
            <Campo label="Nombre *"><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Campo>
            <Campo label="Medida / Talles"><input value={form.medida} onChange={(e) => setForm({ ...form, medida: e.target.value })} placeholder="S, M, L, XL" /></Campo>
            <Campo label="Colores"><input value={form.colores} onChange={(e) => setForm({ ...form, colores: e.target.value })} placeholder="Negro, Blanco…" /></Campo>
            <Campo label="Estado">
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                <option>Activo</option><option>Inactivo</option>
              </select>
            </Campo>
            <Campo label="Consumo de tela por prenda *"><input type="number" step="0.01" value={form.consumoTela} onChange={(e) => setForm({ ...form, consumoTela: e.target.value })} placeholder="2.00" /></Campo>
            <Campo label="Tipo de tela">
              <select value={form.telaId} onChange={(e) => setForm({ ...form, telaId: e.target.value })}>
                <option value="">Elegir…</option>
                {data.telasCatalogo.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({money(t.precioMetro)}/m)</option>)}
              </select>
            </Campo>
            <Campo label="Ancho de tela"><input value={form.anchoTela} onChange={(e) => setForm({ ...form, anchoTela: e.target.value })} placeholder="1,50 m" /></Campo>
            <Campo label="Unidad de medida">
              <select value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })}>
                <option>metros</option><option>kilos</option>
              </select>
            </Campo>
            <Campo label="Precio fijo de corte ($/prenda)"><input type="number" step="0.01" value={form.precioCorte} onChange={(e) => setForm({ ...form, precioCorte: e.target.value })} /></Campo>
            <Campo label="Precio fijo de costura ($/prenda)"><input type="number" step="0.01" value={form.precioCostura} onChange={(e) => setForm({ ...form, precioCostura: e.target.value })} /></Campo>
          </div>
          <div style={{ marginTop: 10 }}>
            <Campo label="Observaciones"><textarea rows={2} value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} /></Campo>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BotonP onClick={salvar}>Guardar</BotonP>
            <BotonS onClick={() => setForm(null)}>Cancelar</BotonS>
          </div>
        </Card>
      )}

      <Card>
        {data.productos.length === 0 ? (
          <Vacio>Todavía no hay productos. Creá el primero con «+ Nuevo producto».</Vacio>
        ) : (
          <div className="tabla">
            <table>
              <thead><tr><th>Código</th><th>Nombre</th><th>Medida</th><th>Consumo</th><th>Tela</th><th>Corte</th><th>Costura</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {data.productos.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.codigo}</b></td>
                    <td>{p.nombre}</td>
                    <td>{p.medida || "—"}</td>
                    <td>{fmt(p.consumoTela)} {p.unidad}/prenda</td>
                    <td>{data.telasCatalogo.find((t) => t.id === p.telaId)?.nombre || "—"}</td>
                    <td>{money(p.precioCorte)}</td>
                    <td>{money(p.precioCostura)}</td>
                    <td><Chip tipo={p.estado === "Activo" ? "ok" : "warn"}>{p.estado}</Chip></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <BotonS onClick={() => setForm({ ...p })} style={{ padding: "5px 10px" }}>Editar</BotonS>{" "}
                      <BotonS onClick={() => setVerHist(verHist === p.id ? null : p.id)} style={{ padding: "5px 10px" }}>Historial</BotonS>{" "}
                      <BotonBorrar onConfirm={() => { guardar({ ...data, productos: data.productos.filter((x) => x.id !== p.id) }); notificar("Producto borrado."); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {verHist && (
          <div style={{ marginTop: 12, background: "#FAF9F5", border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
            <b>Historial de cambios — {nombreProducto(data, verHist)}</b>
            {(data.productos.find((p) => p.id === verHist)?.historial || []).slice().reverse().map((h, i) => (
              <div key={i} style={{ fontSize: 13, marginTop: 6, color: C.sub }}>
                <b style={{ color: C.ink }}>{fFecha(h.fecha)}</b> — {h.detalle}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ TELAS ============ */
function Telas({ data, guardar, notificar }) {
  const [f, setF] = useState(null);
  const [pago, setPago] = useState(null);
  const st = stockTela(data);
  const nuevo = () => setF({ fecha: hoy(), telaId: data.telasCatalogo[0]?.id || "", lote: "", rollo: "", metros: "" });
  const salvar = () => {
    if (!f.telaId || !f.metros) return notificar("Elegí la tela y completá los metros.");
    const numero = f.numero || (data.telas.reduce((m, t) => Math.max(m, t.numero || 0), 0) + 1);
    const telas = f.id ? data.telas.map((t) => (t.id === f.id ? { ...f, numero } : t)) : [...data.telas, { ...f, id: uid(), numero }];
    guardar({ ...data, telas });
    setF(null);
    notificar(f.id ? "Compra modificada." : `Compra #${numero} registrada.`);
  };

  /* Stock disponible por modelo de tela */
  const stockPorTela = data.telasCatalogo.map((t) => {
    const comprado = data.telas.filter((c) => c.telaId === t.id).reduce((s, c) => s + Number(c.metros), 0);
    const enviado = data.ordenes.filter((o) => (data.productos.find((p) => p.id === o.productoId) || {}).telaId === t.id).reduce((s, o) => s + Number(o.metrosEnviados || 0), 0);
    return { ...t, comprado, enviado, disponible: comprado - enviado };
  });
  const guardarPago = () => {
    const monto = Number(pago.monto);
    if (!monto || monto <= 0) return notificar("Ingresá un monto válido.");
    guardar({ ...data, pagosTela: [...(data.pagosTela || []), { ...pago, id: uid(), monto }] });
    setPago(null);
    notificar("Pago registrado.");
  };

  const proveedores = [...new Set(data.telasCatalogo.map((t) => t.proveedor || "Sin proveedor"))];

  return (
    <div>
      <Titulo extra={<BotonP onClick={nuevo}>+ Registrar compra</BotonP>}>Control de tela</Titulo>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px,1fr))", gap: 10, marginBottom: 16 }}>
        <Card><div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>Disponible</div><div style={{ fontSize: 24, fontWeight: 800, color: st.disponible < 0 ? C.bad : C.ink }}>{fmt(st.disponible)} m</div></Card>
        <Card><div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>Comprado</div><div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(st.comprado)} m</div></Card>
        <Card><div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>Enviado a corte</div><div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(st.enviado)} m</div></Card>
      </div>

      {f && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.indigo}` }}>
          <b>{f.id ? "Editar compra" : "Nueva compra de tela"}</b>
          {data.telasCatalogo.length === 0 ? (
            <div style={{ color: C.bad, marginTop: 10 }}>Primero cargá una tela en «Productos → Tipos de tela».</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
                <Campo label="N° de orden"><input value={f.numero || (data.telas.reduce((m, t) => Math.max(m, t.numero || 0), 0) + 1)} disabled /></Campo>
                <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
                <Campo label="Tela *">
                  <select value={f.telaId} onChange={(e) => setF({ ...f, telaId: e.target.value })}>
                    {data.telasCatalogo.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.proveedor || "sin proveedor"})</option>)}
                  </select>
                </Campo>
                <Campo label="N° de lote"><input value={f.lote} onChange={(e) => setF({ ...f, lote: e.target.value })} /></Campo>
                <Campo label="Rollo"><input value={f.rollo} onChange={(e) => setF({ ...f, rollo: e.target.value })} /></Campo>
                <Campo label="Metros *"><input type="number" step="0.01" value={f.metros} onChange={(e) => setF({ ...f, metros: e.target.value })} /></Campo>
              </div>
              <div style={{ marginTop: 10, background: "#FAF9F5", border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 12px", fontSize: 13 }}>
                Precio por metro: <b>{money(precioDeTela(data, f.telaId))}</b> · Total: <b>{money(Number(f.metros || 0) * precioDeTela(data, f.telaId))}</b>
                <div style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>El precio se toma siempre de «Productos → Tipos de tela». Si cambia ahí, se actualiza acá solo.</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <BotonP onClick={salvar}>Guardar compra</BotonP>
                <BotonS onClick={() => setF(null)}>Cancelar</BotonS>
              </div>
            </>
          )}
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <b>Stock disponible por modelo de tela</b>
        {stockPorTela.length === 0 ? <Vacio>Sin telas cargadas.</Vacio> : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Tela</th><th>Comprado</th><th>Enviado a corte</th><th>Disponible</th></tr></thead>
              <tbody>
                {stockPorTela.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.nombre}</b></td>
                    <td>{fmt(t.comprado)} m</td>
                    <td>{fmt(t.enviado)} m</td>
                    <td style={{ fontWeight: 800, color: t.disponible < 0 ? C.bad : C.ok }}>{fmt(t.disponible)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <b>Cuenta corriente por proveedor</b>
        {proveedores.length === 0 ? <Vacio>Sin telas cargadas.</Vacio> : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Proveedor</th><th>Telas</th><th>Comprado</th><th>Pagado</th><th>Saldo</th><th></th></tr></thead>
              <tbody>
                {proveedores.map((prov) => {
                  const d = deudaProveedor(data, prov);
                  const telas = data.telasCatalogo.filter((t) => (t.proveedor || "Sin proveedor") === prov).map((t) => t.nombre).join(", ");
                  return (
                    <tr key={prov}>
                      <td><b>{prov}</b></td>
                      <td style={{ color: C.sub, fontSize: 12 }}>{telas}</td>
                      <td>{money(d.devengado)}</td>
                      <td style={{ color: C.ok }}>{money(d.pagado)}</td>
                      <td style={{ color: d.saldo > 0 ? C.bad : C.ok, fontWeight: 800 }}>{money(d.saldo)}</td>
                      <td><BotonS style={{ padding: "5px 10px" }} onClick={() => setPago({ proveedor: prov, fecha: hoy(), monto: "", obs: "" })}>Pagar</BotonS></td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#FAF9F5" }}>
                  <td colSpan={4}><b>SALDO TOTAL A PROVEEDORES</b></td>
                  <td style={{ fontWeight: 800, color: C.bad }}>{money(proveedores.reduce((s, p) => s + Math.max(deudaProveedor(data, p).saldo, 0), 0))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pago && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.ok}` }}>
          <b>Registrar pago a {pago.proveedor}</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
            <Campo label="Fecha"><input type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} /></Campo>
            <Campo label="Monto *"><input type="number" step="0.01" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></Campo>
            <Campo label="Observaciones"><input value={pago.obs} onChange={(e) => setPago({ ...pago, obs: e.target.value })} /></Campo>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BotonP onClick={guardarPago}>Guardar pago</BotonP>
            <BotonS onClick={() => setPago(null)}>Cancelar</BotonS>
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <b>Historial de pagos a proveedores</b>
        {(data.pagosTela || []).length === 0 ? <Vacio>Sin pagos registrados.</Vacio> : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Monto</th><th>Obs.</th></tr></thead>
              <tbody>
                {data.pagosTela.slice().reverse().map((p) => (
                  <tr key={p.id}>
                    <td>{fFecha(p.fecha)}</td>
                    <td><b>{p.proveedor}</b></td>
                    <td style={{ fontWeight: 700, color: C.ok }}>{money(p.monto)}</td>
                    <td>{p.obs || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <b>Compras registradas</b>
        {data.telas.length === 0 ? (
          <Vacio>Sin compras registradas todavía.</Vacio>
        ) : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>N°</th><th>Fecha</th><th>Tela</th><th>Proveedor</th><th>Lote</th><th>Rollo</th><th>Metros</th><th>$/m</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {data.telas.slice().reverse().map((t) => {
                  const cat = data.telasCatalogo.find((x) => x.id === t.telaId);
                  const precio = precioDeTela(data, t.telaId);
                  return (
                  <tr key={t.id}>
                    <td><b>#{t.numero || "—"}</b></td>
                    <td>{fFecha(t.fecha)}</td>
                    <td><b>{cat?.nombre || "—"}</b></td>
                    <td>{cat?.proveedor || "—"}</td>
                    <td>{t.lote || "—"}</td>
                    <td>{t.rollo || "—"}</td>
                    <td>{fmt(t.metros)} m</td>
                    <td>{money(precio)}</td>
                    <td><b>{money(t.metros * precio)}</b></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <BotonS style={{ padding: "5px 10px" }} onClick={() => setF({ ...t })}>Editar</BotonS>{" "}
                      <BotonBorrar onConfirm={() => { guardar({ ...data, telas: data.telas.filter((x) => x.id !== t.id) }); notificar("Compra borrada."); }} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ TALLERES ============ */
/* ============ TALLERES ============ */
function StockPorTaller({ data }) {
  const mapa = {};
  data.ordenes.forEach((o) => {
    const k = calcOrden(o);
    const sumar = (tallerId, etapa, cant) => {
      if (!cant) return;
      const kk = tallerId + "|" + o.productoId + "|" + etapa;
      mapa[kk] = mapa[kk] || { tallerId, productoId: o.productoId, etapa, cant: 0 };
      mapa[kk].cant += cant;
    };
    sumar(o.tallerCorteId, "Corte", k.enCorte);
    sumar(o.tallerCosturaId, "Costura", k.enCostura);
  });
  const lista = Object.values(mapa).sort((a, b) => b.cant - a.cant);
  return (
    <Card style={{ marginBottom: 16 }}>
      <b>¿Qué hay en cada taller ahora?</b>
      {lista.length === 0 ? (
        <Vacio>Ningún taller tiene prendas en este momento.</Vacio>
      ) : (
        <div className="tabla" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Taller</th><th>Etapa</th><th>Producto</th><th>Cantidad</th></tr></thead>
            <tbody>
              {lista.map((f, i) => (
                <tr key={i}>
                  <td><b>{nombreTaller(data, f.tallerId)}</b></td>
                  <td><Chip tipo={f.etapa === "Corte" ? "warn" : "ok"}>{f.etapa}</Chip></td>
                  <td>{nombreProducto(data, f.productoId)}</td>
                  <td style={{ fontWeight: 800 }}>{fmt(f.cant)} prendas</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Talleres({ data, guardar, notificar }) {
  const [f, setF] = useState(null);
  const [wa, setWa] = useState(data.whatsappFabrica || "");
  const guardarWa = () => { guardar({ ...data, whatsappFabrica: wa }); notificar("WhatsApp de fábrica guardado."); };
  const salvar = () => {
    if (!f.nombre) return notificar("Poné el nombre del taller.");
    const talleres = f.id
      ? data.talleres.map((t) => (t.id === f.id ? f : t))
      : [...data.talleres, { ...f, id: uid() }];
    guardar({ ...data, talleres });
    setF(null);
    notificar("Taller guardado.");
  };
  return (
    <div>
      <Titulo extra={<BotonP onClick={() => setF({ nombre: "", tipo: "corte", contacto: "", whatsapp: "", usuario: "", clave: "" })}>+ Nuevo taller</BotonP>}>Talleres</Titulo>
      <Card style={{ marginBottom: 16 }}>
        <b>WhatsApp de la fábrica (dueño)</b>
        <div style={{ fontSize: 12, color: C.sub, margin: "4px 0 10px" }}>Ahí llegan los avisos cuando costura envía mercadería a fábrica.</div>
        <div style={{ display: "flex", gap: 8, maxWidth: 400 }}>
          <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="54911XXXXXXXX" />
          <BotonP onClick={guardarWa}>Guardar</BotonP>
        </div>
      </Card>
      <StockPorTaller data={data} />
      {f && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.indigo}` }}>
          <b>{f.id ? "Editar taller" : "Nuevo taller"}</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10, marginTop: 12 }}>
            <Campo label="Nombre *"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
            <Campo label="Tipo">
              <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                <option value="corte">Corte</option><option value="costura">Costura</option>
              </select>
            </Campo>
            <Campo label="Contacto"><input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} placeholder="Dirección…" /></Campo>
            <Campo label="WhatsApp (con código de país)"><input value={f.whatsapp || ""} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="54911XXXXXXXX" /></Campo>
            <Campo label="Usuario (para que ingrese a la app)"><input value={f.usuario || ""} onChange={(e) => setF({ ...f, usuario: e.target.value })} placeholder="ej: corte1" /></Campo>
            <Campo label="Contraseña"><input value={f.clave || ""} onChange={(e) => setF({ ...f, clave: e.target.value })} placeholder="ej: 1234" /></Campo>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BotonP onClick={salvar}>Guardar</BotonP>
            <BotonS onClick={() => setF(null)}>Cancelar</BotonS>
          </div>
        </Card>
      )}
      <Card>
        {data.talleres.length === 0 ? (
          <Vacio>Cargá tus talleres de corte y costura para poder crear órdenes.</Vacio>
        ) : (
          <div className="tabla">
            <table>
              <thead><tr><th>Nombre</th><th>Tipo</th><th>WhatsApp</th><th>Usuario</th><th>Saldo adeudado</th><th></th></tr></thead>
              <tbody>
                {data.talleres.map((t) => {
                  const d = deudaTaller(data, t.id);
                  return (
                    <tr key={t.id}>
                      <td><b>{t.nombre}</b></td>
                      <td><Chip tipo={t.tipo === "corte" ? "warn" : "ok"}>{t.tipo === "corte" ? "Corte" : "Costura"}</Chip></td>
                      <td>{t.whatsapp || "—"}</td>
                      <td>{t.usuario || "—"}</td>
                      <td style={{ color: d.saldo > 0 ? C.bad : C.ok, fontWeight: 700 }}>{money(d.saldo)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <BotonS style={{ padding: "5px 10px" }} onClick={() => setF({ ...t })}>Editar</BotonS>{" "}
                        <BotonBorrar onConfirm={() => { guardar({ ...data, talleres: data.talleres.filter((x) => x.id !== t.id) }); notificar("Taller borrado."); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ ÓRDENES (lista + alta) ============ */
function Ordenes({ data, guardar, abrir, notificar }) {
  const [f, setF] = useState(null);
  const [recibo, setRecibo] = useState(null);
  const st = stockTela(data);
  const prodSel = f ? data.productos.find((p) => p.id === f.productoId) : null;
  const teoricas = prodSel && f.metrosEnviados ? Math.floor(Number(f.metrosEnviados) / Number(prodSel.consumoTela)) : 0;
  const stockTelaProd = prodSel && prodSel.telaId ? stockDeTela(data, prodSel.telaId) : 0;
  const nombreTelaProd = prodSel ? (data.telasCatalogo.find((t) => t.id === prodSel.telaId)?.nombre || "sin tela asignada") : "";

  const nuevo = () => {
    if (data.productos.length === 0) return notificar("Primero cargá al menos un producto.");
    if (data.talleres.length === 0) return notificar("Primero cargá tus talleres.");
    const p0 = data.productos[0];
    setF({
      fechaCreacion: hoy(), fechaPrometidaCorte: "", fechaPrometidaCostura: "", productoId: p0?.id || "",
      tallerCorteId: "", tallerCosturaId: "", metrosEnviados: "",
      precioCorte: p0?.precioCorte || "", precioCostura: p0?.precioCostura || "", observaciones: "",
      coloresSpec: [{ color: "", cantidad: "" }],
      medidasSpec: [{ nombre: "", medida: "" }],
    });
  };

  const salvar = () => {
    if (!f.productoId || !f.tallerCorteId || !f.tallerCosturaId || !f.metrosEnviados)
      return notificar("Completá producto, talleres y metros enviados.");
    const p = data.productos.find((x) => x.id === f.productoId);
    const dispTela = p.telaId ? stockDeTela(data, p.telaId) : 0;
    if (Number(f.metrosEnviados) > dispTela)
      return notificar(`No hay suficiente tela "${data.telasCatalogo.find((t) => t.id === p.telaId)?.nombre || ""}". Disponible: ${fmt(dispTela)} m.`);
    const numero = (data.ordenes.reduce((m, o) => Math.max(m, o.numero || 0), 0) || 0) + 1;
    const orden = {
      ...f, id: uid(), numero,
      coloresSpec: (f.coloresSpec || []).filter((c) => c.color.trim()),
      medidasSpec: (f.medidasSpec || []).filter((m) => m.nombre.trim()),
      consumoUsado: Number(p.consumoTela),
      prendasTeoricas: Math.floor(Number(f.metrosEnviados) / Number(p.consumoTela)),
      entregasCorte: [], recepciones: [], metrosReales: "",
      movimientos: [{ fecha: hoy(), detalle: `Orden creada. ${fmt(f.metrosEnviados)} m enviados a ${nombreTaller(data, f.tallerCorteId)}.` }],
    };
    guardar({ ...data, ordenes: [...data.ordenes, orden] });
    const pdfC = pdfOrden({
      numero, fecha: fFecha(f.fechaCreacion), fechaEntrega: fFecha(f.fechaPrometidaCorte),
      taller: nombreTaller(data, f.tallerCorteId), destino: "corte",
      producto: nombreProducto(data, f.productoId), colores: p.colores, medida: p.medida,
      cantidad: fmt(orden.prendasTeoricas),
      coloresSpec: orden.coloresSpec, medidasSpec: orden.medidasSpec,
      insumos: [["Tela para corte", fmt(f.metrosEnviados) + " metros", `Consumo: ${fmt(p.consumoTela)} m/prenda`]],
      observaciones: f.observaciones,
    });
    enviarPDF(pdfC, `orden-${numero}.pdf`, data.talleres.find((t) => t.id === f.tallerCorteId), `Orden #${numero} — ${nombreProducto(data, f.productoId)}. Orden de pedido adjunta.`);
    setF(null);
    notificar(`Orden #${numero} creada. Deberían salir ${fmt(orden.prendasTeoricas)} prendas.`);
  };

  return (
    <div>
      <Titulo extra={<BotonP onClick={nuevo}>+ Nueva orden de corte</BotonP>}>Órdenes de producción</Titulo>

      {f && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.indigo}` }}>
          <b>Nueva orden — envío de tela al taller de corte</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 10, marginTop: 12 }}>
            <Campo label="Producto *">
              <select value={f.productoId} onChange={(e) => {
                const p = data.productos.find((x) => x.id === e.target.value);
                setF({ ...f, productoId: e.target.value, precioCorte: p?.precioCorte || "", precioCostura: p?.precioCostura || "" });
              }}>
                {data.productos.filter((p) => p.estado === "Activo").map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Taller de corte *">
              <select value={f.tallerCorteId} onChange={(e) => setF({ ...f, tallerCorteId: e.target.value })}>
                <option value="">Elegir…</option>
                {data.talleres.filter((t) => t.tipo === "corte").map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Taller de costura *">
              <select value={f.tallerCosturaId} onChange={(e) => setF({ ...f, tallerCosturaId: e.target.value })}>
                <option value="">Elegir…</option>
                {data.talleres.filter((t) => t.tipo === "costura").map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Campo>
            <Campo label={`Metros enviados * (${nombreTelaProd}, disp.: ${fmt(stockTelaProd)} m, ${money(precioTelaDeProducto(data, f.productoId))}/m)`}>
              <input type="number" step="0.01" value={f.metrosEnviados} onChange={(e) => setF({ ...f, metrosEnviados: e.target.value })} />
            </Campo>
            <Campo label="Fecha de envío"><input type="date" value={f.fechaCreacion} onChange={(e) => setF({ ...f, fechaCreacion: e.target.value })} /></Campo>
            <Campo label="Entrega taller de corte"><input type="date" value={f.fechaPrometidaCorte} onChange={(e) => setF({ ...f, fechaPrometidaCorte: e.target.value })} /></Campo>
            <Campo label="Entrega taller de costura"><input type="date" value={f.fechaPrometidaCostura} onChange={(e) => setF({ ...f, fechaPrometidaCostura: e.target.value })} /></Campo>
            <Campo label="Precio corte ($/prenda)"><input type="number" step="0.01" value={f.precioCorte} onChange={(e) => setF({ ...f, precioCorte: e.target.value })} /></Campo>
            <Campo label="Precio costura ($/prenda)"><input type="number" step="0.01" value={f.precioCostura} onChange={(e) => setF({ ...f, precioCostura: e.target.value })} /></Campo>
          </div>
          <div style={{ marginTop: 14 }}>
            <b style={{ fontSize: 13 }}>Colores y cantidades (no afecta el stock, es solo especificación)</b>
            {(f.coloresSpec || []).map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input placeholder="Color (ej: Blanco)" value={c.color} onChange={(e) => {
                  const arr = [...f.coloresSpec]; arr[i] = { ...arr[i], color: e.target.value }; setF({ ...f, coloresSpec: arr });
                }} />
                <input placeholder="Cantidad" type="number" style={{ maxWidth: 120 }} value={c.cantidad} onChange={(e) => {
                  const arr = [...f.coloresSpec]; arr[i] = { ...arr[i], cantidad: e.target.value }; setF({ ...f, coloresSpec: arr });
                }} />
                <BotonS onClick={() => setF({ ...f, coloresSpec: f.coloresSpec.filter((_, j) => j !== i) })}>✕</BotonS>
              </div>
            ))}
            <BotonS style={{ marginTop: 8 }} onClick={() => setF({ ...f, coloresSpec: [...(f.coloresSpec || []), { color: "", cantidad: "" }] })}>+ Agregar color</BotonS>
          </div>

          <div style={{ marginTop: 14 }}>
            <b style={{ fontSize: 13 }}>Medidas por pieza (ej: Sábana plana 250cm, Funda 50x80cm)</b>
            {(f.medidasSpec || []).map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input placeholder="Pieza (ej: Sábana ajustable)" value={m.nombre} onChange={(e) => {
                  const arr = [...f.medidasSpec]; arr[i] = { ...arr[i], nombre: e.target.value }; setF({ ...f, medidasSpec: arr });
                }} />
                <input placeholder="Medida (ej: 200cm)" style={{ maxWidth: 160 }} value={m.medida} onChange={(e) => {
                  const arr = [...f.medidasSpec]; arr[i] = { ...arr[i], medida: e.target.value }; setF({ ...f, medidasSpec: arr });
                }} />
                <BotonS onClick={() => setF({ ...f, medidasSpec: f.medidasSpec.filter((_, j) => j !== i) })}>✕</BotonS>
              </div>
            ))}
            <BotonS style={{ marginTop: 8 }} onClick={() => setF({ ...f, medidasSpec: [...(f.medidasSpec || []), { nombre: "", medida: "" }] })}>+ Agregar medida</BotonS>
          </div>

          <div style={{ marginTop: 10 }}>
            <Campo label="Observaciones"><textarea rows={2} value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></Campo>
          </div>
          {prodSel && f.metrosEnviados > 0 && (
            <div style={{ marginTop: 10, background: C.okBg, color: C.ok, borderRadius: 8, padding: "9px 12px", fontWeight: 600 }}>
              Con {fmt(f.metrosEnviados)} m y un consumo de {fmt(prodSel.consumoTela)} m/prenda → deberían salir <b>{fmt(teoricas)} prendas</b>.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BotonP onClick={salvar}>Crear orden</BotonP>
            <BotonS onClick={() => setF(null)}>Cancelar</BotonS>
          </div>
        </Card>
      )}

      <Card>
        {data.ordenes.length === 0 ? (
          <Vacio>No hay órdenes todavía. Empezá enviando tela a un taller de corte.</Vacio>
        ) : (
          <div className="tabla">
            <table>
              <thead><tr><th>#</th><th>Producto</th><th>Corte</th><th>Costura</th><th>Metros</th><th>Teóricas</th><th>Avance</th><th>Prometida</th><th>Estado</th></tr></thead>
              <tbody>
                {data.ordenes.slice().reverse().map((o) => {
                  const k = calcOrden(o);
                  return (
                    <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => abrir(o.id)}>
                      <td><b>#{o.numero}</b></td>
                      <td>{nombreProducto(data, o.productoId)}</td>
                      <td>{nombreTaller(data, o.tallerCorteId)}</td>
                      <td>{nombreTaller(data, o.tallerCosturaId)}</td>
                      <td>{fmt(o.metrosEnviados)} m</td>
                      <td>{fmt(k.teoricas)}</td>
                      <td style={{ minWidth: 160 }}><BarraHilo k={k} /></td>
                      <td>{fFecha(k.fpCostura)}</td>
                      <td><Chip tipo={k.color}>{k.estado}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ReciboWA data={data} recibo={recibo} cerrar={() => setRecibo(null)} />
    </div>
  );
}

/* ============ DETALLE DE ORDEN ============ */
function DetalleOrden({ data, guardar, ordenId, volver, notificar }) {
  const o = data.ordenes.find((x) => x.id === ordenId);
  const [entrega, setEntrega] = useState({ fecha: hoy(), cantidad: "" });
  const [recep, setRecep] = useState({ fecha: hoy(), cantidad: "", estado: "OK", responsable: "", obs: "" });
  const [metrosReales, setMetrosReales] = useState(o?.metrosReales || "");
  const [confirmar, setConfirmar] = useState(null);
  const [recibo, setRecibo] = useState(null);
  const [fechas, setFechas] = useState({
    corte: o?.fechaPrometidaCorte || "",
    costura: o?.fechaPrometidaCostura || o?.fechaPrometida || "",
  });
  if (!o) return <BotonS onClick={volver}>← Volver</BotonS>;
  const k = calcOrden(o);

  const actualizar = (cambios, movimiento, msg) => {
    const ordenes = data.ordenes.map((x) =>
      x.id === o.id
        ? { ...x, ...cambios, movimientos: [...(x.movimientos || []), { fecha: hoy(), detalle: movimiento }] }
        : x
    );
    guardar({ ...data, ordenes });
    notificar(msg);
  };

  const entregaCorte = () => {
    const c = Number(entrega.cantidad);
    if (!c || c <= 0) return notificar("Ingresá una cantidad válida.");
    if (c > k.enCorte) return notificar(`El taller de corte solo tiene ${fmt(k.enCorte)} prendas pendientes. No se puede entregar más.`);
    actualizar(
      { entregasCorte: [...o.entregasCorte, { fecha: entrega.fecha, cantidad: c, aceptada: false }] },
      `Corte entregó ${fmt(c)} prendas a costura (${nombreTaller(data, o.tallerCosturaId)}).`,
      "Entrega de corte registrada."
    );
    const prod = data.productos.find((x) => x.id === o.productoId) || {};
    const pdfCostura = pdfOrden({
      numero: o.numero, fecha: fFecha(entrega.fecha), fechaEntrega: fFecha(k.fpCostura),
      taller: nombreTaller(data, o.tallerCosturaId), destino: "costura",
      producto: nombreProducto(data, o.productoId), colores: prod.colores, medida: prod.medida,
      cantidad: fmt(c),
      esParcial: c < k.enCorte,
      cantidadOriginal: fmt(k.teoricas), cantidadEntregada: fmt(k.cortadas + c), faltanteOrden: fmt(Math.max(k.teoricas - (k.cortadas + c), 0)),
      coloresSpec: o.coloresSpec, medidasSpec: o.medidasSpec,
      insumos: [["Tela cortada (cortes listos para armar)", fmt(c) + " prendas", "Entregados por el taller de corte " + nombreTaller(data, o.tallerCorteId)]],
      observaciones: o.observaciones,
    });
    enviarPDF(pdfCostura, `orden-confeccion-${o.numero}.pdf`, data.talleres.find((t) => t.id === o.tallerCosturaId), `Orden #${o.numero}: cortes entregados (${fmt(c)} prendas). Orden de confección adjunta.`);
    setEntrega({ fecha: hoy(), cantidad: "" });
  };

  const recibir = () => {
    const c = Number(recep.cantidad);
    if (!c || c <= 0) return notificar("Ingresá una cantidad válida.");
    if (c > k.enCostura) return notificar(`El taller de costura solo tiene ${fmt(k.enCostura)} prendas. No se puede recibir más.`);
    actualizar(
      { recepciones: [...o.recepciones, { ...recep, cantidad: c, aceptada: true }] },
      `Fábrica recibió ${fmt(c)} prendas (estado: ${recep.estado}${recep.responsable ? ", resp.: " + recep.responsable : ""}).`,
      "Recepción registrada. Stock actualizado."
    );
    const prodR = data.productos.find((x) => x.id === o.productoId) || {};
    const pdfFab = pdfReciboEntrega({
      numero: o.numero, fecha: fFecha(recep.fecha),
      tallerEntrega: nombreTaller(data, o.tallerCosturaId),
      recibe: recep.responsable || "Fábrica",
      nroRecibo: `#REC-${o.numero}-F${o.recepciones.length + 1}`,
      producto: nombreProducto(data, o.productoId), colores: prodR.colores,
      cantidad: fmt(c), pendiente: fmt(k.enCostura - c),
      observaciones: `Estado de la recepción: ${recep.estado}.${recep.obs ? " " + recep.obs : ""}`,
    });
    enviarPDF(pdfFab, `recibo-recepcion-orden-${o.numero}.pdf`, { whatsapp: data.whatsappFabrica }, `Orden #${o.numero}: recepción en fábrica de ${fmt(c)} prendas.`);
    setRecep({ fecha: hoy(), cantidad: "", estado: "OK", responsable: "", obs: "" });
  };

  const guardarMetros = () => {
    actualizar({ metrosReales }, `Se registraron ${fmt(metrosReales)} m reales utilizados en corte.`, "Consumo real guardado.");
  };

  const [edicion, setEdicion] = useState({ metros: o?.metrosEnviados || "", pCorte: o?.precioCorte || "", pCostura: o?.precioCostura || "" });
  const guardarEdicion = () => {
    const m = Number(edicion.metros);
    if (!m || m <= 0) return notificar("Metros inválidos.");
    const nuevasTeoricas = Math.floor(m / Number(o.consumoUsado));
    actualizar(
      { metrosEnviados: m, precioCorte: edicion.pCorte, precioCostura: edicion.pCostura, prendasTeoricas: nuevasTeoricas },
      `Orden modificada: ${fmt(m)} m enviados (teóricas: ${fmt(nuevasTeoricas)}), precio corte ${money(edicion.pCorte)}, costura ${money(edicion.pCostura)}.`,
      "Orden modificada."
    );
  };

  const borrarOrden = () => {
    guardar({ ...data, ordenes: data.ordenes.filter((x) => x.id !== o.id) });
    notificar("Orden borrada. La tela volvió al stock.");
    volver();
  };

  const guardarFechas = () => {
    actualizar(
      { fechaPrometidaCorte: fechas.corte, fechaPrometidaCostura: fechas.costura },
      `Fechas de entrega: corte ${fFecha(fechas.corte)}, costura ${fFecha(fechas.costura)}.`,
      "Fechas guardadas."
    );
  };

  const cerrarCorte = () => {
    actualizar(
      { corteCerrado: true, faltanteCorte: k.enCorte },
      `Se cerró la etapa de CORTE con ${fmt(k.enCorte)} prendas faltantes.`,
      "Corte cerrado con faltante."
    );
    setConfirmar(null);
  };

  const cerrarCostura = () => {
    actualizar(
      { costuraCerrado: true, faltanteCostura: k.enCostura },
      `Se cerró la etapa de COSTURA con ${fmt(k.enCostura)} prendas faltantes.`,
      "Costura cerrada con faltante."
    );
    setConfirmar(null);
  };

  const exportarOrdenCSV = () => {
    const filas = [
      ["ORDEN", "#" + o.numero],
      ["Producto", nombreProducto(data, o.productoId)],
      ["Taller de corte", nombreTaller(data, o.tallerCorteId)],
      ["Taller de costura", nombreTaller(data, o.tallerCosturaId)],
      ["Fecha creación", o.fechaCreacion], ["Entrega corte", k.fpCorte], ["Entrega costura", k.fpCostura],
      ["Metros enviados", o.metrosEnviados], ["Consumo m/prenda", o.consumoUsado],
      ["Prendas teóricas", k.teoricas], ["Cortadas", k.cortadas],
      ["Recibidas en fábrica", k.recibidas],
      ["Faltante corte", k.faltanteCorte], ["Faltante costura", k.faltanteCostura],
      ["Metros reales", k.metrosReales || ""], ["Desperdicio m", k.metrosReales ? k.desperdicio.toFixed(2) : ""],
      ["Desperdicio %", k.metrosReales ? k.pctDesp.toFixed(1) : ""], ["Estado", k.estado],
      [], ["ENTREGAS DE CORTE", ""], ["Fecha", "Cantidad"],
      ...o.entregasCorte.map((e) => [e.fecha, e.cantidad]),
      [], ["RECEPCIONES EN FÁBRICA", ""], ["Fecha", "Cantidad", "Estado", "Responsable", "Obs."],
      ...o.recepciones.map((e) => [e.fecha, e.cantidad, e.estado, e.responsable || "", e.obs || ""]),
      [], ["MOVIMIENTOS", ""],
      ...(o.movimientos || []).map((m) => [m.fecha, m.detalle]),
    ];
    const csv = filas.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orden-${o.numero}-${hoy()}.csv`;
    a.click();
  };

  const Bloque = ({ titulo, children }) => (
    <Card style={{ marginBottom: 14 }}>
      <b style={{ display: "block", marginBottom: 10 }}>{titulo}</b>
      {children}
    </Card>
  );
  const Dato = ({ l, v, color }) => (
    <div>
      <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: "uppercase" }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || C.ink }}>{v}</div>
    </div>
  );

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <BotonS onClick={volver}>← Volver a órdenes</BotonS>
        <BotonP onClick={exportarOrdenCSV}>Descargar Excel (CSV)</BotonP>
        <BotonS onClick={() => window.print()}>Descargar PDF</BotonS>
        <BotonBorrar onConfirm={borrarOrden} />
      </div>
      <Titulo extra={<Chip tipo={k.color}>{k.estado}</Chip>}>
        Orden #{o.numero} — {nombreProducto(data, o.productoId)}
      </Titulo>

      <Bloque titulo="Resumen">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px,1fr))", gap: 12, marginBottom: 12 }}>
          <Dato l="Metros enviados" v={fmt(o.metrosEnviados) + " m"} />
          <Dato l="Consumo" v={fmt(o.consumoUsado) + " m/prenda"} />
          <Dato l="Prendas teóricas" v={fmt(k.teoricas)} />
          <Dato l="Cortadas" v={fmt(k.cortadas)} />
          <Dato l="En costura" v={fmt(k.enCostura)} color={C.hilo} />
          <Dato l="Recibidas en fábrica" v={fmt(k.recibidas)} color={C.ok} />
          <Dato l="Pendientes de corte" v={fmt(k.enCorte)} />
          <Dato l="Desperdicio de tela" v={fmt(k.pctDespTeorico) + " %"} color={k.pctDespTeorico > 10 ? C.bad : undefined} />
          <Dato l="Entrega corte" v={fFecha(k.fpCorte)} />
          <Dato l="Entrega costura" v={fFecha(k.fpCostura)} color={k.color === "bad" ? C.bad : undefined} />
        </div>
        <BarraHilo k={k} />
        <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ width: 170 }}>
            <Campo label="Cambiar entrega corte">
              <input type="date" value={fechas.corte} onChange={(e) => setFechas({ ...fechas, corte: e.target.value })} />
            </Campo>
          </div>
          <div style={{ width: 170 }}>
            <Campo label="Cambiar entrega costura">
              <input type="date" value={fechas.costura} onChange={(e) => setFechas({ ...fechas, costura: e.target.value })} />
            </Campo>
          </div>
          <BotonS onClick={guardarFechas}>Guardar fechas</BotonS>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          <div style={{ width: 140 }}>
            <Campo label="Metros enviados"><input type="number" step="0.01" value={edicion.metros} onChange={(e) => setEdicion({ ...edicion, metros: e.target.value })} /></Campo>
          </div>
          <div style={{ width: 140 }}>
            <Campo label="Precio corte"><input type="number" step="0.01" value={edicion.pCorte} onChange={(e) => setEdicion({ ...edicion, pCorte: e.target.value })} /></Campo>
          </div>
          <div style={{ width: 140 }}>
            <Campo label="Precio costura"><input type="number" step="0.01" value={edicion.pCostura} onChange={(e) => setEdicion({ ...edicion, pCostura: e.target.value })} /></Campo>
          </div>
          <BotonS onClick={guardarEdicion}>Guardar cambios</BotonS>
        </div>
        {o.observaciones && <div style={{ marginTop: 10, color: C.sub }}>Obs.: {o.observaciones}</div>}
        {((o.coloresSpec && o.coloresSpec.length > 0) || (o.medidasSpec && o.medidasSpec.length > 0)) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            {o.coloresSpec && o.coloresSpec.length > 0 && (
              <div>
                <b style={{ fontSize: 13 }}>Colores y cantidades</b>
                <div style={{ marginTop: 6 }}>
                  {o.coloresSpec.map((c, i) => (
                    <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{c.color}: <b>{fmt(c.cantidad)}</b></div>
                  ))}
                </div>
              </div>
            )}
            {o.medidasSpec && o.medidasSpec.length > 0 && (
              <div>
                <b style={{ fontSize: 13 }}>Medidas por pieza</b>
                <div style={{ marginTop: 6 }}>
                  {o.medidasSpec.map((m, i) => (
                    <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{m.nombre}: <b>{m.medida}</b></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Bloque>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 14 }}>
        <Bloque titulo={`1 · Taller de corte (${nombreTaller(data, o.tallerCorteId)}) → entrega a costura`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }} className="no-print">
            <Campo label="Fecha"><input type="date" value={entrega.fecha} onChange={(e) => setEntrega({ ...entrega, fecha: e.target.value })} /></Campo>
            <Campo label={`Prendas (pend.: ${fmt(k.enCorte)})`}><input type="number" value={entrega.cantidad} onChange={(e) => setEntrega({ ...entrega, cantidad: e.target.value })} /></Campo>
            <BotonP onClick={entregaCorte} disabled={k.enCorte === 0} style={{ opacity: k.enCorte === 0 ? 0.5 : 1 }}>Registrar</BotonP>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Fecha</th><th>Cantidad</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {o.entregasCorte.length === 0 && <tr><td colSpan={4} style={{ color: C.sub }}>Sin entregas todavía.</td></tr>}
              {o.entregasCorte.map((e, i) => (
                <tr key={i}>
                  <td>{fFecha(e.fecha)}</td>
                  <td><b>{fmt(e.cantidad)}</b> prendas</td>
                  <td><Chip tipo={e.aceptada === false ? "warn" : "ok"}>{e.aceptada === false ? "Por aceptar" : "En costura"}</Chip></td>
                  <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                    {e.aceptada === false && (
                      <BotonP style={{ padding: "5px 10px" }} onClick={() => actualizar({ entregasCorte: o.entregasCorte.map((x, j) => (j === i ? { ...x, aceptada: true } : x)) }, `Se aceptó la entrega de ${fmt(e.cantidad)} prendas en costura.`, "Entrega aceptada.")}>Aceptar</BotonP>
                    )}{" "}
                    <BotonBorrar onConfirm={() => actualizar({ entregasCorte: o.entregasCorte.filter((_, j) => j !== i) }, `Se borró la entrega de corte del ${fFecha(e.fecha)} (${fmt(e.cantidad)} prendas).`, "Entrega borrada.")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {o.corteCerrado ? (
            <div style={{ marginTop: 10 }}><Chip tipo="bad">Etapa cerrada — faltante: {fmt(k.faltanteCorte)} prendas</Chip></div>
          ) : k.enCorte > 0 && (
            <div className="no-print" style={{ marginTop: 10 }}>
              {confirmar === "corte" ? (
                <div style={{ background: C.badBg, borderRadius: 8, padding: 10 }}>
                  <b style={{ color: C.bad }}>¿Cerrar corte con {fmt(k.enCorte)} prendas faltantes?</b> No se podrán registrar más entregas.
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={cerrarCorte} style={{ background: C.bad, color: "#fff", padding: "7px 14px", fontWeight: 700 }}>Sí, cerrar</button>
                    <BotonS onClick={() => setConfirmar(null)}>Cancelar</BotonS>
                  </div>
                </div>
              ) : (
                <BotonS onClick={() => setConfirmar("corte")} style={{ color: C.bad }}>Cerrar etapa con faltante</BotonS>
              )}
            </div>
          )}
        </Bloque>

        <Bloque titulo={`2 · Taller de costura (${nombreTaller(data, o.tallerCosturaId)}) → recepción en fábrica`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8 }} className="no-print">
            <Campo label="Fecha"><input type="date" value={recep.fecha} onChange={(e) => setRecep({ ...recep, fecha: e.target.value })} /></Campo>
            <Campo label={`Prendas (en taller: ${fmt(k.enCostura)})`}><input type="number" value={recep.cantidad} onChange={(e) => setRecep({ ...recep, cantidad: e.target.value })} /></Campo>
            <Campo label="Estado">
              <select value={recep.estado} onChange={(e) => setRecep({ ...recep, estado: e.target.value })}>
                <option>OK</option><option>Con fallas</option><option>A revisar</option>
              </select>
            </Campo>
            <Campo label="Responsable"><input value={recep.responsable} onChange={(e) => setRecep({ ...recep, responsable: e.target.value })} /></Campo>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end" }}>
            <div style={{ flex: 1 }}><Campo label="Observaciones"><input value={recep.obs} onChange={(e) => setRecep({ ...recep, obs: e.target.value })} /></Campo></div>
            <BotonP onClick={recibir} disabled={k.enCostura === 0} style={{ opacity: k.enCostura === 0 ? 0.5 : 1 }}>Recibir</BotonP>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Fecha</th><th>Cantidad</th><th>Recepción</th><th>Resp.</th><th></th></tr></thead>
            <tbody>
              {o.recepciones.length === 0 && <tr><td colSpan={5} style={{ color: C.sub }}>Sin recepciones todavía.</td></tr>}
              {o.recepciones.map((e, i) => (
                <tr key={i}>
                  <td>{fFecha(e.fecha)}</td><td><b>{fmt(e.cantidad)}</b></td>
                  <td>{e.aceptada === false ? <Chip tipo="warn">Por aceptar</Chip> : <Chip tipo="ok">Aceptada · {e.estado}</Chip>}</td>
                  <td>{e.responsable || "—"}</td>
                  <td className="no-print" style={{ whiteSpace: "nowrap" }}>
                    {e.aceptada === false && (
                      <BotonP style={{ padding: "5px 10px" }} onClick={() => actualizar({ recepciones: o.recepciones.map((x, j) => (j === i ? { ...x, aceptada: true, estado: "OK" } : x)) }, `La fábrica aceptó ${fmt(e.cantidad)} prendas enviadas por costura.`, "Entrega aceptada. Stock actualizado.")}>Aceptar</BotonP>
                    )}{" "}
                    <BotonBorrar onConfirm={() => actualizar({ recepciones: o.recepciones.filter((_, j) => j !== i) }, `Se borró la recepción del ${fFecha(e.fecha)} (${fmt(e.cantidad)} prendas).`, "Recepción borrada.")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {o.costuraCerrado ? (
            <div style={{ marginTop: 10 }}><Chip tipo="bad">Etapa cerrada — faltante: {fmt(k.faltanteCostura)} prendas</Chip></div>
          ) : k.enCostura > 0 && (
            <div className="no-print" style={{ marginTop: 10 }}>
              {confirmar === "costura" ? (
                <div style={{ background: C.badBg, borderRadius: 8, padding: 10 }}>
                  <b style={{ color: C.bad }}>¿Cerrar costura con {fmt(k.enCostura)} prendas faltantes?</b> No se podrán registrar más recepciones.
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={cerrarCostura} style={{ background: C.bad, color: "#fff", padding: "7px 14px", fontWeight: 700 }}>Sí, cerrar</button>
                    <BotonS onClick={() => setConfirmar(null)}>Cancelar</BotonS>
                  </div>
                </div>
              ) : (
                <BotonS onClick={() => setConfirmar("costura")} style={{ color: C.bad }}>Cerrar etapa con faltante</BotonS>
              )}
            </div>
          )}
        </Bloque>
      </div>

      <Bloque titulo="Desperdicio de tela">
        <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ width: 220 }}>
            <Campo label="Metros reales utilizados por el taller de corte">
              <input type="number" step="0.01" value={metrosReales} onChange={(e) => setMetrosReales(e.target.value)} />
            </Campo>
          </div>
          <BotonP onClick={guardarMetros}>Guardar</BotonP>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 12, marginTop: 12 }}>
          <Dato l="Consumo teórico" v={fmt(k.metrosTeoricos) + " m"} />
          <Dato l="Consumo real" v={k.metrosReales ? fmt(k.metrosReales) + " m" : "—"} />
          <Dato l="Desperdicio" v={k.metrosReales ? fmt(k.desperdicio) + " m" : "—"} color={k.desperdicio > 0 ? C.bad : C.ok} />
          <Dato l="% desperdicio" v={k.metrosReales ? fmt(k.pctDesp) + " %" : "—"} color={k.pctDesp > 10 ? C.bad : k.pctDesp > 5 ? C.warn : C.ok} />
        </div>
      </Bloque>

      <Bloque titulo="Costos de esta orden">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12 }}>
          <Dato l="Corte" v={`${money(o.precioCorte)} × ${fmt(k.cortadas)} = ${money(k.cortadas * (o.precioCorte || 0))}`} />
          <Dato l="Costura" v={`${money(o.precioCostura)} × ${fmt(k.recibidas)} = ${money(k.recibidas * (o.precioCostura || 0))}`} />
          <Dato l="Total devengado" v={money(k.cortadas * (o.precioCorte || 0) + k.recibidas * (o.precioCostura || 0))} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.sub }}>Los pagos a talleres se registran en la pestaña «Pagos».</div>
      </Bloque>

      <ReciboWA data={data} recibo={recibo} cerrar={() => setRecibo(null)} />

      <Bloque titulo="Historial de movimientos (auditoría)">
        {(o.movimientos || []).slice().reverse().map((m, i) => (
          <div key={i} style={{ padding: "7px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
            <b>{fFecha(m.fecha)}</b> — {m.detalle}
          </div>
        ))}
      </Bloque>
    </div>
  );
}

/* ============ PAGOS ============ */
function Pagos({ data, guardar, notificar }) {
  const [f, setF] = useState(null);
  const nuevo = () => {
    if (data.talleres.length === 0) return notificar("Primero cargá talleres.");
    setF({ fecha: hoy(), tallerId: data.talleres[0].id, monto: "", obs: "" });
  };
  const [recibo, setRecibo] = useState(null);
  const salvar = () => {
    if (!f.monto || Number(f.monto) <= 0) return notificar("Ingresá un monto válido.");
    const pagos = f.id ? data.pagos.map((p) => (p.id === f.id ? { ...f, monto: Number(f.monto) } : p)) : [...data.pagos, { ...f, id: uid(), monto: Number(f.monto) }];
    guardar({ ...data, pagos });
    const t = data.talleres.find((x) => x.id === f.tallerId) || {};
    const dPrevio = deudaTaller(data, f.tallerId);
    const monto = Number(f.monto);
    const pdfP = pdfPago({
      nro: "#PAGO-" + (data.pagos.length + 1), fecha: fFecha(f.fecha),
      taller: t.nombre, tipoTaller: t.tipo === "corte" ? "Taller de corte" : "Taller de costura",
      concepto: f.obs || `Pago por servicios de ${t.tipo === "corte" ? "corte" : "confección"}`,
      devengadoTexto: money(dPrevio.devengado),
      pagadoAntesTexto: money(f.id ? dPrevio.pagado - monto : dPrevio.pagado),
      montoTexto: money(monto),
      saldoTexto: money(f.id ? dPrevio.saldo : dPrevio.saldo - monto),
      observaciones: f.obs,
    });
    enviarPDF(pdfP, `comprobante-pago-${t.nombre}.pdf`, t, `Comprobante de pago: ${money(monto)} — ${t.nombre}.`);
    setF(null);
    notificar(f.id ? "Pago modificado." : "Pago registrado.");
  };
  return (
    <div>
      <Titulo extra={<BotonP onClick={nuevo}>+ Registrar pago</BotonP>}>Pagos y deudas</Titulo>

      {f && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${C.indigo}` }}>
          <b>Nuevo pago a taller</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 10, marginTop: 12 }}>
            <Campo label="Taller">
              <select value={f.tallerId} onChange={(e) => setF({ ...f, tallerId: e.target.value })}>
                {data.talleres.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
            <Campo label="Monto *"><input type="number" step="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} /></Campo>
            <Campo label="Observaciones"><input value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></Campo>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <BotonP onClick={salvar}>Guardar pago</BotonP>
            <BotonS onClick={() => setF(null)}>Cancelar</BotonS>
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <b>Estado de cuenta por taller</b>
        {data.talleres.length === 0 ? <Vacio>Sin talleres cargados.</Vacio> : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Taller</th><th>Devengado</th><th>Pagado</th><th>Saldo pendiente</th></tr></thead>
              <tbody>
                {data.talleres.map((t) => {
                  const d = deudaTaller(data, t.id);
                  return (
                    <tr key={t.id}>
                      <td><b>{t.nombre}</b></td>
                      <td>{money(d.devengado)}</td>
                      <td style={{ color: C.ok }}>{money(d.pagado)}</td>
                      <td style={{ color: d.saldo > 0 ? C.bad : C.ok, fontWeight: 700 }}>{money(d.saldo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <b>Descuentos por desperdicio de tela</b>
        {(() => {
          const conDesc = data.ordenes.filter((o) => o.corteCerrado && calcDesperdicioOrden(data, o).monto > 0);
          if (conDesc.length === 0) return <Vacio>Sin descuentos aplicados.</Vacio>;
          const total = conDesc.reduce((a, o) => a + calcDesperdicioOrden(data, o).monto, 0);
          return (
            <div className="tabla" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Taller</th><th>Partida</th><th>% desperdicio</th><th>Metros de más</th><th>Monto a descontar</th></tr></thead>
                <tbody>
                  {conDesc.map((o) => {
                    const d = calcDesperdicioOrden(data, o);
                    return (
                      <tr key={o.id}>
                        <td><b>{nombreTaller(data, o.tallerCorteId)}</b></td>
                        <td>#{o.numero} — {nombreProducto(data, o.productoId)}</td>
                        <td style={{ color: C.bad }}>{fmt(d.pct)} %</td>
                        <td>{fmt(d.metrosExceso)} m</td>
                        <td style={{ color: C.bad, fontWeight: 800 }}>{money(d.monto)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "#FAF9F5" }}><td colSpan={4}><b>TOTAL A DESCONTAR</b></td><td style={{ color: C.bad, fontWeight: 800 }}>{money(total)}</td></tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>

      <Card>
        <b>Historial de pagos</b>
        {data.pagos.length === 0 ? <Vacio>Sin pagos registrados.</Vacio> : (
          <div className="tabla" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Taller</th><th>Monto</th><th>Obs.</th><th></th></tr></thead>
              <tbody>
                {data.pagos.slice().reverse().map((p) => (
                  <tr key={p.id}>
                    <td>{fFecha(p.fecha)}</td>
                    <td><b>{nombreTaller(data, p.tallerId)}</b></td>
                    <td style={{ fontWeight: 700 }}>{money(p.monto)}</td>
                    <td>{p.obs || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <BotonS style={{ padding: "5px 10px" }} onClick={() => setF({ ...p })}>Editar</BotonS>{" "}
                      <BotonBorrar onConfirm={() => { guardar({ ...data, pagos: data.pagos.filter((x) => x.id !== p.id) }); notificar("Pago borrado."); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ReciboWA data={data} recibo={recibo} cerrar={() => setRecibo(null)} />
    </div>
  );
}

/* ============ REPORTES ============ */
function Reportes({ data }) {
  const [fProd, setFProd] = useState("");
  const [fTaller, setFTaller] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const filas = useMemo(() => {
    return data.ordenes
      .filter((o) => (!fProd || o.productoId === fProd))
      .filter((o) => (!fTaller || o.tallerCorteId === fTaller || o.tallerCosturaId === fTaller))
      .filter((o) => (!desde || o.fechaCreacion >= desde) && (!hasta || o.fechaCreacion <= hasta))
      .map((o) => ({ o, k: calcOrden(o) }));
  }, [data, fProd, fTaller, desde, hasta]);

  const exportarCSV = () => {
    const enc = ["Orden", "Producto", "Taller corte", "Taller costura", "Fecha", "Prometida", "Metros enviados", "Prendas teoricas", "Cortadas", "En costura", "Recibidas", "Faltantes", "Metros reales", "Desperdicio m", "Desperdicio %", "Estado"];
    const cuerpo = filas.map(({ o, k }) => [
      "#" + o.numero, nombreProducto(data, o.productoId), nombreTaller(data, o.tallerCorteId), nombreTaller(data, o.tallerCosturaId),
      o.fechaCreacion, k.fpCostura, o.metrosEnviados, k.teoricas, k.cortadas, k.enCostura, k.recibidas, k.faltanteCorte + k.faltanteCostura,
      k.metrosReales || "", k.metrosReales ? k.desperdicio.toFixed(2) : "", k.metrosReales ? k.pctDesp.toFixed(1) : "", k.estado,
    ]);
    const csv = [enc, ...cuerpo].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `reporte-produccion-${hoy()}.csv`;
    a.click();
  };

  return (
    <div>
      <Titulo extra={
        <div className="no-print" style={{ display: "flex", gap: 8 }}>
          <BotonP onClick={exportarCSV}>Exportar a Excel (CSV)</BotonP>
          <BotonS onClick={() => window.print()}>Imprimir / PDF</BotonS>
        </div>
      }>Reportes</Titulo>

      <Card className="no-print" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 10 }}>
          <Campo label="Producto">
            <select value={fProd} onChange={(e) => setFProd(e.target.value)}>
              <option value="">Todos</option>
              {data.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Taller">
            <select value={fTaller} onChange={(e) => setFTaller(e.target.value)}>
              <option value="">Todos</option>
              {data.talleres.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
          <Campo label="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        </div>
      </Card>

      <Card>
        {filas.length === 0 ? <Vacio>No hay órdenes que coincidan con los filtros.</Vacio> : (
          <div className="tabla">
            <table>
              <thead><tr><th>#</th><th>Producto</th><th>Fecha</th><th>Metros</th><th>Teóricas</th><th>Cortadas</th><th>Recibidas</th><th>Desp. %</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.map(({ o, k }) => (
                  <tr key={o.id}>
                    <td><b>#{o.numero}</b></td>
                    <td>{nombreProducto(data, o.productoId)}</td>
                    <td>{fFecha(o.fechaCreacion)}</td>
                    <td>{fmt(o.metrosEnviados)} m</td>
                    <td>{fmt(k.teoricas)}</td>
                    <td>{fmt(k.cortadas)}</td>
                    <td>{fmt(k.recibidas)}</td>
                    <td>{k.metrosReales ? fmt(k.pctDesp) + " %" : "—"}</td>
                    <td><Chip tipo={k.color}>{k.estado}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
