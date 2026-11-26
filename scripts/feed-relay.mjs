#!/usr/bin/env node
// 피드 중계 (11/26 조장: 「Railway라서 막히는 거니까 맥미니에서 받아 오자」)
// Railway(해외 데이터센터)에서 LG디스플레이 뉴스룸 RSS가 자동 접속 확인 화면만 주고, 한국 IP(맥미니)에서는 정상이다.
// 맥미니에서 이 프로그램을 켜 두면 서버가 「직접 못 받은 피드」만 여기로 부탁한다 (server/collector/feeds.js feedItems ④).
//
// - 열쇠: 요청에 Authorization: Bearer <FEED_RELAY_KEY> 가 맞아야 받는다
// - 허용한 사이트만: FEED_RELAY_HOSTS (쉼표, 기본 news.lgdisplay.com) — 아무 주소나 대신 받아 주는 열린 프록시가 되지 않게
// - http(s)만 · 5MB · 15초 · 분당 30번까지. User-Agent는 서버와 같은 이름(techbrief news collector)을 그대로 밝힌다
// - 외부 패키지 없음 (Node 18+)
//
// 켜기:   FEED_RELAY_KEY=… node scripts/feed-relay.mjs            (기본 127.0.0.1:8787)
// 공개:   tailscale funnel --bg --set-path /feed-relay http://127.0.0.1:8787
// 확인:   curl -H "Authorization: Bearer $FEED_RELAY_KEY" "https://<맥미니>.ts.net/feed-relay/fetch?url=https://news.lgdisplay.com/feed/" | head
import http from 'node:http'

const KEY = process.env.FEED_RELAY_KEY ?? ''
const PORT = Number(process.env.FEED_RELAY_PORT || 8787)
const HOST = process.env.FEED_RELAY_BIND || '127.0.0.1'
const HOSTS = (process.env.FEED_RELAY_HOSTS || 'news.lgdisplay.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
const UA = 'Mozilla/5.0 (techbrief news collector)'
const MAX_BYTES = 5_000_000
const PER_MIN = 30

if (KEY.length < 16) {
  console.error('FEED_RELAY_KEY(16자 이상)를 넣고 켜 주세요. 예: FEED_RELAY_KEY=$(openssl rand -hex 24) node scripts/feed-relay.mjs')
  process.exit(1)
}

const hits = []
const allowed = (u) => {
  try {
    const x = new URL(u)
    if (!/^https?:$/.test(x.protocol) || x.username || x.password) return false
    const h = x.hostname.toLowerCase()
    return HOSTS.some((a) => h === a || h.endsWith(`.${a}`))
  } catch {
    return false
  }
}
const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    // Funnel이 /feed-relay를 떼고 넘기든 붙이고 넘기든 같은 길로
    const path = url.pathname.replace(/^\/feed-relay/, '') || '/'
    if (path === '/health') return send(res, 200, 'ok')
    if (req.method !== 'GET' || path !== '/fetch') return send(res, 404, '없는 주소')
    if ((req.headers.authorization ?? '') !== `Bearer ${KEY}`) return send(res, 401, '열쇠가 맞지 않아요')
    const target = url.searchParams.get('url') ?? ''
    if (!allowed(target)) return send(res, 403, `허용하지 않은 주소예요 (허용: ${HOSTS.join(', ')})`)
    const now = Date.now()
    while (hits.length && now - hits[0] > 60_000) hits.shift()
    if (hits.length >= PER_MIN) return send(res, 429, '잠시 뒤에 (분당 30번)')
    hits.push(now)
    try {
      const r = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, application/json, */*' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
      if (!allowed(r.url)) return send(res, 403, '허용하지 않은 주소로 넘어갔어요')
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX_BYTES) return send(res, 413, '5MB를 넘어요')
      console.log(`${new Date().toISOString()} ${r.status} ${buf.length}B ${target}`)
      return send(res, r.status, buf, r.headers.get('content-type') ?? 'application/octet-stream')
    } catch (err) {
      console.warn(`${new Date().toISOString()} 실패 ${target}: ${err.message}`)
      return send(res, 502, `받지 못했어요: ${err.name === 'TimeoutError' ? '15초 초과' : err.message}`)
    }
  })
  .listen(PORT, HOST, () => console.log(`피드 중계 켜짐 http://${HOST}:${PORT} · 허용 ${HOSTS.join(', ')}`))
