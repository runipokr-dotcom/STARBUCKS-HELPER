import { timingSafeEqual } from 'node:crypto';

// Provider credentials never leave this function. CORS is not authentication.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  const send = (status, body) => res.status(status).json(body);
  const origins = new Set([
    'https://runipokr-dotcom.github.io',
    'https://starbucks-helper.vercel.app',
    ...String(process.env.RUN_PROMPT_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean),
    ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(x => `https://${x}`)
  ]);
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) return send(403, {error: '허용되지 않은 페이지입니다.'});
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(405, {error: 'POST 요청만 지원합니다.'});
  }
  const accessToken = process.env.RUN_PROMPT_ACCESS_TOKEN;
  if (!accessToken || accessToken.length < 32) return send(503, {error: '서버 실행 암호 설정이 필요합니다. 관리자에게 문의해 주세요.'});
  const supplied = String(req.headers.authorization || '');
  const expected = `Bearer ${accessToken}`;
  if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return send(401, {error: '실행 암호를 확인해 주세요.'});
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    return send(415, {error: 'JSON 형식으로 요청해 주세요.'});
  }
  let body;
  try {
    if (Number(req.headers['content-length']) > 100000) return send(413, {error: '요청이 너무 큽니다.'});
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(raw) > 100000) return send(413, {error: '요청이 너무 큽니다.'});
    body = JSON.parse(raw);
  } catch { return send(400, {error: '요청 내용을 읽을 수 없습니다.'}); }
  if (!body || !['openai', 'anthropic'].includes(body.provider) ||
      typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 30000) {
    return send(400, {error: '모델을 선택하고 30,000자 이내의 프롬프트를 입력해 주세요.'});
  }
  const isOpenAI = body.provider === 'openai';
  const key = isOpenAI ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) return send(503, {error: `${isOpenAI ? 'OpenAI' : 'Anthropic'} 서버 API 키 설정이 필요합니다.`});
  const model = isOpenAI ? (process.env.OPENAI_MODEL || 'gpt-6-astra') : (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const headers = {'Content-Type': 'application/json', Authorization: `Bearer ${key}`};
    if (!isOpenAI) {
      headers['anthropic-version'] = '2023-06-01';
      if (process.env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID;
    }
    const response = await fetch(isOpenAI ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify(isOpenAI ? {
        model, input: body.prompt, max_output_tokens: 4096, store: false
      } : {model, max_tokens: 4096, messages: [{role: 'user', content: body.prompt}]})
    });
    // Map only known error codes; never relay provider messages or account details.
    if (!response.ok) {
      let code;
      try { code = (await response.json())?.error?.code; } catch { /* Non-JSON upstream error. */ }
      const quota = isOpenAI && ['insufficient_quota', 'billing_hard_limit_reached'].includes(code);
      const error = quota ? 'OpenAI API 크레딧이 부족하거나 결제 한도에 도달했습니다. OpenAI 결제 설정을 확인해 주세요. ChatGPT 구독과 API 크레딧은 별도입니다.' :
        response.status === 429 ? 'API 호출이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.' :
        '모델 호출에 실패했습니다. 서버의 API 키, 모델 이용 권한, 결제 상태를 확인해 주세요.';
      return send(response.status === 429 ? 429 : 502, {error});
    }
    const data = await response.json();
    if (isOpenAI && !['completed', 'incomplete'].includes(data.status)) {
      return send(502, {error: '모델이 답변 생성을 완료하지 못했습니다. 다시 시도해 주세요.'});
    }
    const blocks = isOpenAI ? (data.output || []).filter(x => x.type === 'message').flatMap(x => x.content || []) : (data.content || []);
    const text = blocks.filter(x => x.type === (isOpenAI ? 'output_text' : 'text')).map(x => x.text).join('\n');
    if (!text.trim()) return send(502, {error: '텍스트 답변이 없습니다. 요청을 바꾸거나 다시 실행해 주세요.'});
    const incomplete = isOpenAI ? data.status === 'incomplete' : !['end_turn', 'stop_sequence'].includes(data.stop_reason);
    return send(200, {text, provider: body.provider, model, incomplete});
  } catch {
    return send(controller.signal.aborted ? 504 : 502, {error: controller.signal.aborted ?
      '응답 시간이 초과되었습니다. 프롬프트를 줄여 다시 실행해 주세요.' : '모델 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
  } finally { clearTimeout(timer); }
}
