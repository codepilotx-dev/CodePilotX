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
  onOpenDetails: (skill: DesktopSkillCatalogItem, trigger: HTMLButtonElement) => void
}

export function SkillCatalogCard({
  installing = false,
  skill,
  onInstall,
  onOpenDetails,
}: Props): React.ReactNode {
  return (
    <li>
      <article className="skill-catalog-card">
        <button
          className="skill-catalog-card__main"
          data-catalog-item-id={`skill:${skill.id}`}
          onClick={event => onOpenDetails(skill, event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true" className="skill-catalog-card__icon">
            <Sparkles size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </span>
          <span className="skill-catalog-card__copy">
            <span className="skill-catalog-card__title-line">
              <strong>{skill.name}</strong>
              {skill.audit ? (
                <span
                  className={`plugins-audit-badge is-${skill.audit.status}`}
                  title={skill.audit.summary}
                >
                  {renderAuditIcon(skill.audit.status)}
                  {skill.audit.status}
                </span>
              ) : null}
            </span>
            <span className="skill-catalog-card__meta">
              {skill.source} · {skill.installs.toLocaleString()} 次安装
            </span>
          </span>
        </button>

        <div className="skill-catalog-card__actions">
          {skill.installed ? (
            <span className="skill-catalog-card__installed">
              <Check aria-hidden="true" size={APP_ICON_SIZE} />
              已添加
            </span>
          ) : (
            <Button
              className="skill-catalog-card__action"
              color="secondary"
              loading={installing}
              onClick={() => onInstall(skill)}
              size="toolbar"
              title="添加到 CodePilotX"
            >
              <Plus aria-hidden="true" size={APP_ICON_SIZE} />
              添加
            </Button>
          )}
        </div>
      </article>
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
