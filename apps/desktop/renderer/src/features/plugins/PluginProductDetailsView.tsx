import type { PluginDetails } from '@codepilotx/agent-protocol'
import type React from 'react'
import { ArrowRight, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import promptHeroPurple from '../../assets/plugin-backgrounds/prompt-hero-purple.png'
import { PluginDetailsPrimaryAction } from './PluginDetailsContent.js'
import { PluginIcon } from './PluginIcon.js'
import { PLUGIN_CATEGORY_LABELS, pluginPrimaryAction, type PluginCatalogItem } from './pluginCatalog.js'

const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download'

type Props = {
  item: PluginCatalogItem
  details: PluginDetails | null
  busy: boolean
  error?: string | null
  onPrimaryAction: (
    item: PluginCatalogItem,
    trigger: HTMLButtonElement,
    checked?: boolean,
  ) => void
  onTryPrompt: (prompt: string) => void
  onUninstall?: () => void
}

export function PluginProductDetailsView({
  item,
  details,
  busy,
  error,
  onPrimaryAction,
  onTryPrompt,
  onUninstall,
}: Props): React.ReactNode {
  const [moreOpen, setMoreOpen] = useState(false)
  const prompts = details?.defaultPrompts ?? []
  const skills = details?.skills ?? (item.skills ?? []).map(id => ({ id, name: id, description: '' }))
  const primaryAction = pluginPrimaryAction(item)
  const toggleInSkills = primaryAction.kind === 'toggle-plugin' && skills.length > 0
  const canTry = item.enabled && prompts.length > 0

  const toggle = (
    <PluginDetailsPrimaryAction
      ariaLabel="启用插件及其技能"
      busy={busy}
      item={item}
      onPrimaryAction={onPrimaryAction}
    />
  )

  return (
    <section className="catalog-details-view catalog-plugin-details">
      <header className="catalog-details-view__header">
        <span aria-hidden="true" className="catalog-details-view__icon" data-plugin-tone={item.tone}>
          <PluginIcon
            logoDarkSource={item.logoDarkSource}
            logoSource={item.logoSource}
            name={item.iconName}
          />
        </span>
        <div className="catalog-details-view__identity">
          <h1>{item.name}</h1>
          <p>{item.description}</p>
        </div>
        <div className="catalog-details-view__primary-action">
          {item.id === 'minimax' && item.installed && onUninstall ? (
            <PopoverMenu
              align="end"
              open={moreOpen}
              onOpenChange={setMoreOpen}
              width={180}
              trigger={(
                <IconButton color="ghostSecondary" size="toolbar" title="更多插件操作">
                  <MoreHorizontal aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </IconButton>
              )}
            >
              <PopoverItem
                disabled={busy}
                icon={<Trash2 aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />}
                onClick={onUninstall}
              >
                卸载
              </PopoverItem>
            </PopoverMenu>
          ) : null}
          {canTry ? (
            <Button color="primary" onClick={() => onTryPrompt(prompts[0]!)}>
              立即试用
            </Button>
          ) : !toggleInSkills ? (
            <PluginDetailsPrimaryAction
              busy={busy}
              item={item}
              onPrimaryAction={onPrimaryAction}
            />
          ) : null}
        </div>
      </header>

      {prompts.length ? (
        <div aria-label="示例提示词" className="catalog-plugin-prompts">
          <img
            alt=""
            aria-hidden="true"
            className="catalog-plugin-prompts__background"
            draggable={false}
            src={promptHeroPurple}
          />
          {prompts.map(prompt => (
            <button
              className="catalog-plugin-prompts__item"
              disabled={!item.enabled}
              key={prompt}
              onClick={() => onTryPrompt(prompt)}
              type="button"
            >
              <span className="catalog-plugin-prompts__label">
                <PluginIcon
                  className="catalog-plugin-prompts__plugin-icon"
                  logoDarkSource={item.logoDarkSource}
                  logoSource={item.logoSource}
                  name={item.iconName}
                />
                <span><strong>{item.name}</strong> {prompt}</span>
              </span>
              <ArrowRight aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ))}
        </div>
      ) : null}

      <p className="catalog-plugin-details__description">
        {details?.longDescription || item.description}
      </p>

      {skills.length ? (
        <section aria-labelledby="catalog-plugin-skills" className="catalog-details-section">
          <div className="catalog-details-section__heading">
            <h2 id="catalog-plugin-skills">技能 {skills.length}</h2>
            {skills.length > 1 && primaryAction.kind === 'toggle-plugin' ? toggle : null}
          </div>
          <div className="catalog-plugin-skills">
            {skills.map((skill, index) => (
              <div className="catalog-plugin-skill" key={skill.id}>
                <span aria-hidden="true" className="catalog-plugin-skill__icon" data-plugin-tone={item.tone}>
                  <PluginIcon
                    logoDarkSource={item.logoDarkSource}
                    logoSource={item.logoSource}
                    name={item.iconName}
                  />
                </span>
                <div className="catalog-plugin-skill__copy">
                  <h3>{skills.length === 1 && skill.id === item.id ? item.name : skill.name}</h3>
                  {skill.description ? <p>{skill.description}</p> : null}
                </div>
                {skills.length === 1 && index === 0 && primaryAction.kind === 'toggle-plugin' ? toggle : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="catalog-plugin-information" className="catalog-details-section">
        <div className="catalog-details-section__heading">
          <h2 id="catalog-plugin-information">信息</h2>
        </div>
        <dl className="plugin-details-metadata">
          {details?.displayCapabilities.length ? <InformationRow label="功能" value={details.displayCapabilities.join('、')} /> : null}
          {item.developerName ? <InformationRow label="开发者" value={item.developerName} /> : null}
          <InformationRow label="类别" value={item.productCategory ?? PLUGIN_CATEGORY_LABELS[item.category]} />
          {item.version ? <InformationRow label="版本" value={item.version} /> : null}
          {item.externalURL ? (
            <div className="plugin-details-metadata__row">
              <dt>网站</dt>
              <dd>
                <Button color="ghostSecondary" onClick={() => void desktopClient.openExternalURL(item.externalURL!)} size="toolbar">
                  打开网站
                  <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Button>
              </dd>
            </div>
          ) : null}
          {item.miniMaxCli?.latestVersion ? <InformationRow label="最新版本" value={item.miniMaxCli.latestVersion} /> : null}
          {item.miniMaxCli ? <InformationRow label="认证" value={miniMaxAuthLabel(item.miniMaxCli.authStatus)} /> : null}
          {item.miniMaxCli?.credentialSource ? <InformationRow label="当前 Key" value={`${item.miniMaxCli.credentialSource.label} · ${item.miniMaxCli.credentialSource.maskedValue}`} /> : null}
          {item.miniMaxCli?.credentialSource ? <InformationRow label="区域" value={item.miniMaxCli.credentialSource.region === 'cn' ? '中国' : 'Global'} /> : null}
          {item.miniMaxCli?.quotaLabel ? <InformationRow label="套餐" value={item.miniMaxCli.quotaLabel} /> : null}
        </dl>
        {item.id === 'minimax' && item.externalURL ? (
          <div className="catalog-details-view__secondary-action">
            {item.miniMaxCli?.installationStatus === 'missing-prerequisite' ? (
              <Button color="secondary" onClick={() => void desktopClient.openExternalURL(NODE_DOWNLOAD_URL)}>
                下载 Node.js
                <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            ) : null}
            <Button color="secondary" onClick={() => void desktopClient.openExternalURL(item.externalURL!)}>
              查看官方说明
              <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          </div>
        ) : null}
      </section>

      {error ? <p className="catalog-details-view__error" role="status">{error}</p> : null}
    </section>
  )
}

function InformationRow({ label, value }: { label: string; value: React.ReactNode }): React.ReactNode {
  return (
    <div className="plugin-details-metadata__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function miniMaxAuthLabel(status: NonNullable<PluginCatalogItem['miniMaxCli']>['authStatus']): string {
  if (status === 'coding-plan-synced') return '正在使用 API Key Hub 当前 Coding Plan Key'
  if (status === 'oauth') return '已通过 MiniMax 登录'
  if (status === 'api-key') return '已配置 MiniMax API Key'
  if (status === 'not-authenticated') return '尚未登录，实际使用时再登录'
  return '暂时无法确认'
}
