import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'

// Plain static content page, same idiom as SettingsFairPlay.jsx — h4.sec headers, no card
// wrapper. Written directly in Spanish rather than through the t() system: legal text needs to
// be exact, not machine-translated or split across locale packs, and the whole audience this
// alpha is actually reaching right now is Spanish-speaking. Reached both signed-out (linked from
// Login.jsx) and signed-in (Settings → Account) — see App.jsx, where this route renders before
// the auth check runs at all, not inside the normal authenticated <Routes>.
//
// Not reviewed by a lawyer — said plainly at the top rather than pretending otherwise. This is
// alpha-stage, small-circle software; treat this as a real-effort draft to operate honestly by,
// not a substitute for actual legal advice before any real commercial launch.
export default function Terms() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>Términos de servicio</h1></div>
    </div>
    <div className="small dim" style={{ margin: '-6px 2px 20px', lineHeight: 1.5 }}>
      Última actualización: septiembre de 2026. Este documento es un borrador redactado de buena fe para la fase de acceso anticipado de Forvia — no ha sido revisado por un abogado y no debe tratarse como asesoría legal definitiva.
    </div>

    <h4 className="sec">1. Quiénes somos y qué es Forvia</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia es una aplicación de seguimiento de entrenamientos, operada por Nebula Systems. Te permite registrar tus sesiones de entrenamiento, tu peso corporal, tu progreso a lo largo del tiempo, y de forma opcional compartir parte de esa actividad con otras personas dentro de la propia app.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia se encuentra actualmente en fase de <strong>acceso anticipado (alpha)</strong>. Esto significa que el servicio está en desarrollo activo: pueden aparecer errores, cambiar funciones sin previo aviso, o interrumpirse temporalmente. El acceso, mientras dure esta fase, es solo por invitación o cuenta creada por un administrador.
    </p>

    <h4 className="sec">2. Tu cuenta</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Para usar la mayoría de las funciones necesitas crear una cuenta con un nombre, un correo electrónico y una contraseña. Eres responsable de mantener tu contraseña en secreto y de todo lo que ocurra en tu cuenta. Si crees que alguien más tiene acceso a ella, cámbiala cuanto antes desde Ajustes o contacta con nosotros.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      También existe un modo invitado, sin cuenta: en ese caso tus datos se quedan únicamente en tu propio dispositivo y no llegan a nuestros servidores en ningún momento.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Puedes eliminar tu cuenta cuando quieras desde Ajustes → Cuenta. Al hacerlo se borran tus datos personales y tu historial de entrenamientos de nuestros servidores.
    </p>

    <h4 className="sec">3. Uso aceptable</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Pedimos que uses Forvia de forma honesta: no falsees entrenamientos con el único fin de manipular tu clasificación o tu nivel, no publiques contenido ofensivo, ilegal o que suplante a otra persona en tu perfil, biografía, comentarios o foto, y no intentes acceder a cuentas ajenas o interferir con el funcionamiento del servicio.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Para proteger la integridad de la clasificación, los entrenamientos registrados pasan por una comprobación automática que detecta valores fuera de lo físicamente razonable (pesos, repeticiones, duración de la sesión). Un entrenamiento marcado por este sistema puede ocultarse temporalmente de tu historial y de tu progreso hasta que se revise; siempre puedes explicar por qué crees que es un error y pedir que se revise a mano.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Podemos suspender o cerrar cuentas que incumplan estas normas de forma clara y repetida.
    </p>

    <h4 className="sec">4. Tu contenido</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Lo que publicas en Forvia (nombre, biografía, foto de perfil, comentarios, entrenamientos que hagas públicos) sigue siendo tuyo. Nos das permiso únicamente para almacenarlo y mostrarlo dentro de la app tal y como la propia función que usaste indica (por ejemplo, un entreno que marcas como público se muestra a las personas que te siguen).
    </p>

    <h4 className="sec">5. Sin garantías</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Al ser software en fase alpha, Forvia se ofrece "tal cual", sin garantía de disponibilidad continua, ausencia de errores, o conservación perfecta de todos los datos. Hacemos lo posible por cuidar tu información, pero en esta fase no podemos garantizar que nunca vaya a haber una pérdida de datos o una interrupción del servicio.
    </p>

    <h4 className="sec">6. Cambios</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Podemos actualizar estos términos mientras el producto evolucione, especialmente durante esta fase alpha. Si el cambio es relevante, avisaremos dentro de la propia app.
    </p>

    <h4 className="sec">7. Contacto</h4>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      Cualquier duda sobre estos términos: <a href="mailto:nebulasystemsinfo@gmail.com">nebulasystemsinfo@gmail.com</a>.
    </p>
  </div>
}
