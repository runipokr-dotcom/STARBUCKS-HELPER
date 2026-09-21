const byId = id => document.getElementById(id);
const panel = byId('runnerPanel');
const form = byId('runnerForm');
const fields = byId('variableFields');
const preview = byId('runPreview');
const provider = byId('runProvider');
const note = byId('runNote');
const output = byId('runOutput');
const result = byId('runResult');
const resultNote = byId('resultNote');
const access = byId('runAccess');
const endpoint = location.hostname.endsWith('.github.io') ?
  'https://starbucks-helper.vercel.app/api/run-prompt' : '/api/run-prompt';
let template = '', running = false, lastRun = null;
const controls = [byId('runBtn'), byId('rerunBtn'), byId('otherModelBtn')];
const variablePattern = () => /\{\{\s*([^{}\n]+?)\s*\}\}/g;

function updatePreview() {
  const values = new Map([...fields.querySelectorAll('textarea')].map(el => [el.dataset.variable, el.value]));
  preview.value = template.replace(variablePattern(), (_, name) => values.get(name.trim()) || '');
}

export function openPromptRunner(item) {
  if (running) { note.textContent = '실행 중입니다. 답변을 받은 뒤 다른 프롬프트를 선택해 주세요.'; panel.scrollIntoView(); return; }
  template = item.body;
  byId('runTitle').textContent = item.title;
  fields.replaceChildren();
  const names = [...new Set([...template.matchAll(variablePattern())].map(match => match[1].trim()))];
  names.forEach((name, index) => {
    const label = document.createElement('label');
    label.htmlFor = `variable-${index}`;
    label.textContent = name;
    const input = document.createElement('textarea');
    input.id = label.htmlFor; input.dataset.variable = name; input.required = true;
    input.rows = 2; input.addEventListener('input', updatePreview);
    fields.append(label, input);
  });
  updatePreview();
  result.hidden = true; output.value = ''; lastRun = null;
  note.textContent = names.length ? '변수를 입력하고 실행할 모델을 선택해 주세요.' : '실행할 내용을 확인하고 모델을 선택해 주세요.';
  panel.hidden = false;
  panel.scrollIntoView({behavior: 'smooth', block: 'start'});
  (fields.querySelector('textarea') || provider).focus({preventScroll: true});
}

async function run(prompt, selectedProvider) {
  if (running) return;
  if (!access.value.trim()) { note.textContent = '실행 암호를 입력해 주세요.'; access.focus(); return; }
  if (!prompt.trim() || prompt.length > 30000) { note.textContent = '프롬프트는 비어 있지 않은 30,000자 이내여야 합니다.'; return; }
  running = true;
  controls.forEach(button => button.disabled = true);
  form.querySelectorAll('textarea, select, input').forEach(el => el.disabled = true);
  panel.setAttribute('aria-busy', 'true');
  note.textContent = '답변 생성 중… 최대 1분 정도 걸릴 수 있어요.';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(endpoint, {method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${access.value.trim()}`
    }, body: JSON.stringify({provider: selectedProvider, prompt}), signal: controller.signal});
    let data;
    try { data = await response.json(); } catch { throw new Error('실행 서버 응답을 읽을 수 없습니다. 배포 주소와 접근 설정을 확인해 주세요.'); }
    if (!response.ok) throw new Error(data.error || '실행에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('답변이 비어 있습니다. 다시 시도해 주세요.');
    output.value = data.text;
    lastRun = {prompt, provider: selectedProvider};
    provider.value = selectedProvider;
    resultNote.textContent = `${selectedProvider === 'openai' ? 'ChatGPT' : 'Claude'} · ${data.model || ''}${data.incomplete ? ' · 답변이 중간에 끝났습니다. 요청 분량을 줄여 다시 실행해 주세요.' : ''}`;
    result.hidden = false;
    note.textContent = '답변을 받았습니다. 결과는 이 화면에서만 보관됩니다.';
  } catch (error) {
    note.textContent = (controller.signal.aborted ? '응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' :
      error instanceof TypeError ? '실행 서버에 연결하지 못했습니다. 네트워크와 서버 연결 설정을 확인해 주세요.' : error.message) +
      (lastRun ? ' 아래에는 이전 결과가 유지됩니다.' : '');
  } finally {
    clearTimeout(timer); running = false;
    controls.forEach(button => button.disabled = false);
    form.querySelectorAll('textarea, select, input').forEach(el => el.disabled = false);
    panel.setAttribute('aria-busy', 'false');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const blank = [...fields.querySelectorAll('textarea')].find(el => !el.value.trim());
  if (blank) { note.textContent = '빈 변수를 채워 주세요.'; blank.focus(); return; }
  run(preview.value, provider.value);
});
byId('rerunBtn').addEventListener('click', () => { if (lastRun) run(lastRun.prompt, lastRun.provider); });
byId('otherModelBtn').addEventListener('click', () => { if (lastRun) run(lastRun.prompt, lastRun.provider === 'openai' ? 'anthropic' : 'openai'); });
byId('copyResultBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(output.value); note.textContent = '결과를 복사했습니다.'; }
  catch { output.focus(); output.select(); note.textContent = '자동 복사가 제한되어 있어요. 선택된 결과를 길게 눌러 복사해 주세요.'; }
});
