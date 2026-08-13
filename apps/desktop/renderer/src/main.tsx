import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { initializeRendererDataEpoch } from './services/desktop-client/data-epoch.js'
import './styles/tailwind.css'
import './styles/index.scss'

// 启动遮罩 handoff：静态 splash 在入口 JS 加载期间保持画面稳定，但只有真实
// ProseMirror 编辑器创建完成（contenteditable + combobox）才判定可输入。
// 不把 .composer-editor-content 单独出现当作 ready，因为 ComposerCard 的
// Suspense fallback 也带该类但不能输入。reduced-motion 下立即移除；hash 离开
// /new（例如未配置模型跳到 /setup）时立即放行；20 秒 fail-safe 兜底 lazy
// chunk 或初始化异常，让现有错误 UI 可见。
const COMPOSER_READY_SELECTOR =
  '.composer-editor-content[contenteditable="true"][role="combobox"]'
const SPLASH_FADE_MS = 200
const SPLASH_FAILSAFE_MS = 20_000

function installStartupSplashHandoff(): void {
  const splash = document.getElementById('startup-splash')
  if (!splash) return

  let finished = false
  let failsafeTimer: number | null = null
  const finish = (): void => {
    if (finished) return
    finished = true
    splash.removeAttribute('aria-busy')
    observer.disconnect()
    window.removeEventListener('hashchange', onDomChanged)
    if (failsafeTimer !== null) window.clearTimeout(failsafeTimer)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      splash.remove()
    } else {
      splash.classList.add('startup-splash--exiting')
      window.setTimeout(() => splash.remove(), SPLASH_FADE_MS + 40)
    }
  }

  const onDomChanged = (): void => {
    if (document.querySelector(COMPOSER_READY_SELECTOR)) {
      finish()
      return
    }
    // React Router 用 history.pushState 导航（不触发 hashchange），但路由切换
    // 必然重渲染 DOM，因此在这里读 hash 判定是否已离开 /new。`#/` 是初始
    // index 重定向前的占位，不算离开。
    const hash = window.location.hash
    if (hash && hash !== '#/' && !hash.startsWith('#/new')) {
      finish()
    }
  }

  const observer = new MutationObserver(onDomChanged)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  window.addEventListener('hashchange', onDomChanged)
  failsafeTimer = window.setTimeout(finish, SPLASH_FAILSAFE_MS)
  onDomChanged()
}

installStartupSplashHandoff()

initializeRendererDataEpoch()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
