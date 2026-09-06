// Run: bun apps/desktop/renderer/test/model-provider-selection.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientMock = `
const providers = [
  { providerID: 'minimax-cn-coding-plan', displayName: 'MiniMax', kind: 'anthropic', apiKeyConfigured: true, defaultModels: ['MiniMax-M3'] },
  { providerID: 'openai', displayName: 'OpenAI', kind: 'openai', apiKeyConfigured: true, defaultModels: ['gpt-5', 'gpt-5-mini'] },
];
let selected = { providerID: 'minimax-cn-coding-plan', id: 'MiniMax-M3' };
let deferred = false;
const pending = [];
function state(providerID = selected.providerID) {
  const provider = providers.find(item => item.providerID === providerID);
  return { provider, selectedProviderID: providerID, models: provider.defaultModels,
    model: selected.providerID === providerID ? selected.id : provider.defaultModels[0],
    apiKeyConfigured: true, modelConfigured: true, baseURL: '' };
}
export function deferSaves() { deferred = true; }
export function releaseSave() { pending.shift()?.(); }
export const desktopClient = {
  getModelProviderState: async providerID => state(providerID),
  listModelProviders: async () => providers,
  fetchProviderModels: async ({ providerID }) => ({ models: state(providerID).models }),
  saveModelProvider: async selection => {
    document.body.dataset.saveStarted = String(Number(document.body.dataset.saveStarted || 0) + 1);
    if (deferred) await new Promise(resolve => pending.push(resolve));
    selected = selection;
    window.dispatchEvent(new Event('desktop:model-provider-changed'));
    document.body.dataset.saveCompleted = String(Number(document.body.dataset.saveCompleted || 0) + 1);
    return state();
  },
};
`
const harness = `
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useModelProviderController } from ${JSON.stringify(resolve(rendererRoot, 'src/features/layout/useModelProviderController.ts').replaceAll('\\', '/'))};
import { deferSaves, releaseSave } from 'model-selection-client';
function Harness() {
  const [values, setValues] = useState({ providerID: 'minimax-cn-coding-plan', model: 'MiniMax-M3', selectedModelPreset: 'MiniMax-M3', thinkingMode: 'default' });
  const [item, setItem] = useState({ id: 'session-a', providerID: 'minimax-cn-coding-plan', model: 'MiniMax-M3' });
  const [error, setError] = useState('');
  const patch = useCallback(value => setValues(current => ({ ...current, ...value })), []);
  const setProviderID = useCallback(providerID => patch({ providerID }), [patch]);
  const setProviderBaseURL = useCallback(providerBaseURL => patch({ providerBaseURL }), [patch]);
  const setModel = useCallback(model => patch({ model }), [patch]);
  const setSelectedModelPreset = useCallback(selectedModelPreset => patch({ selectedModelPreset }), [patch]);
  const setThinkingMode = useCallback(thinkingMode => patch({ thinkingMode }), [patch]);
  const controller = useModelProviderController({ settings: { values, setProviderID, setProviderBaseURL, setModel, setSelectedModelPreset, setThinkingMode, syncExternalSettingsPatch: patch }, activeSessionItem: item, sessionId: item?.id ?? null, hasMessages: true, setErrorMessage: setError, setNoticeMessage: () => {} });
  return <>
    <output id="selection">{controller.selectedProviderID + '/' + values.model}</output>
    <output id="configured">{String(controller.modelConfigured)}</output>
    <output id="preset">{controller.resolvedSelectedModelPreset}</output>
    <output id="error">{error}</output>
    {controller.providerModelOptions.flatMap(provider => provider.modelPresets.map(preset =>
      <button key={provider.providerID + preset.id} onClick={() => controller.handleProviderModelChange(provider.providerID, preset.id)}>{provider.providerID + '/' + preset.id}</button>
    ))}
    <button onClick={() => window.dispatchEvent(new Event('desktop:model-provider-changed'))}>Refresh catalog</button>
    <button onClick={() => setItem(current => ({ ...current, model: 'MiniMax-M2', sessionName: 'Updated title' }))}>Refresh old session</button>
    <button onClick={() => setItem({ id: 'session-b', providerID: 'minimax-cn-coding-plan', model: 'MiniMax-M3' })}>Switch session</button>
    <button onClick={() => setItem({ id: 'session-a', providerID: 'minimax-cn-coding-plan', model: 'MiniMax-M3' })}>First session</button>
    <button onClick={() => setItem(null)}>Home</button>
    <button onClick={deferSaves}>Defer saves</button>
    <button onClick={releaseSave}>Release save</button>
  </>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`
async function buildHarness(): Promise<string> {
  const build = await Bun.build({
    entrypoints: ['model-selection-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{
      name: 'model-selection-harness',
      setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: Bun.resolveSync(args.path, rendererRoot), namespace: 'file' }))
        builder.onResolve({ filter: /^react-dom\/client$/ }, args => ({ path: Bun.resolveSync(args.path, rendererRoot), namespace: 'file' }))
        builder.onResolve({ filter: /^model-selection-harness$/ }, () => ({ path: 'harness', namespace: 'model-selection' }))
        builder.onLoad({ filter: /^harness$/, namespace: 'model-selection' }, () => ({ contents: harness, loader: 'jsx', resolveDir: rendererRoot }))
        builder.onResolve({ filter: /(?:desktop-client\/index\.js$|^model-selection-client$)/ }, () => ({ path: 'client', namespace: 'model-selection' }))
        builder.onLoad({ filter: /^client$/, namespace: 'model-selection' }, () => ({ contents: clientMock, loader: 'js' }))
      },
    }],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  return build.outputs[0]!.text()
}
if (process.versions.bun) {
  // Playwright's Chrome pipe transport needs Node on Windows; Bun only bundles the harness.
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await buildHarness()]),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await child.exited)
}
let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: script })
  const selection = page.locator('#selection')
  const check = async (model: string) => {
    await expect(selection).toHaveText(model)
    await expect(page.locator('#configured')).toHaveText('true')
    await expect(page.locator('#preset')).toHaveText(model.split('/')[1]!)
    await expect(page.locator('#error')).toBeEmpty()
  }
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await page.getByRole('button', { name: 'openai/gpt-5', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-completed', '1')
  await check('openai/gpt-5')
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await check('openai/gpt-5')
  await page.getByRole('button', { name: 'openai/gpt-5-mini', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-completed', '2')
  await check('openai/gpt-5-mini')
  await page.getByRole('button', { name: 'Refresh old session' }).click()
  await check('openai/gpt-5-mini')

  await page.getByRole('button', { name: 'Defer saves' }).click()
  await page.getByRole('button', { name: 'openai/gpt-5', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-started', '3')
  await page.getByRole('button', { name: 'openai/gpt-5-mini', exact: true }).click()
  await check('openai/gpt-5-mini')
  await page.getByRole('button', { name: 'Release save' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-started', '4')
  await check('openai/gpt-5-mini')
  await page.getByRole('button', { name: 'Release save' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-completed', '4')
  await check('openai/gpt-5-mini')

  await page.getByRole('button', { name: 'Switch session' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await check('openai/gpt-5-mini')
  await page.getByRole('button', { name: 'Switch session' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')

  await page.getByRole('button', { name: 'openai/gpt-5', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-started', '5')
  await page.getByRole('button', { name: 'First session' }).click()
  await check('minimax-cn-coding-plan/MiniMax-M3')
  await page.getByRole('button', { name: 'Release save' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-completed', '5')
  await check('minimax-cn-coding-plan/MiniMax-M3')
  assert.deepEqual(errors, [])
  console.log('Model selection survives catalog/session refresh and delayed saves; another session hydrates its own model.')
} finally {
  await browser.close()
}
