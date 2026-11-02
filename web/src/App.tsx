import { useState } from 'react'
import { BoardView } from './features/board'

function App() {
  const [menu, setMenu] = useState<'home' | 'board'>('home')

  return (
    <>
      <nav style={{ display: 'flex', gap: 8, padding: 16 }}>
        <button type="button" onClick={() => setMenu('home')}>
          홈
        </button>
        <button type="button" onClick={() => setMenu('board')}>
          보드
        </button>
      </nav>

      <main>
        {menu === 'board' ? (
          <div style={{ height: '80vh' }}>
            <BoardView />
          </div>
        ) : (
          <p>보드 메뉴를 눌러 주세요.</p>
        )}
      </main>
    </>
  )
}

export default App