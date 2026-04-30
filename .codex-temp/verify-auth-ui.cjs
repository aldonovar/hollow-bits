const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const url = 'http://localhost:3000';
const screenshotPath = path.resolve('.codex-temp', 'auth-ui-verification.png');
let browser;

async function clickFirstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return true;
    }
  }
  return false;
}

async function visibleText(page, text) {
  const locator = page.getByText(text, { exact: true });
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) {
      return true;
    }
  }
  return false;
}

(async () => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
  }

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if ((await page.getByText('Cuenta DAW').count()) === 0) {
    const opened = await clickFirstVisible(page.locator('button[title*="Colaboraci"]'))
      || await clickFirstVisible(page.getByRole('button', { name: /colabor/i }))
      || await clickFirstVisible(page.getByText(/colaboraci/i));

    if (!opened && (await page.getByText('Cuenta DAW').count()) === 0) {
      throw new Error('No pude abrir el modal de colaboracion.');
    }
  }

  await page.getByText('Cuenta DAW').waitFor({ state: 'visible', timeout: 10000 });

  const panelChecks = [];
  for (const text of ['Cuenta DAW', 'Log in', 'Sign up', 'Iniciar sesion host']) {
    if (await visibleText(page, text)) {
      panelChecks.push(text);
    }
  }

  if (!panelChecks.includes('Sign up')) {
    throw new Error(`El panel no muestra Sign up. Checks: ${panelChecks.join(', ')}`);
  }

  await clickFirstVisible(page.getByRole('button', { name: 'Sign up' }));
  await page.getByText('Registro de Operador').waitFor({ state: 'visible', timeout: 10000 });

  const modalChecks = [];
  for (const text of [
    'Registro de Operador',
    'Continuar con Google',
    'Nombre Completo',
    'Nombre de Usuario',
    'Correo Electrónico',
    'Completar Registro',
  ]) {
    if (await visibleText(page, text)) {
      modalChecks.push(text);
    }
  }

  await page.screenshot({ path: screenshotPath, fullPage: false });
  await browser.close();

  console.log(JSON.stringify({
    ok: modalChecks.length === 6,
    panelChecks,
    modalChecks,
    screenshotPath,
  }, null, 2));
})().catch(async (error) => {
  try {
    if (browser) {
      const contexts = browser.contexts();
      const pages = contexts.flatMap((context) => context.pages());
      const page = pages[0];
      if (page) {
        await page.screenshot({ path: screenshotPath, fullPage: false });
        const text = await page.locator('body').innerText().catch(() => '');
        console.error(JSON.stringify({ screenshotPath, textExcerpt: text.slice(0, 1000) }, null, 2));
      }
    }
  } catch (captureError) {
    console.error(captureError);
  }

  if (browser) {
    await browser.close();
  }

  console.error(error);
  process.exit(1);
});
