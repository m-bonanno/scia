import { DEFAULT_API_PORT } from '@scia/contracts/endpoint';
import { checkPairing, OUTCOME_TEXT, SendOutcome } from './scia-client.ts';
import { loadSettings, saveSettings } from './storage.ts';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`options.html is missing #${id}`);
  return found;
}

const form = element('form', HTMLFormElement);
const token = element('token', HTMLInputElement);
const port = element('port', HTMLInputElement);
const intercept = element('intercept', HTMLInputElement);
const result = element('result', HTMLParagraphElement);

async function show(): Promise<void> {
  const settings = await loadSettings();
  token.value = settings.token;
  port.value = String(settings.port);
  intercept.checked = settings.interceptDownloads;
}

async function save(): Promise<void> {
  const typedPort = Number(port.value);
  const settings = {
    token: token.value.trim(),
    port:
      Number.isInteger(typedPort) && typedPort > 0 && typedPort <= 65_535
        ? typedPort
        : DEFAULT_API_PORT,
    interceptDownloads: intercept.checked,
  };
  await saveSettings(settings);
  port.value = String(settings.port);
  const outcome = await checkPairing(settings);
  result.textContent =
    outcome === SendOutcome.Sent
      ? 'Collegata: Scia risponde e riconosce il codice.'
      : OUTCOME_TEXT[outcome];
  result.className = outcome === SendOutcome.Sent ? 'muted' : 'problem';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void save();
});

void show();
