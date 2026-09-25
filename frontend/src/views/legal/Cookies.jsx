import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'

// Same idiom as Terms.jsx/Privacy.jsx (plain static page, hardcoded Spanish, reachable before
// login — see App.jsx). Forvia sets one cookie of its own (the signed session cookie forvia-core
// issues) plus, once someone has an account and is signed in, Google Analytics' own cookies —
// see frontend/src/lib/analytics.js for exactly when that loads and why account creation (not a
// separate banner) is this project's consent moment for it. localStorage isn't a cookie
// technically, but the same "what does this app store in my browser and why" question applies
// to it, so it's covered here too.
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
      Forvia usa una cookie propia, imprescindible para iniciar sesión, y las cookies de <strong>Google Analytics</strong> una vez tienes una cuenta y has iniciado sesión — nada de publicidad ni rastreo de terceros ajeno a eso. No hay un banner de "aceptar cookies" independiente: como una cuenta es la única forma de entrar en Forvia, el aviso y el enlace a esta misma página aparecen en el propio formulario de creación de cuenta, y crearla es lo que entendemos como tu aceptación.
    </p>

    <h4 className="sec">2. La cookie de sesión (propia, siempre activa)</h4>
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
      Es una cookie <strong>estrictamente necesaria</strong>: sin ella no existe forma de que Forvia sepa que has iniciado sesión. Al no haber modo sin cuenta, no puedes usar Forvia sin ella.
    </p>

    <h4 className="sec">3. Cookies de Google Analytics (solo con cuenta e iniciada sesión)</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Usamos Google Analytics (GA4) para saber qué pantallas se usan y con qué frecuencia, y así mejorar la app. El script <strong>no se carga nunca en la pantalla de acceso</strong> ni antes de tener cuenta — solo empieza a ejecutarse la primera vez que inicias sesión con una cuenta ya creada, momento en el que Google puede colocar estas cookies:
    </p>
    <table className="small muted" style={{ width: '100%', borderCollapse: 'collapse', lineHeight: 1.5, marginBottom: 8 }}>
      <tbody>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Nombre</strong></td><td style={{ paddingBottom: 6 }}><code>_ga</code>, <code>_ga_&lt;id&gt;</code></td></tr>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Para qué</strong></td><td style={{ paddingBottom: 6 }}>Distinguir tu dispositivo de otros y mantener el estado de una sesión de analítica, para que Google Analytics pueda contar visitas y pantallas de forma agregada.</td></tr>
        <tr><td style={{ paddingRight: 10, paddingBottom: 6, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Quién la pone</strong></td><td style={{ paddingBottom: 6 }}>Google — son cookies de terceros aunque técnicamente las escriba el dominio de Forvia (así es como funciona GA4).</td></tr>
        <tr><td style={{ paddingRight: 10, verticalAlign: 'top', whiteSpace: 'nowrap' }}><strong>Duración</strong></td><td>Hasta 2 años, según la configuración estándar de Google Analytics.</td></tr>
      </tbody>
    </table>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Los datos que Analytics recoge (pantallas visitadas, dispositivo y navegador de forma general, aproximación de ubicación por IP) los trata Google como encargado del tratamiento, según sus propias condiciones — puedes leerlas en <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">policies.google.com/privacy</a>. No le pasamos tu nombre, correo, ni ningún dato de entrenamiento: solo actividad de navegación dentro de la app.
    </p>

    <h4 className="sec">4. Lo que no usamos</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Ninguna cookie de publicidad o retargeting, ningún píxel de redes sociales, y ningún rastreador de terceros más allá de Google Analytics.
    </p>

    <h4 className="sec">5. Almacenamiento local del navegador (no es técnicamente una cookie)</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Además de esas cookies, Forvia guarda algunos datos directamente en tu navegador mediante <code>localStorage</code> — una tecnología distinta de las cookies (no viaja con cada petición al servidor) pero con un propósito parecido: recordar cosas entre visitas. En Forvia se usa para una copia local de tu perfil, para que la app cargue al instante sin esperar al servidor, y una marca para no repetirte la animación de "subida de nivel" que ya viste. Nada de esto se envía a Nebula Systems ni a nadie más salvo cuando la propia app sincroniza tu progreso con el servidor como parte normal de su funcionamiento.
    </p>

    <h4 className="sec">6. Cómo controlarlas</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Puedes borrar la cookie <code>gymsid</code>, las de Google Analytics, y los datos de <code>localStorage</code> en cualquier momento desde los ajustes de tu navegador ("Borrar datos del sitio" o equivalente) — el efecto será que se cierra tu sesión. También puedes cerrar sesión de forma normal desde Ajustes → Cuenta, que borra la cookie de sesión sin tocar la configuración del navegador. Como una cuenta es obligatoria para usar Forvia, no ofrecemos un interruptor dentro de la app para mantener la cuenta pero desactivar solo Analytics — si lo prefieres, puedes bloquearlo tú mismo con una extensión de bloqueo de rastreadores o el complemento de inhabilitación que el propio Google ofrece.
    </p>

    <h4 className="sec">7. Más información</h4>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      Para el resto de datos que Forvia guarda (tu perfil, tus entrenamientos, etc., no relacionados con cookies), consulta la <a onClick={e => { e.preventDefault(); nav('/legal/privacy') }} href="/legal/privacy">política de privacidad</a>. Cualquier duda: <a href="mailto:nebulasystemsinfo@gmail.com">nebulasystemsinfo@gmail.com</a>.
    </p>
  </div>
}
