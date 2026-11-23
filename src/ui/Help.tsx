import { FLUID_LIST, HA_FUNCS, PROP_FUNCS } from '../engine';

export function Help() {
  return (
    <div className="help">
      <section className="card">
        <h3>Primeros pasos</h3>
        <ol>
          <li>
            Escribe una ecuación por línea en el panel <b>Ecuaciones</b>, en el orden que quieras. Pon las unidades entre corchetes después de cada número:{' '}
            <code>P1 = 200 [kPa]</code>.
          </li>
          <li>
            Pide propiedades con el nombre de la propiedad, el fluido y dos datos del estado: <code>h1 = enthalpy(Water, T=T1, P=P1)</code>.
          </li>
          <li>
            Pulsa <b>Resolver</b> (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>). Si falta o sobra una ecuación, o algo no cuadra en unidades, aparece un aviso debajo del editor;
            haz clic en él para ir a la línea.
          </li>
          <li>
            En <b>Resultados</b> elige en qué unidades ver cada variable (°C, kPa, kJ/kg…).
          </li>
          <li>
            En <b>Tabla paramétrica</b> agrega una variable de entrada con su rango y las salidas que quieras; luego <b>Calcular tabla</b> y mira la curva en{' '}
            <b>Gráfica</b>.
          </li>
        </ol>
      </section>
      <section className="card">
        <h3>Cómo escribir ecuaciones</h3>
        <ul>
          <li>Una ecuación por línea (o varias separadas por <code>;</code>), <b>en cualquier orden</b>. El programa decide qué resolver primero.</li>
          <li>
            Operadores: <code>+ - * / ^</code> y paréntesis. Los nombres de variables no distinguen mayúsculas: <code>T1</code> y <code>t1</code> son la misma.
          </li>
          <li>
            Comentarios: <code>"entre comillas"</code>, <code>{'{entre llaves}'}</code>, o después de <code>//</code>.
          </li>
          <li>
            Unidades entre corchetes después de un número: <code>P1 = 100 [kPa]</code>, <code>g = 9.81 [m/s^2]</code>, <code>T = 25 [C]</code>. Todo se convierte a SI
            internamente, así que puedes mezclar unidades sin miedo.
          </li>
          <li>
            Para diferencias de temperatura usa <code>[K]</code> o <code>[delta_C]</code>: <code>T2 = T1 + 10 [K]</code>.
          </li>
          <li>
            Atajos: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> o <kbd>F2</kbd> para resolver, <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> para autocompletar.
          </li>
        </ul>
      </section>

      <section className="card">
        <h3>Chequeo de unidades</h3>
        <p>
          El programa deduce las unidades de cada variable a partir de las ecuaciones y te avisa (subrayado amarillo) cuando algo no cuadra, por ejemplo sumar
          una presión con una temperatura, o un número sin unidades que se interpretará en SI (<code>T = 25</code> se toma como 25 K).
        </p>
        <p>En Resultados puedes elegir en qué unidades ver cada variable; las tablas y gráficas usan esas mismas unidades.</p>
      </section>

      <section className="card">
        <h3>Propiedades termodinámicas</h3>
        <p>
          Forma: <code>propiedad(Fluido, entrada1=..., entrada2=...)</code>. Entradas: <code>T</code>, <code>P</code>, <code>h</code>, <code>s</code>,{' '}
          <code>u</code>, <code>v</code>, <code>x</code> (calidad), <code>d</code> (densidad).
        </p>
        <pre>
          {`h1 = enthalpy(Water, T=T1, P=P1)
s2 = entropy(R134a, P=P2, x=1)
T3 = temperature(Air, h=h3, P=P3)
P_s = P_sat(Water, T=100 [C])`}
        </pre>
        <table className="grid compact">
          <tbody>
            {Object.entries(PROP_FUNCS).map(([k, f]) => (
              <tr key={k}>
                <td>
                  <code>{k}</code>
                </td>
                <td>{f.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>Fluidos:</b> {FLUID_LIST.join(', ')} y cualquier otro fluido de CoolProp por su nombre.
        </p>
      </section>

      <section className="card">
        <h3>Aire húmedo (psicrometría)</h3>
        <p>
          Usa el fluido <code>AirH2O</code> con tres entradas entre <code>T</code>, <code>P</code>, <code>R</code> (humedad relativa 0–1), <code>w</code> (relación de
          humedad), <code>B</code> (bulbo húmedo), <code>D</code> (punto de rocío), <code>h</code>.
        </p>
        <pre>{`w = HumRat(AirH2O, T=30 [C], P=1 [atm], R=0.6)`}</pre>
        <table className="grid compact">
          <tbody>
            {Object.entries(HA_FUNCS).map(([k, f]) => (
              <tr key={k}>
                <td>
                  <code>{k}</code>
                </td>
                <td>{f.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Funciones matemáticas</h3>
        <p>
          <code>sqrt exp ln log10 sin cos tan asin acos atan sinh cosh tanh abs min max</code> y la constante <code>pi</code>. Los ángulos van en radianes; escribe{' '}
          <code>30 [deg]</code> para grados.
        </p>
      </section>

      <section className="card">
        <h3>Si no converge</h3>
        <ul>
          <li>Activa “Valores iniciales y límites” en Resultados y pon un valor inicial cercano al esperado.</li>
          <li>Pon límites (por ejemplo calidad entre 0 y 1) para evitar zonas sin sentido físico.</li>
          <li>Revisa el mensaje de error: señala la línea y la variable que dio problemas.</li>
        </ul>
      </section>
      <p className="muted small">Propiedades calculadas con CoolProp (Bell et al., licencia MIT).</p>
    </div>
  );
}
