// 즐겨찾는 검색어 ☆ (13 문서 F3). 자동 수집 키워드와 별개 — 누르면 네이버에서 바로 찾기. 팀 공용
function FavoritesRail({ favorites, active, onSearch, onRemove }) {
  return (
    <nav className="panel fav-rail" aria-label="즐겨찾는 검색어">
      <h2 className="fav-title">☆ 즐겨찾기</h2>
      {favorites.length === 0 ? (
        <p className="fav-empty">찾기 결과 위의 ☆를 누르면 여기에 모여요</p>
      ) : (
        <ul className="fav-list">
          {favorites.map((q) => (
            <li key={q} className={q === active ? 'fav-item active' : 'fav-item'}>
              <button type="button" className="fav-go" onClick={() => onSearch(q)} title={`'${q}' 네이버에서 찾기`}>
                {q}
              </button>
              <button type="button" className="fav-remove" onClick={() => onRemove(q)} aria-label={`${q} 즐겨찾기 해제`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

export default FavoritesRail
