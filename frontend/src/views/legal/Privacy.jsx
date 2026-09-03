import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'

// Same idiom and same reasoning as Terms.jsx (plain static page, hardcoded Spanish, reachable
// before login — see App.jsx). The data practices described here are the real ones this codebase
// actually implements (scrypt password hashing, HttpOnly signed session cookie, IP logging off
// by default, what POST /api/account/delete actually removes) — not generic boilerplate.
export default function Privacy() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>Política de privacidad</h1></div>
    </div>
    <div className="small dim" style={{ margin: '-6px 2px 20px', lineHeight: 1.5 }}>
      Última actualización: septiembre de 2026. Este documento es un borrador redactado de buena fe para la fase de acceso anticipado de Forvia — no ha sido revisado por un abogado y no debe tratarse como asesoría legal definitiva.
    </div>

    <h4 className="sec">1. Responsable del tratamiento</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Nebula Systems es quien opera Forvia y trata tus datos según se describe aquí. Puedes contactar en cualquier momento en <a href="mailto:nebulasystemsinfo@gmail.com">nebulasystemsinfo@gmail.com</a>.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      [Pendiente: NIF/CIF y domicilio fiscal completo de Nebula Systems, a añadir aquí antes de un lanzamiento fuera de la fase de acceso anticipado.]
    </p>

    <h4 className="sec">2. Qué datos guardamos</h4>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>Si creas una cuenta:</p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Nombre, correo electrónico y contraseña (nunca se guarda en texto plano — se almacena únicamente un hash irreversible). De forma opcional: teléfono, foto de perfil, biografía. Tus entrenamientos (ejercicios, series, pesos, repeticiones, duración), tu peso corporal y tus objetivos. Si activas el apartado social: a quién sigues, tus comentarios y reacciones, y si tu perfil es público. Si activas las notificaciones: la suscripción push que tu propio navegador genera (gestionada por el estándar Web Push, no por un servicio publicitario de terceros).
    </p>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>Si usas el modo invitado (sin cuenta):</p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      No guardamos nada en nuestros servidores. Todo se queda en tu propio dispositivo.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>Automáticamente, para todas las cuentas:</p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Un registro interno de actividad (inicios de sesión, acciones de administración) para poder detectar problemas de seguridad. Tu dirección IP <strong>no</strong> se guarda en ese registro por defecto en esta instancia. Si envías un reporte de error desde Ajustes, guardamos el mensaje que escribes y, si has iniciado sesión, tu nombre y correo para poder responderte.
    </p>

    <h4 className="sec">3. Verificación automática de entrenamientos</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Para proteger la integridad de la clasificación y el sistema de niveles, cada entrenamiento se compara automáticamente contra límites físicos razonables (peso, repeticiones, duración de la sesión). Esto ocurre enteramente dentro de Forvia — no se envía ningún dato a un servicio externo para esta comprobación, y nunca se comparte fuera de la app.
    </p>

    <h4 className="sec">4. Para qué usamos tus datos</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Para prestarte el servicio que has pedido: guardar tu historial, calcular tu progreso y nivel, mostrarte tu actividad social si la activas, y enviarte las notificaciones que hayas autorizado. Durante esta fase alpha, también usamos los reportes de error que envías voluntariamente para corregir problemas — nunca para nada distinto de eso.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      <strong>No vendemos ni compartimos tus datos con terceros con fines publicitarios.</strong> No hay rastreadores de publicidad ni analítica de terceros integrados en la app.
    </p>

    <h4 className="sec">5. Dónde vive tu información</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia se aloja en infraestructura propia de Nebula Systems (autoalojado), no en un proveedor de nube de terceros que también tenga acceso a los datos. Si el envío de correo de verificación está activo, el mensaje pasa por el servidor SMTP que Nebula Systems tenga configurado en ese momento.
    </p>

    <h4 className="sec">6. Cuánto tiempo lo guardamos</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Mientras tu cuenta exista. Si la eliminas desde Ajustes → Cuenta, se borran de inmediato tu perfil, tu historial de entrenamientos, tu peso corporal, tus fotos, tus comentarios y reacciones, y a quién seguías. Los registros de auditoría interna asociados pueden conservarse un tiempo limitado por motivos de seguridad, sin que puedan usarse ya para identificarte dentro de la app.
    </p>

    <h4 className="sec">7. Tus derechos</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Puedes acceder, corregir o borrar la mayoría de tus datos tú mismo, en cualquier momento, desde Ajustes — nombre, correo, foto, biografía, peso corporal, entrenamientos individuales, y la cuenta entera. Para cualquier otra solicitud (portabilidad, oposición, o dudas), escribe a <a href="mailto:nebulasystemsinfo@gmail.com">nebulasystemsinfo@gmail.com</a>.
    </p>

    <h4 className="sec">8. Seguridad</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Las contraseñas se cifran con scrypt (nunca se guardan en claro). La sesión se identifica con una cookie firmada, de solo servidor (HttpOnly) y restringida a este sitio (SameSite). Como en cualquier fase alpha, seguimos reforzando la seguridad del servicio de forma continua.
    </p>

    <h4 className="sec">9. Menores</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia no está dirigida a menores de 16 años. [Pendiente: confirmar la edad mínima exacta según a quién se abra el acceso.]
    </p>

    <h4 className="sec">10. Cambios</h4>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      Podemos actualizar esta política mientras el producto evolucione. Si el cambio es relevante, avisaremos dentro de la propia app.
    </p>
  </div>
}
