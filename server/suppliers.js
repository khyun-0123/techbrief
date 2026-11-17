// 소부장 기업 (11/17, 35 문서 R10 · 37 문서 R10): 디스플레이에 들어가는 소재 · 부품 · 장비 회사
// 교수님 의견 「LGD · 다른 디스플레이 업체 · 소부장 기업의 최신 동향을 함께」 → 관리 페이지 「회사」에 소부장 목록, 특허 출원인으로도 센다
// - 목록(이름)은 관리 페이지에서 고친다 (collector/lists.js suppliers). 아래 사전은 이름 → 특허 출원인 글자 (Google 정리 이름)
// - 출원인 글자는 11/17 디스플레이 특허 DB 실측(2020년~ 출원인)으로 정함. 사전에 없는 이름은 `unmatched`로 알려 준다 (한 줄 더하면 됨)
// - 중요도 점수에는 넣지 않는다 (배점 · 「중요」 비율 W4를 바꾸지 않음). 기사에는 「소부장 ○○ 언급」 이유 · 해시태그로만 보인다
import { dbEnabled, query } from './db/index.js'
import { patentDbReady } from './patentDb.js'
import { patternFromTerms } from './patents.js'

export const SUPPLIER_DICT = [
  { id: 'duksan', kind: '소재', names: ['덕산네오룩스', 'Duksan Neolux'], like: ['DUKSAN NEOLUX%'] },
  { id: 'solus', kind: '소재', names: ['솔루스첨단소재', 'Solus'], like: ['SOLUS ADVANCED%', 'DOOSAN SOLUS%'] },
  { id: 'ltmat', kind: '소재', names: ['LT소재', '엘티소재', 'LT Materials'], like: ['LT MATERIALS%'] },
  { id: 'lgchem', kind: '소재', names: ['LG화학', 'LG Chem'], like: ['LG CHEM%'] },
  { id: 'dongwoo', kind: '소재', names: ['동우화인켐', 'Dongwoo Fine-Chem'], like: ['DONGWOO FINE CHEM%'] },
  { id: 'innox', kind: '소재', names: ['이녹스첨단소재', 'Innox'], like: ['INNOX ADVANCED%'] },
  { id: 'hansol', kind: '소재', names: ['한솔케미칼', 'Hansol Chemical'], like: ['HANSOL CHEMICAL%'] },
  { id: 'skc', kind: '소재', names: ['SKC'], like: ['SKC CO%', 'SKC HI TECH%'] },
  { id: 'kolon', kind: '소재', names: ['코오롱인더스트리', '코오롱', 'Kolon'], like: ['KOLON INC%'] },
  { id: 'merck', kind: '소재', names: ['머크', 'Merck'], like: ['MERCK PATENT%'] },
  { id: 'udc', kind: '소재', names: ['UDC', '유니버설디스플레이', 'Universal Display'], like: ['UNIVERSAL DISPLAY%'] },
  { id: 'idemitsu', kind: '소재', names: ['이데미쓰코산', '이데미츠', 'Idemitsu'], like: ['IDEMITSU KOSAN%'] },
  { id: 'sumitomo', kind: '소재', names: ['스미토모화학', 'Sumitomo Chemical'], like: ['SUMITOMO CHEMICAL%'] },
  { id: 'dupont', kind: '소재', names: ['듀폰', 'DuPont'], like: ['DUPONT SPECIAL%'] },
  { id: 'nitto', kind: '부품', names: ['닛토덴코', 'Nitto Denko'], like: ['NITTO DENKO%'] },
  { id: 'corning', kind: '부품', names: ['코닝', 'Corning'], like: ['CORNING INC%', 'CORNING PREC%'] },
  { id: '3m', kind: '부품', names: ['3M'], like: ['3M INNOVATIVE%'] },
  { id: 'heesung', kind: '부품', names: ['희성전자', 'Heesung'], like: ['HEESUNG ELECTRONICS%'] },
  { id: 'apsystems', kind: '장비', names: ['AP시스템', 'AP Systems'], like: ['AP SYSTEMS INC%'] },
  { id: 'wonik', kind: '장비', names: ['원익IPS', 'Wonik IPS'], like: ['WONIK IPS%'] },
  { id: 'jusung', kind: '장비', names: ['주성엔지니어링', 'Jusung'], like: ['JUSUNG ENG%'] },
  { id: 'kctech', kind: '장비', names: ['케이씨텍', 'KCTech'], like: ['KCTECH%'] },
  { id: 'sfa', kind: '장비', names: ['에스에프에이', 'SFA'], like: ['SFA ENGINEERING%'] },
  { id: 'sunic', kind: '장비', names: ['선익시스템', 'Sunic System'], like: ['SUNIC SYSTEM%'] },
  { id: 'canontokki', kind: '장비', names: ['캐논토키', 'Canon Tokki'], like: ['CANON TOKKI%'] },
  { id: 'amat', kind: '장비', names: ['어플라이드머티어리얼즈', 'AMAT', 'Applied Materials'], like: ['APPLIED MATERIALS INC%'] },
  { id: 'tel', kind: '장비', names: ['도쿄일렉트론', 'TEL', 'Tokyo Electron'], like: ['TOKYO ELECTRON%'] },
  { id: 'ulvac', kind: '장비', names: ['울박', 'ULVAC'], like: ['ULVAC INC%', 'ULVAC CORP%'] },
]

// 관리 페이지 처음 값: 사전의 첫 이름
export const DEFAULT_SUPPLIERS = SUPPLIER_DICT.map((d) => d.names[0])

const flat = (t) => String(t ?? '').toLowerCase().replace(/[\s·.()-]/g, '')
export const supplierOf = (name) => SUPPLIER_DICT.find((d) => d.names.some((n) => flat(n) === flat(name))) ?? null
// 키워드 특허에서 소부장 기업 특허 수 (디스플레이 특허 DB, 같은 발명 한 번, 첫 공개 연도 최근 6년 · 끝난 해만)
// terms: 기술 시계열 영문 검색어(tl.terms) — 시계열 특허와 같은 제목 패턴. names: 관리 페이지 소부장 목록
// 돌려주는 값: { years, items: [{ name, kind, count }], unmatched } · 특허 DB가 없으면 null
export async function supplierPatents(terms, names = DEFAULT_SUPPLIERS) {
  const pattern = terms?.length ? patternFromTerms(terms) : null
  if (!pattern || !dbEnabled() || !(await patentDbReady())) return null
  const unmatched = []
  const dicts = []
  for (const n of names ?? DEFAULT_SUPPLIERS) {
    const d = supplierOf(n)
    if (!d) unmatched.push(n)
    else if (!dicts.some((x) => x.id === d.id)) dicts.push({ ...d, name: String(n).trim() })
  }
  if (!dicts.length) return { years: null, items: [], unmatched }
  const thisYear = new Date().getFullYear()
  const from = thisYear - 6
  const cols = dicts.map((_, i) => `count(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE ANY($${i + 4}::text[])))::int AS s${i}`)
  // 단어 경계 \b → PostgreSQL \y (patentDb.js toPg와 같음)
  const { rows } = await query(
    `SELECT ${cols.join(', ')} FROM display_patents WHERE pub >= $2 AND pub < $3 AND lower(title) ~ $1`,
    [pattern.toLowerCase().replace(/\\b/g, '\\y'), from * 10000, thisYear * 10000, ...dicts.map((d) => d.like)],
  )
  const items = dicts
    .map((d, i) => ({ name: d.name, kind: d.kind, count: rows[0]?.[`s${i}`] ?? 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
  return { years: `${from}~${thisYear - 1}`, items, unmatched, basis: '디스플레이 특허 DB' }
}
