import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'

// Same idiom as Terms.jsx/Privacy.jsx (plain static page, hardcoded Spanish, reachable before
// login — see App.jsx). Short by design: Forvia sets exactly one cookie (the signed session
// cookie forvia-core issues — see that service's own sessions section) and nothing else that
// needs disclosing under cookie-law rules (no analytics, no advertising, no third-party
// trackers). localStorage isn't a cookie technically, but it's covered here too since the
// same "what does this app store in my browser and why" question applies to it.
export default function Cookies() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>Cookies</h1></div>
    </div>
    <div className="small dim" style={{ margin: '-6px 2px 20px', lineHeight: 1.5 }}>
      Última actualización: septiembre de 2026. Este documento es un borrador redactado de buena fe para la fase de acceso anticipado de Forvia — no ha sido revisado por un abogado y no debe tratarse como asesoría legal definitiva.
    </div>

    <h4 className="sec">1. Resumen</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia usa <strong>una sola cookie</strong>, imprescindible para poder iniciar sesión, y nada más: ninguna cookie de analítica, publicidad o rastreo de terceros. Por eso no verás un banner pidiéndote aceptar cookies — bajo la normativa europea, las cookies estrictamente necesarias para el funcionamiento del servicio no requieren consentimiento previo, solo que te informemos de ellas, que es justo lo que hace esta página.
    </p>

    <h4 className="sec">2. La cookie que usamos</h4>
    <table className="small muted" style={{ width: '100%', borderCollapse: 'collapse', lineHeight: 1.5, marginBottom: 8 }}>
      <tbody>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Nombre</strong></td><td style={{ paddingBottom: 6 }}><code>gymsid</code></td></tr>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Para qué</strong></td><td style={{ paddingBottom: 6 }}>Mantener tu sesión iniciada — identifica tu dispositivo como conectado a tu cuenta, para no pedirte la contraseña en cada pantalla.</td></tr>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Quién la pone</strong></td><td style={{ paddingBottom: 6 }}>Forvia mismo (propia, no de terceros) — concretamente el servicio que gestiona el inicio de sesión.</td></tr>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Duración</strong></td><td style={{ paddingBottom: 6 }}>90 días desde que inicias sesión, o hasta que cierres sesión manualmente (Ajustes → Cuenta → "Cerrar sesión" o "Cerrar sesión en todos los dispositivos").</td></tr>
        <tr><td style={{ paddingRight: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Cómo está protegida</strong></td><td>Firmada (no se puede falsificar su contenido), <code>HttpOnly</code> (invisible para cualquier script, incluido uno malicioso inyectado en la página), <code>Secure</code> cuando el sitio se sirve por HTTPS, y <code>SameSite=Lax</code> (no se envía desde otros sitios web).</td></tr>
      </tbody>
    </table>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Es una cookie <strong>estrictamente necesaria</strong>: sin ella no existe forma de que Forvia sepa que has iniciado sesión, así que no puedes rechazarla y seguir usando una cuenta — la alternativa es el <strong>modo invitado</strong> (ver más abajo), que no usa ninguna cookie en absoluto.
    </p>

    <h4 className="sec">3. Lo que no usamos</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Ninguna cookie de analítica (tipo Google Analytics), ninguna de publicidad o retargeting, y ningún píxel o script de seguimiento de terceros. No hay nada que "compartir tus preferencias de cookies" pueda cambiar, porque no hay nada opcional que activar o desactivar.
    </p>

    <h4 className="sec">4. Almacenamiento local del navegador (no es técnicamente una cookie)</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Además de esa cookie, Forvia guarda algunos datos directamente en tu navegador mediante <code>localStorage</code> — una tecnología distinta de las cookies (no viaja con cada petición al servidor) pero con un propósito parecido: recordar cosas entre visitas. En Forvia se usa para:
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      • Si usas el <strong>modo invitado</strong>: todo tu historial de entrenamientos y peso corporal vive únicamente aquí, en tu dispositivo — nunca llega a nuestros servidores.<br />
      • Si tienes cuenta: una copia local de tu perfil para que la app cargue al instante sin esperar al servidor, y una marca para no repetirte la animación de "subida de nivel" que ya viste.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Nada de esto se envía a Nebula Systems ni a nadie más salvo, con cuenta, cuando la propia app sincroniza tu progreso con el servidor como parte normal de su funcionamiento.
    </p>

    <h4 className="sec">5. Cómo controlarlas</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Puedes borrar la cookie <code>gymsid</code> y los datos de <code>localStorage</code> en cualquier momento desde los ajustes de tu navegador ("Borrar datos del sitio" o equivalente) — el efecto será que se cierra tu sesión (y, en modo invitado, que pierdes tu historial local, ya que ahí es lo único que existe). También puedes cerrar sesión de forma normal desde Ajustes → Cuenta, que borra la cookie sin tener que tocar la configuración del navegador.
    </p>

    <h4 className="sec">6. Más información</h4>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      Para el resto de datos que Forvia guarda (tu perfil, tus entrenamientos, etc., no relacionados con cookies), consulta la <a onClick={e => { e.preventDefault(); nav('/legal/privacy') }} href="/legal/privacy">política de privacidad</a>. Cualquier duda: <a href="mailto:nebulasystemsinfo@gmail.com">nebulasystemsinfo@gmail.com</a>.
    </p>
  </div>
}
