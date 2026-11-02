import { useState } from 'react'
import { BoardView } from './features/board'
import { FeatureView } from './features/features/FeatureView'
import { MaterialLibrary } from './features/materials/MaterialLibrary'

type Menu = 'home' | 'board' | 'features' | 'materials'

function App() {
  const [menu, setMenu] = useState<Menu>('home')

  return (
    <>
      <nav style={{ display: 'flex', gap: 8, padding: 16 }}>
        <button type="button" onClick={() => setMenu('home')}>
          홈
        </button>
        <button type="button" onClick={() => setMenu('board')}>
          보드
        </button>
        <button type="button" onClick={() => setMenu('features')}>
          기능
        </button>
        <button type="button" onClick={() => setMenu('materials')}>
          자료함
        </button>
      </nav>

      <main style={{ padding: 16 }}>
        <section hidden={menu !== 'home'}>
          <p>메뉴에서 사용할 화면을 선택하세요.</p>
        </section>

        <section hidden={menu !== 'board'} style={{ height: '80vh' }}>
          <BoardView />
        </section>

        <section hidden={menu !== 'features'}>
          <FeatureView />
        </section>

        <section hidden={menu !== 'materials'}>
          <MaterialLibrary />
        </section>
      </main>
    </>
  )
}

export default App