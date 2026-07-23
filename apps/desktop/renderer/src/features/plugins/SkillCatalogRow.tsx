import type React from 'react'
import { Check, Plus, ShieldAlert, ShieldCheck, ShieldX, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import type {
  DesktopSkillAuditStatus,
  DesktopSkillCatalogItem,
} from '../../../shared/types.js'

type Props = {
  installing?: boolean
  skill: DesktopSkillCatalogItem
  onInstall: (skill: DesktopSkillCatalogItem) => void
}

export function SkillCatalogRow({
  installing = false,
  skill,
  onInstall,
}: Props): React.ReactNode {
  return (
    <li className="skill-catalog-row">
      <span aria-hidden="true" className="skill-catalog-row__icon">
        <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </span>

      <div className="skill-catalog-row__content">
        <div className="skill-catalog-row__title-line">
          <h3>{skill.name}</h3>
          {skill.audit ? (
            <span
              className={`plugins-audit-badge is-${skill.audit.status}`}
              title={skill.audit.summary}
            >
              {renderAuditIcon(skill.audit.status)}
              {skill.audit.status}
            </span>
          ) : null}
        </div>
        <p title={`${skill.source} · ${skill.installs.toLocaleString()} installs`}>
          {skill.source} · {skill.installs.toLocaleString()} installs
        </p>
      </div>

      {skill.installed ? (
        <span className="skill-catalog-row__installed">
          <Check aria-hidden="true" size={APP_ICON_SIZE} />
          已添加
        </span>
      ) : (
        <Button
          className="skill-catalog-row__action"
          loading={installing}
          onClick={() => onInstall(skill)}
          size="sm"
          title="添加到 CodePilotX"
          variant="secondary"
        >
          <Plus aria-hidden="true" size={APP_ICON_SIZE} />
          添加
        </Button>
      )}
    </li>
  )
}

function renderAuditIcon(status: DesktopSkillAuditStatus): React.ReactNode {
  if (status === 'pass') {
    return <ShieldCheck aria-hidden="true" size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
  }
  if (status === 'warn') {
    return <ShieldAlert aria-hidden="true" size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
  }
  return <ShieldX aria-hidden="true" size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
}
