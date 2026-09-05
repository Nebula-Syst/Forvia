import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, dateLocale } from '../../lib/i18n.js'
import { lastBW } from '../../lib/history.js'
import { LB_TO_KG } from '../../lib/recovery.js'
import { bwSheet } from '../../sheets.jsx'
import { ACTIVITY_LEVELS, WEIGHT_GOALS, BMR_FORMULAS, DEFAULT_BMR_FORMULA, formulaNeedsBodyFat, DEFAULT_MACRO_SPLIT, RATE_STEPS_KG, DEFAULT_RATE_KG, missingNutritionInputs, computeNutritionGoals, setMacroSplitPct } from '../../lib/nutrition-goals.js'
import Icon from '../../components/Icon.jsx'
import Ring from '../../components/Ring.jsx'
import { Section, Row, SelectRow, Segmented, Slider, NumberField } from '../../components/ui.jsx'

// Plain input + unit suffix — the Stepper's +/- buttons left too little width for the number
// itself (height/age can be 2-3 digits) and cut it off. Typing a number directly is also just
// faster than repeated taps for these two fields.
function UnitField({ value, onChange, unit }) {
  return <div className="unit-field">
    <NumberField value={value} decimal={false} onChange={onChange} />
    {unit && <span className="dim">{unit}</span>}
  </div>
}

// Labels live here, not in the pure lib module, same split as ACTIVITY_LEVELS (internal
// value strings) vs. what a person actually reads.
const ACTIVITY_LABELS = {
  sedentary: ['Sedentary', 'Little or no exercise'],
  light: ['Light activity', 'Exercise 1–3 days a week'],
  moderate: ['Moderate activity', 'Exercise 3–5 days a week'],
  active: ['Active', 'Exercise 6–7 days a week'],
  very_active: ['Very active', 'Hard exercise, or a physically demanding job'],
}
const GOAL_LABELS = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain weight' }
const MISSING_LABELS = { height: 'Height', age: 'Age', sex: 'Sex', bodyFat: 'Body fat %', activity: 'Activity level', goal: 'Goal', weight: 'Current weight' }

// BMR formula picker — labels/descriptions live here (not lib/nutrition-goals.js, which stays
// pure arithmetic), same split as ACTIVITY_LABELS above.
const FORMULA_LABELS = {
  mifflin: 'Mifflin-St Jeor',
  harris: 'Harris-Benedict',
  katch: 'Katch-McArdle',
  cunningham: 'Cunningham',
  who: 'WHO / FAO / UNU',
}
const FORMULA_INFO = {
  mifflin: {
    tagline: 'Recommended — most accurate for most people',
    desc: 'The formula most modern calorie calculators (including MyFitnessPal) default to. Uses weight, height, age and sex.',
    math: 'Men:   10×weight(kg) + 6.25×height(cm) − 5×age + 5\nWomen: 10×weight(kg) + 6.25×height(cm) − 5×age − 161',
    note: 'Developed in 1990 on a broader, more modern sample than Harris-Benedict — studies since have found it the most reliable for the general population.',
  },
  harris: {
    tagline: 'The classic formula, tends to run a bit higher',
    desc: 'The original 1919 formula (revised in 1984). Uses the same inputs as Mifflin-St Jeor but slightly overestimates for most people.',
    math: 'Men:   88.362 + 13.397×weight(kg) + 4.799×height(cm) − 5.677×age\nWomen: 447.593 + 9.247×weight(kg) + 3.098×height(cm) − 4.330×age',
    note: 'Kept mainly for familiarity — Mifflin-St Jeor is generally considered more accurate today.',
  },
  katch: {
    tagline: 'Best if you know your body-fat %',
    desc: 'Uses lean body mass instead of total weight — no age or sex term. Needs your body-fat % below to work out how much of your weight is lean mass.',
    math: 'BMR = 370 + 21.6 × lean mass(kg)\nlean mass = weight × (1 − body fat% / 100)',
    note: 'More accurate for anyone unusually lean or muscular, where two people of the same height/weight/age can have very different metabolisms. Only as accurate as your body-fat estimate.',
  },
  cunningham: {
    tagline: 'Like Katch-McArdle, tuned for athletes',
    desc: 'Same lean-mass approach as Katch-McArdle with different constants — developed on and mostly cited for athletic populations.',
    math: 'BMR = 500 + 22 × lean mass(kg)\nlean mass = weight × (1 − body fat% / 100)',
    note: 'Tends to estimate higher than Katch-McArdle. Same body-fat-accuracy caveat applies.',
  },
  who: {
    tagline: 'Weight-only, no height needed',
    desc: 'World Health Organization / FAO / UNU equations, banded by age and sex. Uses only weight — no height.',
    math: 'Men 18–30:   15.3×weight + 679\nMen 30–60:   11.6×weight + 879\nMen 60+:     13.5×weight + 487\nWomen 18–30: 14.7×weight + 496\nWomen 30–60: 8.7×weight + 829\nWomen 60+:   10.5×weight + 596',
    note: 'Built for population-level nutrition studies rather than individual coaching — coarser than the others since it ignores height entirely.',
  },
}

function FormulaInfoSheet({ formula }) {
  const info = FORMULA_INFO[formula]
  return <>
    <h3>{FORMULA_LABELS[formula]}</h3>
    <p className="dim small" style={{ margin: '4px 2px 14px' }}>{t(info.desc)}</p>
    <pre className="card" style={{ fontSize: 12.5, lineHeight: 1.6, padding: 14, margin: '0 0 14px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>{info.math}</pre>
    <p className="small dim" style={{ margin: '0 2px' }}>{t(info.note)}</p>
    <div style={{ height: 8 }} />
  </>
}
const openFormulaInfo = formula => useUI.getState().openSheet(() => <FormulaInfoSheet formula={formula} />)

const openFormulaPicker = (current, onPick) => useUI.getState().openSheet(close => (
  <>
    <h3>{t('BMR formula')}</h3>
    <div className="sect-b">
      {BMR_FORMULAS.map(f => (
        <div key={f} className="lrow tap" onClick={() => { close(); onPick(f) }}>
          <span className="lrow-m">
            <span className="lrow-t">{FORMULA_LABELS[f]}</span>
            <span className="lrow-s">{t(FORMULA_INFO[f].tagline)}</span>
          </span>
          <button className="iconbtn" aria-label={t('Formula info')} onClick={ev => { ev.stopPropagation(); openFormulaInfo(f) }}><Icon name="info" /></button>
          {f === current && <Icon name="check" className="lrow-k" />}
        </div>
      ))}
    </div>
    <div style={{ height: 8 }} />
  </>
))

const MACROS = [
  { key: 'proteinG', pctKey: 'proteinPct', label: 'Protein', color: 'var(--blue)', kcalPerG: 4 },
  { key: 'carbsG', pctKey: 'carbsPct', label: 'Carbs', color: 'var(--orange)', kcalPerG: 4 },
  { key: 'fatG', pctKey: 'fatPct', label: 'Fat', color: 'var(--indigo)', kcalPerG: 9 },
]

// MyFitnessPal-style: calories and macro grams are never typed in directly — they're always
// the formula's output for the current personal data, live-applied to nutritionGoals the
// moment every input is present. The only lever a person has is the %-of-calories split
// between the three macros (setMacroSplitPct below), same as MFP's "Goals" macro editor.
export default function SettingsNutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const { update } = useStore()

  const bw = lastBW(S)
  const weightKg = bw ? (S.unit === 'lb' ? Math.round(bw.w * LB_TO_KG * 10) / 10 : bw.w) : null

  const formula = S.bmrFormula || DEFAULT_BMR_FORMULA
  const needsBodyFat = formulaNeedsBodyFat(formula)
  const inputs = { heightCm: S.heightCm, age: S.age, sex: S.body, activityLevel: S.activityLevel, weightGoal: S.weightGoal, weightKg, bodyFatPct: S.bodyFatPct }
  const missing = missingNutritionInputs(inputs, formula)
  const split = S.macroSplit || DEFAULT_MACRO_SPLIT
  const rateKg = S.weightRateKg || DEFAULT_RATE_KG
  const computed = computeNutritionGoals(inputs, split, rateKg, formula)

  // Live auto-apply — no "use these numbers" step. Guarded so it only ever writes when the
  // computed goal actually changed, or every render (S.nutritionGoals itself changing) would
  // re-trigger this effect forever.
  useEffect(() => {
    if (!computed) return
    const g = S.nutritionGoals
    if (g.calories === computed.calories && g.proteinG === computed.proteinG && g.fatG === computed.fatG && g.carbsG === computed.carbsG) return
    update(s => { s.nutritionGoals = { ...computed } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed?.calories, computed?.proteinG, computed?.fatG, computed?.carbsG])

  const setPct = (pctKey, v) => update(s => { s.macroSplit = setMacroSplitPct(s.macroSplit || DEFAULT_MACRO_SPLIT, pctKey, v) })

  return <div className="narrow settings-page">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Nutrition goals')}</h1></div>
    </div>
    <p className="settings-subtitle">{t('Calculated automatically from your data — adjust the macro split below any time.')}</p>

    {missing.length > 0 && (
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 2px 16px', borderColor: 'var(--yellow)' }}>
        <Icon name="warnTriangle" style={{ fontSize: 20, color: 'var(--yellow)', flex: 'none' }} />
        <div className="small">{t('Fill in {0} to calculate your targets.', missing.map(k => t(MISSING_LABELS[k])).join(', '))}</div>
      </div>
    )}

    {computed && (
      <div className="nutgoal-hero card">
        <div className="nutgoal-cals">
          <Ring size={104} stroke={10} pct={1} color="var(--acc)">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{computed.calories}</div>
              <div className="dim" style={{ fontSize: 11 }}>{t('kcal / day')}</div>
            </div>
          </Ring>
        </div>
        <div className="nutgoal-macros">
          {MACROS.map(m => {
            const grams = computed[m.key]
            const pct = split[m.pctKey]
            return <div className="nutgoal-macro-row" key={m.key}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className="row" style={{ gap: 7 }}>
                  <span className="nutgoal-dot" style={{ background: m.color }} />
                  <span style={{ fontWeight: 600 }}>{t(m.label)}</span>
                </span>
                <span className="dim small">{grams}g · {pct}%</span>
              </div>
              <Slider value={pct} min={0} max={100} step={5} onChange={v => setPct(m.pctKey, v)} className="nutgoal-slider" />
            </div>
          })}
        </div>
      </div>
    )}

    <Section title={t('Personal data')} footer={t('Used to calculate your calorie and macro targets above.')}>
      <Row icon="lightbulb" iconTint="var(--acc)" title={t('BMR formula')}
        subtitle={t(FORMULA_INFO[formula].tagline)}
        value={FORMULA_LABELS[formula]} accessory="chevron"
        onClick={() => openFormulaPicker(formula, v => update(s => { s.bmrFormula = v }))} />
      {needsBodyFat && (
        <Row icon="chartLine" iconTint="var(--red)" title={t('Body fat %')}>
          <UnitField value={S.bodyFatPct ?? ''} unit="%" onChange={v => update(s => { s.bodyFatPct = v || null })} />
        </Row>
      )}
      <Row icon="scale" iconTint="var(--teal)" title={t('Height')}>
        <UnitField value={S.heightCm ?? ''} unit="cm" onChange={v => update(s => { s.heightCm = v || null })} />
      </Row>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Age')}>
        <UnitField value={S.age ?? ''} unit={t('yrs')} onChange={v => update(s => { s.age = v || null })} />
      </Row>
      {/* Same field SettingsWorkout's "Body diagram" row writes — sex is one fact about the
          person, not two separate settings that could drift out of sync. */}
      <Row icon="person" iconTint="var(--purple)" title={t('Sex')} subtitle={t('Also used for the muscle-map diagram')}>
        <Segmented className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })} />
      </Row>
      <SelectRow icon="flame" iconTint="var(--pink)" title={t('Activity level')}
        value={S.activityLevel}
        options={ACTIVITY_LEVELS.map(a => ({ value: a.value, label: t(ACTIVITY_LABELS[a.value][0]), subtitle: t(ACTIVITY_LABELS[a.value][1]) }))}
        onChange={v => update(s => { s.activityLevel = v })} />
      {/* SelectRow, not Segmented — Segmented always renders one pill as "on" (it has no
          way to draw "nothing chosen yet"), which would make an unset goal look like
          "Lose weight" was already picked. A sheet with nothing checked says "unset" for real. */}
      <SelectRow icon="target" iconTint="var(--red)" title={t('Goal')}
        value={S.weightGoal}
        options={WEIGHT_GOALS.map(g => ({ value: g, label: t(GOAL_LABELS[g]) }))}
        onChange={v => update(s => { s.weightGoal = v })} />
      {(S.weightGoal === 'lose' || S.weightGoal === 'gain') && (
        <SelectRow icon="bolt" iconTint="var(--yellow)" title={t('Weekly pace')}
          value={rateKg}
          options={RATE_STEPS_KG.map(r => ({
            value: r,
            label: (S.weightGoal === 'lose' ? '-' : '+') + r.toLocaleString(dateLocale(), { maximumFractionDigits: 2 }) + ' kg / ' + t('week'),
            subtitle: r <= 0.5 ? t('Gradual') : r <= 0.75 ? t('Moderate') : t('Aggressive'),
          }))}
          onChange={v => update(s => { s.weightRateKg = v })} />
      )}
      <Row icon="dumbbell" iconTint="var(--green)" title={t('Current weight')}
        subtitle={bw ? null : t('Log a weigh-in first so your targets use a real number.')}
        value={bw ? `${bw.w} ${S.unit}` : null}
        accessory="chevron" onClick={() => bwSheet()} />
    </Section>
  </div>
}
