import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { REPO } from '../../lib/demo.js'

// Same static-page idiom as Terms.jsx/Privacy.jsx — plain Spanish, not through t(), h4.sec
// headers. Also still satisfies forvia-core's own AGPLv3 network-use clause on its behalf: that
// service is a continuation of openGym, and anyone interacting with a hosted copy over the
// network needs a way to reach its Corresponding Source right from the app they're using — not
// buried in a README they'd have to already know to look for. The repo link below is that
// requirement, not a nice-to-have; it's also just genuinely where the code lives now.
export default function Licenses() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>Licencias</h1></div>
    </div>

    <h4 className="sec">Código de Forvia (este repositorio)</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      El frontend y el backend de niveles/rachas/social/coach de Forvia están publicados bajo la <strong>PolyForm Noncommercial License 1.0.0</strong>, de Nebula Systems. Puedes ejecutar, estudiar, modificar y redistribuir este código libremente para cualquier fin <strong>no comercial</strong> — uso personal, un gimnasio con su propia instancia privada, investigación, etc. Usarlo como parte de un producto o servicio de pago requiere una licencia comercial aparte de Nebula Systems.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      Código fuente completo: <a href={REPO} target="_blank" rel="noopener">{REPO}</a>
    </p>

    <h4 className="sec">Origen: openGym y forvia-core</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia es una continuación de <a href="https://gitlab.com/DuarteSantos8/opengym" target="_blank" rel="noopener">openGym</a>, de Duarte Santos. La parte que sigue siendo genuinamente el código original de openGym — autenticación, sesiones, cuentas, sincronización de datos, panel de administración base y el catálogo de ejercicios — vive ahora en su propio servicio y repositorio, <a href="https://github.com/Nebula-Syst/forvia-core" target="_blank" rel="noopener">forvia-core</a>, distribuido bajo esa misma AGPLv3 (que exige ejecutar, estudiar, modificar y redistribuir con el código fuente siempre disponible, incluso ofrecido solo como servicio por red). En este mismo repositorio ya no queda código original de openGym.
    </p>

    <h4 className="sec">Iconos de la app</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      La mayoría de los iconos de Forvia son de <a href="https://github.com/tabler/tabler-icons" target="_blank" rel="noopener">Tabler Icons</a>, de Paweł Kuna, bajo licencia MIT. Un puñado de iconos específicos de gimnasio que Tabler no cubre (los distintivos de brazo/abdomen/piernas/dominadas, el disco de peso, la máquina de cable, el guante de boxeo y los dos iconos pequeños de presets de agua) son dibujos propios de Forvia.
    </p>

    <h4 className="sec">Diagramas corporales</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Los contornos musculares de los mapas corporales derivan de <a href="https://github.com/melihcolpan/MuscleMap" target="_blank" rel="noopener">MuscleMap</a>, de Melih Colpan, bajo licencia MIT.
    </p>

    <h4 className="sec">Datos e instrucciones de ejercicios</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Los nombres, atributos e instrucciones de los ejercicios provienen de <a href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noopener">hasaneyldrm/exercises-dataset</a> (licencia MIT), que a su vez redistribuye contenido de ExerciseDB v1, de AscendAPI. Las traducciones a otros idiomas son trabajo propio de Forvia, bajo su propia licencia (PolyForm Noncommercial).
    </p>

    <h4 className="sec">Imágenes y animaciones de ejercicios</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Las miniaturas y animaciones de los ejercicios no están cubiertas por la licencia MIT anterior ni por la licencia propia de Forvia — su titularidad es actualmente objeto de una disputa no resuelta entre las partes que las distribuyen. Forvia no las redistribuye: no forman parte de este repositorio, ni de las imágenes de contenedor publicadas, ni del APK. Se cargan en tiempo de ejecución desde el origen o una CDN. Detalles completos en el <a href={REPO + '/blob/main/NOTICE.md'} target="_blank" rel="noopener">NOTICE.md</a> del repositorio.
    </p>

    <p className="dim small" style={{ marginTop: 20 }}>
      Texto completo de todos los avisos anteriores, con los textos de licencia reproducidos: <a href={REPO + '/blob/main/NOTICE.md'} target="_blank" rel="noopener">NOTICE.md</a>.
    </p>
  </div>
}
