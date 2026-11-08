// 사용자가 넣은 주소(링크 자료) · 기사 원문 주소를 가져올 때 쓰는 fetch (11/09, 28 문서 3장)
// - 내부 주소는 가져오지 않는다: 127.0.0.1 · localhost · 사설 IP(10. · 172.16~31. · 192.168.) · 클라우드 메타데이터(169.254.) 등
//   (같은 서버의 다른 서비스 · DB 관리 화면을 우리 서버가 대신 열어 내용을 보여 주는 것을 막음, SSRF)
// - 실제로 연결하는 순간의 IP를 검사한다(connect.lookup). 처음엔 바깥 IP를 주고 나중에 내부 IP를 주는 DNS 속임수도 막힘
// - 주소를 옮겨 가라는 응답(리다이렉트)은 직접 따라가며 매번 다시 검사한다 (최대 5번)
// - 응답은 받으면서 크기를 센다. 한도를 넘으면 그 자리에서 끊는다 (다 받은 뒤 재지 않음)
import dns from 'node:dns'
import net from 'node:net'
import { Agent, fetch } from 'undici'

const MAX_REDIRECTS = 5
const REDIRECT = new Set([301, 302, 303, 307, 308])

// IPv4 · IPv6 목록을 따로 둔다. 한 목록에 두면 ::ffff:0:0/96(IPv4를 IPv6로 적은 형태)이 모든 IPv4에 걸린다 (11/09 확인)
const blocked4 = new net.BlockList()
const blocked6 = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked4.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked6.addSubnet(addr, prefix, 'ipv6')

export class FetchBlocked extends Error {
  constructor(code, message) {
    super(message)
    this.code = code // 'EPRIVATE' 내부 주소 · 'ETOOBIG' 너무 큼 · 'EREDIRECT' 리다이렉트가 너무 많음 · 'EURL' 주소 형식
  }
}

export function isPrivateAddress(ip) {
  const family = net.isIP(ip)
  if (!family) return true
  return family === 6 ? blocked6.check(ip, 'ipv6') : blocked4.check(ip, 'ipv4')
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new FetchBlocked('EPRIVATE', '내부 주소는 가져오지 않아요.'))
    }
    if (options?.all) return callback(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

const agent = new Agent({ connect: { lookup: safeLookup } })

function checkUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlocked('EURL', 'http · https 주소만 가져와요.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // IP를 바로 적은 주소는 DNS를 거치지 않아 lookup 검사가 안 걸리므로 여기서 본다
  if (net.isIP(host) && isPrivateAddress(host)) throw new FetchBlocked('EPRIVATE', '내부 주소는 가져오지 않아요.')
}

async function readLimited(res, maxBytes, truncate) {
  const declared = Number(res.headers.get('content-length'))
  if (!truncate && declared > maxBytes) {
    await res.body?.cancel()
    throw new FetchBlocked('ETOOBIG', '응답이 너무 커요.')
  }
  const chunks = []
  let size = 0
  for await (const chunk of res.body ?? []) {
    chunks.push(chunk)
    size += chunk.length
    if (size > maxBytes) {
      if (truncate) break // 앞부분만 필요할 때 (원문 제목 찾기)
      throw new FetchBlocked('ETOOBIG', '응답이 너무 커요.')
    }
  }
  return Buffer.concat(chunks).subarray(0, maxBytes)
}

// 결과: { ok, status, url(마지막 주소), headers, buffer }. ok가 아니면 buffer는 비어 있다
// maxBytes를 넘으면 FetchBlocked('ETOOBIG'), truncate: true면 앞부분 maxBytes만 돌려준다
export async function safeFetch(rawUrl, init = {}, { maxBytes, truncate = false } = {}) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new FetchBlocked('EURL', '주소 형식이 아니에요.')
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkUrl(url)
    let res
    try {
      res = await fetch(url, { ...init, redirect: 'manual', dispatcher: agent })
    } catch (err) {
      // lookup에서 막힌 것은 원인(cause)에 들어 있다
      if (err?.cause instanceof FetchBlocked) throw err.cause
      throw err
    }
    const location = res.headers.get('location')
    if (REDIRECT.has(res.status) && location) {
      await res.body?.cancel()
      url = new URL(location, url)
      continue
    }
    if (!res.ok) {
      await res.body?.cancel()
      return { ok: false, status: res.status, url: url.href, headers: res.headers, buffer: Buffer.alloc(0) }
    }
    const buffer = await readLimited(res, maxBytes, truncate)
    return { ok: true, status: res.status, url: url.href, headers: res.headers, buffer }
  }
  throw new FetchBlocked('EREDIRECT', '주소를 너무 여러 번 옮겨 가요.')
}
