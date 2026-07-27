import React, { Suspense, useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { LAB_CATEGORY_LABELS, LAB_DEMOS } from './labRegistry.js'
import type { LabDemoDefinition } from './labTypes.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import '../../styles/lazy/labs.scss'

export function LabsPage(): React.ReactNode {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(LAB_DEMOS[0]?.id ?? '')
  const demos = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized
      ? LAB_DEMOS.filter(demo =>
          `${demo.title} ${demo.description}`.toLocaleLowerCase().includes(normalized),
        )
      : LAB_DEMOS
  }, [query])
  const selected =
    LAB_DEMOS.find(demo => demo.id === selectedId) ?? LAB_DEMOS[0]

  return (
    <main className="labs-page" aria-labelledby="labs-title">
      <aside className="labs-catalog">
        <header className="labs-heading">
          <span className="labs-heading-icon"><FlaskConical aria-hidden /></span>
          <div>
            <h1 id="labs-title">Codex Labs</h1>
            <p>构建产物驱动的交互式视觉原型</p>
          </div>
        </header>
        <SearchInput
          aria-label="搜索实验"
          className="labs-search"
          onChange={setQuery}
          placeholder="搜索 18 个表面…"
          value={query}
        />
        <nav className="labs-list" aria-label="实验表面">
          {demos.map(demo => (
            <button
              type="button"
              key={demo.id}
              data-selected={demo.id === selected?.id}
              onClick={() => setSelectedId(demo.id)}
            >
              <span>{demo.title}</span>
              <small>{LAB_CATEGORY_LABELS[demo.category]}</small>
            </button>
          ))}
          {demos.length === 0 ? <p className="labs-empty">没有匹配的实验。</p> : null}
        </nav>
      </aside>
      {selected ? <LabStage definition={selected} /> : null}
    </main>
  )
}

function LabStage({ definition }: { definition: LabDemoDefinition }): React.ReactNode {
  const Demo = useMemo(() => React.lazy(definition.load), [definition])
  return (
    <section className="labs-stage" aria-labelledby="labs-demo-title">
      <header className="labs-stage-header">
        <div>
          <span className="labs-status">视觉原型</span>
          <h2 id="labs-demo-title">{definition.title}</h2>
          <p>{definition.description}</p>
        </div>
        <details className="labs-evidence">
          <summary>证据</summary>
          <code>{definition.evidence.sourceChunks.join('\n')}</code>
        </details>
      </header>
      <div className="labs-demo-viewport">
        <Suspense fallback={<div className="labs-loading" aria-live="polite">正在载入原型…</div>}>
          <Demo />
        </Suspense>
      </div>
      <p className="labs-disclaimer">仅用于验证结构、状态和主题；未连接真实系统能力。</p>
    </section>
  )
}
