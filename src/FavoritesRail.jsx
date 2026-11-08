// 왼쪽 검색어 목록 (13 문서 F3)
// - 즐겨찾기 ☆: 팀이 같이 쓰는 검색어 (DB). 자동 수집 키워드와 별개
// - 최근 검색어: 「네이버에서 찾기」를 하면 자동으로 쌓임 (이 브라우저에만, 최신 10개). ☆를 누르면 즐겨찾기로
function QueryItem({ q, active, starred, onSearch, onStar, onRemove, removeLabel }) {
  return (
    <li className={q === active ? 'fav-item active' : 'fav-item'}>
      <button
        type="button"
        className={starred ? 'fav-toggle on' : 'fav-toggle'}
        onClick={() => onStar(q)}
        aria-pressed={starred}
        aria-label={starred ? `${q} 즐겨찾기 해제` : `${q} 즐겨찾기`}
        title={starred ? '즐겨찾기 해제' : '즐겨찾기 (팀 공용)'}
      >
        {starred ? '★' : '☆'}
      </button>
      <button type="button" className="fav-go" onClick={() => onSearch(q)} title={`'${q}' 뉴스·논문에서 찾기`}>
        {q}
      </button>
      {onRemove && (
        <button type="button" className="fav-remove" onClick={() => onRemove(q)} aria-label={`${q} ${removeLabel}`}>
          ×
        </button>
      )}
    </li>
  )
}

function FavoritesRail({ favorites, recent, active, onSearch, onToggleFavorite, onRemoveRecent }) {
  const recentOnly = recent.filter((q) => !favorites.includes(q))
  return (
    <nav className="panel fav-rail" aria-label="검색어">
      <div className="fav-section">
        <h2 className="fav-title">즐겨찾기</h2>
        {favorites.length === 0 ? (
          <p className="fav-empty">최근 검색어의 ☆를 누르면 여기에 모여요</p>
        ) : (
          <ul className="fav-list">
            {favorites.map((q) => (
              <QueryItem key={q} q={q} active={active} starred onSearch={onSearch} onStar={onToggleFavorite} />
            ))}
          </ul>
        )}
      </div>
      <div className="fav-section">
        <h2 className="fav-title">최근 검색어</h2>
        {recentOnly.length === 0 ? (
          <p className="fav-empty">「뉴스·논문에서 찾기」로 찾은 말이 여기에 쌓여요</p>
        ) : (
          <ul className="fav-list">
            {recentOnly.map((q) => (
              <QueryItem
                key={q}
                q={q}
                active={active}
                starred={false}
                onSearch={onSearch}
                onStar={onToggleFavorite}
                onRemove={onRemoveRecent}
                removeLabel="최근 검색어에서 지우기"
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}

export default FavoritesRail
