import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { REPO } from '../../lib/demo.js'

// Same static-page idiom as Terms.jsx/Privacy.jsx — plain Spanish, not through t(), h4.sec
// headers. This one exists specifically to satisfy the AGPLv3's own terms: Forvia is a
// modified version of openGym (see NOTICE.md at the repo root for the full text this page
// summarizes), and the AGPL's network-use clause requires that anyone interacting with a
// hosted copy over the network can get to its Corresponding Source from right here — not
// buried in a README they'd have to already know to look for. The repo link below is that
// requirement, not a nice-to-have.
export default function Licenses() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label="Volver"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>Licencias</h1></div>
    </div>

    <h4 className="sec">Código de Forvia</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      El código de Forvia está publicado bajo la <strong>GNU Affero General Public License v3.0 (AGPLv3)</strong>. Esta licencia te da derecho a ejecutar, estudiar, modificar y redistribuir el código — con la condición de que cualquier versión modificada, incluida una que solo ofrezcas como servicio por red sin distribuir el binario, se publique también bajo AGPLv3 y con su código fuente disponible.
    </p>
    <p className="muted small" style={{ lineHeight: 1.5, marginBottom: 4 }}>
      Código fuente completo, tal y como exige la licencia: <a href={REPO} target="_blank" rel="noopener">{REPO}</a>
    </p>

    <h4 className="sec">Origen: openGym</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Forvia es una continuación de <a href="https://gitlab.com/DuarteSantos8/opengym" target="_blank" rel="noopener">openGym</a>, de Duarte Santos, distribuido bajo la misma AGPLv3. Buena parte del historial de commits, incluida la base original de autenticación, sincronización de datos y panel de administración, proviene directamente de ese proyecto.
    </p>

    <h4 className="sec">Diagramas corporales</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Los contornos musculares de los mapas corporales derivan de <a href="https://github.com/melihcolpan/MuscleMap" target="_blank" rel="noopener">MuscleMap</a>, de Melih Colpan, bajo licencia MIT.
    </p>

    <h4 className="sec">Datos e instrucciones de ejercicios</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Los nombres, atributos e instrucciones de los ejercicios provienen de <a href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noopener">hasaneyldrm/exercises-dataset</a> (licencia MIT), que a su vez redistribuye contenido de ExerciseDB v1, de AscendAPI. Las traducciones a otros idiomas son trabajo propio de Forvia, bajo su misma AGPLv3.
    </p>

    <h4 className="sec">Imágenes y animaciones de ejercicios</h4>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      Las miniaturas y animaciones de los ejercicios no están cubiertas por la licencia MIT anterior ni por la AGPLv3 de Forvia — su titularidad es actualmente objeto de una disputa no resuelta entre las partes que las distribuyen. Forvia no las redistribuye: no forman parte de este repositorio, ni de las imágenes de contenedor publicadas, ni del APK. Se cargan en tiempo de ejecución desde el origen o una CDN. Detalles completos en el <a href={REPO + '/blob/main/NOTICE.md'} target="_blank" rel="noopener">NOTICE.md</a> del repositorio.
    </p>

    <p className="dim small" style={{ marginTop: 20 }}>
      Texto completo de todos los avisos anteriores, con los textos de licencia reproducidos: <a href={REPO + '/blob/main/NOTICE.md'} target="_blank" rel="noopener">NOTICE.md</a>.
    </p>
  </div>
}
