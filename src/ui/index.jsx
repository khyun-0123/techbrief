// 테크브리프 기본 부품 (Storybook 「Components」). 값은 tokens.css(--tb-*)에서 가져온다
// 앱 화면(App.css·Admin.css)은 아직 예전 클래스를 쓴다 → 다음 단계에서 이 부품으로 바꿔 끼운다
import './ui.css'

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const sizeClass = size === 'md' ? '' : ` tb-btn-${size}`
  return <button type="button" className={`tb-btn tb-btn-${variant}${sizeClass} ${className}`.trim()} {...props} />
}

// tone: neutral | accent | solid | success | warning, dot: 앞에 점
export function Badge({ tone = 'neutral', dot = false, children }) {
  return <span className={`tb-badge tb-badge-${tone}${dot ? ' tb-badge-dot' : ''}`}>{children}</span>
}

export function Chip({ children, onRemove }) {
  return (
    <span className="tb-chip">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`${children} 삭제`}>
          ×
        </button>
      )}
    </span>
  )
}

// action: 입력칸 오른쪽 버튼 (예: 「추가」)
export function TextField({ id, label, hint, error, action, ...inputProps }) {
  return (
    <div className="tb-field">
      {label && (
        <label className="tb-field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="tb-field-row">
        <input id={id} className="tb-input" aria-invalid={error ? true : undefined} {...inputProps} />
        {action}
      </div>
      {(error || hint) && <span className={error ? 'tb-field-hint error' : 'tb-field-hint'}>{error || hint}</span>}
    </div>
  )
}

// options: [[value, label]]
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="tb-segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange?.(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function Pills({ options, value, onChange, label }) {
  return (
    <div className="tb-pills" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange?.(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="tb-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="tb-switch-track" aria-hidden="true" />
      {label}
    </label>
  )
}

export function Card({ title, desc, action, children }) {
  return (
    <section className="tb-card">
      {(title || action) && (
        <div className="tb-card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {desc && <p className="tb-card-desc">{desc}</p>}
      {children}
    </section>
  )
}

export function StatTile({ label, value, sub }) {
  return (
    <div className="tb-stat">
      <span className="tb-stat-label">{label}</span>
      <span className="tb-stat-value">{value}</span>
      {sub && <span className="tb-stat-sub">{sub}</span>}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tb-tabs" role="tablist">
      {tabs.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange?.(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

// tone: info | success | warning | danger
export function Alert({ tone = 'info', children, action }) {
  return (
    <div className={`tb-alert tb-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span>{children}</span>
      {action}
    </div>
  )
}

export function SaveBar({ count, items = [], onDiscard, onSave, saving }) {
  return (
    <div className="tb-savebar" role="region" aria-label="저장하지 않은 변경">
      <span>
        <strong>저장하지 않은 변경 {count}개</strong>
        {items.length > 0 && ` · ${items.join(', ')}`}
      </span>
      <div className="tb-savebar-actions">
        <Button variant="secondary" size="sm" onClick={onDiscard} disabled={saving}>
          되돌리기
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  )
}

export function Dialog({ title, children, actions }) {
  return (
    <div className="tb-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>
      {children}
      <div className="tb-dialog-actions">{actions}</div>
    </div>
  )
}
