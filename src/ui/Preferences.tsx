import type { Prefs } from './prefs';

export function Preferences(props: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  const { prefs, onChange } = props;
  return (
    <div className="prefs">
      <fieldset className="radio-group">
        <legend>Idioma de las funciones</legend>
        <p className="hint">
          Cómo se escriben las funciones y los fluidos en el editor, el autocompletado, los ejemplos y el asistente. Al cambiarlo, también se traducen tus
          ecuaciones actuales. Los dos idiomas funcionan siempre.
        </p>
        <label>
          <input type="radio" name="pref-lang" checked={prefs.lang === 'es'} onChange={() => onChange({ ...prefs, lang: 'es' })} data-autofocus />
          <span>
            Español <code>entalpia(Agua, T=T1, P=P1)</code>
          </span>
        </label>
        <label>
          <input type="radio" name="pref-lang" checked={prefs.lang === 'en'} onChange={() => onChange({ ...prefs, lang: 'en' })} />
          <span>
            Inglés, como EES <code>enthalpy(Water, T=T1, P=P1)</code>
          </span>
        </label>
      </fieldset>

      <fieldset className="radio-group">
        <legend>Unidades para mostrar resultados</legend>
        <p className="hint">Las que elijas a mano en cada variable se respetan.</p>
        <label>
          <input type="radio" name="pref-units" checked={prefs.units === 'metric'} onChange={() => onChange({ ...prefs, units: 'metric' })} />
          <span>Métrico de ingeniería: °C, kPa, kJ/kg, kW</span>
        </label>
        <label>
          <input type="radio" name="pref-units" checked={prefs.units === 'si'} onChange={() => onChange({ ...prefs, units: 'si' })} />
          <span>SI puro: K, Pa, J/kg, W</span>
        </label>
        <label>
          <input type="radio" name="pref-units" checked={prefs.units === 'english'} onChange={() => onChange({ ...prefs, units: 'english' })} />
          <span>Inglés: °F, psi, Btu/lbm, hp</span>
        </label>
      </fieldset>

      <fieldset className="radio-group">
        <legend>Tema</legend>
        <label>
          <input type="radio" name="pref-theme" checked={prefs.theme === 'auto'} onChange={() => onChange({ ...prefs, theme: 'auto' })} />
          <span>Automático (como tu sistema)</span>
        </label>
        <label>
          <input type="radio" name="pref-theme" checked={prefs.theme === 'light'} onChange={() => onChange({ ...prefs, theme: 'light' })} />
          <span>Claro</span>
        </label>
        <label>
          <input type="radio" name="pref-theme" checked={prefs.theme === 'dark'} onChange={() => onChange({ ...prefs, theme: 'dark' })} />
          <span>Oscuro</span>
        </label>
      </fieldset>
    </div>
  );
}
