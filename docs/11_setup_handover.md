# 11. 받아서 실행하기 · 인수인계

> **이 문서로 알 수 있는 것**
> * 코드를 받아 내 컴퓨터에서 켜는 방법 (10분)
> * 무엇이 없으면 어떤 기능만 빠지는지
> * 데이터(특허 · 논문) 채우기, AI 연결
> * 서버에 올리기(Railway)와 운영을 넘겨받을 때 확인할 것

## 1. 내 컴퓨터에서 켜기

**필요한 것:** Node.js 22, Git. (PostgreSQL · AI · 네이버 키는 없어도 켜진다 — 2장)

```bash
git clone https://github.com/khyun-0123/techbrief.git
cd techbrief
npm install
cp .env.example .env.local     # 설정 파일. 칸마다 설명이 붙어 있다
npm run dev                    # 화면 + API → http://localhost:5173
```

`.env.local`에 처음 채울 값 — 이것만 있으면 주요 흐름을 다 볼 수 있다.

| 값 | 무엇 | 없으면 |
| :-- | :-- | :-- |
| `ADMIN_PASSWORD` | 관리 페이지(`/admin`) 비밀번호, 아이디는 `admin` | 설정을 아무도 못 바꿈 |
| `DATABASE_URL` | PostgreSQL 주소 (`postgresql://사용자:비밀번호@호스트:5432/DB이름`) | 서버 메모리 + 브라우저 저장소로만 돎 (껐다 켜면 사라짐) |
| `NAVER_CLIENT_ID` · `NAVER_CLIENT_SECRET` | 네이버 뉴스 검색 (NCP 콘솔 › API HUB) | 뉴스 수집 · 찾기 빠짐, RSS · 논문은 됨 |
| AI 한 곳 — `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` 또는 `LLM_BASE_URL` + `LLM_SUMMARY_MODEL` | 요약 · 보고서를 쓸 AI (OpenAI 호환이면 어디든) | 요약 · 보고서만 빠짐, 판정 · 분석은 됨 |

* `.env.local`은 GitHub에 올라가지 않는다. **키 · 비밀번호를 커밋하지 않는다.**
* DB 테이블은 앱을 켤 때 자동으로 만든다.
* 로컬 PostgreSQL이 없으면 Docker로: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16` → `DATABASE_URL=postgresql://postgres:pw@localhost:5432/postgres`

## 2. 있으면 좋은 것 (기능별)

| 기능 | 필요한 것 | 준비 |
| :-- | :-- | :-- |
| 특허 판정 · 기술 단계 | 특허 DB | `npm run patent-db` — Google Cloud 서비스 계정 키(`GCP_KEY_FILE`, **프로젝트 폴더 밖에**), BigQuery 약 42GB 조회(월 1TB 무료 안), 1~2시간 |
| 연관 키워드 맵 낱말 | Kiwi 형태소 모델 | `npm run kiwi-model` (약 105MB, `~/techbrief-data`) |
| 국내 논문 | KCI 키 | `KCI_API_KEY`, 지난 자료 채우기 `npm run kci-oai` |
| 논문 | OpenAlex 키 (선택) | `OPENALEX_API_KEY` — 없어도 공용 한도로 돎 |
| 「예상 밖 급증」 | 파이썬 + TimesFM | 없으면 저절로 빠짐, 끄기 `TIMESFM=off` |
| 외부 공개 | 접속 코드 | `ACCESS_CODE` — 화면 · API 앞에 코드 입력 문 |

* 수집 · 미리 요약은 켜 두면 저절로 돈다(2시간마다). 여러 앱이 같은 DB를 쓰면 하나만 수집하게 나머지는 `REFRESH_SCHEDULER=off`.
* 키 대부분은 관리 페이지 **「수집 대상 › 수집 API 키」**에서도 넣을 수 있다 (암호화 저장).

## 3. AI 연결 바꾸기

관리 페이지 `/admin` › **AI 모델** › 「AI 연결 · API 키」에서 고른다. 코드에 모델 이름을 박지 않는다.

| 쓰는 곳 | 넣는 값 | 권장 동시 요청 수 |
| :-- | :-- | :-: |
| 자체 서버 (Ollama · vLLM 등) | 주소 · 모델 (`LLM_BASE_URL` · `LLM_SUMMARY_MODEL`) | GPU 1장이면 1 |
| OpenRouter 등 API | 키 · 모델 | 8 |
| Vertex AI | 서버의 Google 서비스 계정 (키 입력 없음) — GCP에서 Vertex AI API · Gemma 4 관리형 API를 켜야 함 | 8~16 |

모델을 고를 때는 [06 AI 모델 평가](06_model_evaluation.md)의 상황별 추천을 본다. 시간은 [07](07_performance_ops.md).

## 4. 서버에 올리기 (Railway 기준)

| 항목 | 값 |
| :-- | :-- |
| 서비스 | 앱 1개 + PostgreSQL 1개 (같은 프로젝트) |
| 빌드 | `npm ci && npm run build` |
| 시작 | `npm run kiwi-model && node scripts/serve.mjs preview` (운영 모드 — 메모리가 개발 모드의 몇 분의 1) |
| 볼륨 | 앱에 `/data` → `KIWI_MODEL_DIR=/data/kiwi/models/cong/base` · `PATENT_TITLES_DIR=/data` |
| 환경 값 | `.env.local`과 같게 + `HOST=0.0.0.0` · `TRUST_PROXY=1` · `DATABASE_URL=${{Postgres.DATABASE_URL}}` (PORT는 Railway가 줌) |
| 헬스체크 | `/healthz` (접속 코드 없이 「ok」) |
| 회사 도메인 | `ALLOWED_HOSTS=그 도메인` |

* main에 머지하면 자동으로 다시 배포된다 — 몇 초 502가 나지만 화면은 기다렸다가 이어 간다.
* 다른 서버로 옮길 때 **데이터는 `pg_dump` / `pg_restore`로** 옮긴다. 특허 · 논문 DB는 다시 받으려면 오래 걸린다.
* 회사 안에 둘 때 바뀌는 곳은 [02 구조](02_architecture.md) 2장 · [08 회사 도입](08_data_terms.md).

## 5. 인수인계 — 운영을 넘겨받을 때

> 관리 페이지 › **관리 안내**에 맡은 사람을 위한 설명서가 있다 (웹 · PDF). 이 장은 그 요약.

**넘겨받을 것**

| 무엇 | 확인 |
| :-- | :-- |
| GitHub 저장소 권한 | 쓰기 권한 · main 보호 규칙 |
| 서버 (Railway 프로젝트) | 멤버 초대, **사용 한도**(닿으면 앱 · DB가 같이 꺼짐) |
| 키 · 비밀번호 목록 | 관리자 비밀번호 · 접속 코드 · 네이버 · AI · GCP 서비스 계정 · KCI — 값은 문서가 아니라 직접 전달 |
| DB 최신 백업 | `pg_dump -Fc` 파일 |

**받자마자 할 일**

1. 관리자 비밀번호 · 접속 코드 바꾸기 (관리 페이지 › **접속 · 보안**)
2. 관리 페이지 **개요**에서 시스템 상태(AI · DB 연결), 「쌓인 데이터」 숫자 확인
3. **운영 › 외부 출처 상태**에서 수집이 도는지, **운영 › 오류 기록**에 반복 오류가 없는지

**평소 점검 (주 1회면 충분)**

| 볼 곳 | 이상 신호 | 조치 |
| :-- | :-- | :-- |
| 운영 › 외부 출처 상태 | 한도 80% 넘음 · 「막힘」 | 한도가 차면 자동 수집이 먼저 멈춤 — 다음 날 풀림 |
| 수집 출처 | 「저장 0건」 경고 | RSS 주소가 바뀌었는지 「시험」 |
| 오류 기록 | 같은 오류 반복 | 메시지로 원인 파일을 찾음 |
| AI 모델 | 401 | K-EXAONE 키는 **30일마다 만료** — 새 키 넣기 |
| 특허 DB | 분기가 지남 | `npm run patent-db`로 새로 받기 |

**하지 말 것**

* 키 파일(`.env.local` · 서비스 계정 JSON)을 프로젝트 폴더 안에 두거나 커밋하기 — 개발 서버가 주소로 내려 줄 수 있다.
* 같은 DB에 앱 두 개가 둘 다 수집하기 — 요약이 두 번 돌아 비용이 두 배.
* 뉴스 본문을 외부 상용 AI에 넣는 쪽으로 바꾸기 전에 [08 약관](08_data_terms.md) 확인.

## 6. 코드에서 먼저 볼 곳

| 고치려는 것 | 파일 |
| :-- | :-- |
| 중요도 점수 | `server/collector/score.js` (배점은 관리 페이지에서도) |
| 위협 · 기회 판정 · 기술 단계 | `server/keywordBundle.js` · `server/timeline.js` |
| AI 지시문 | `server/llm/prompts.js` · `server/llm/reportPrompts.js` |
| 근거 대조 | `server/llm/evidence.js` |
| 보고서 PPT 양식 | `scripts/report-template.mjs` · `src/reportSlides.js` · `templates/` |
| 화면 | `src/` (디자인 토큰 `src/tokens.css`, 부품 카탈로그 `npm run storybook`) |

검사: `npm run lint` · `npm run build`가 통과해야 한다.
