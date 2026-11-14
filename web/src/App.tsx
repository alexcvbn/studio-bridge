import { useState } from 'react'
import { BoardView } from './features/board'
import { FeatureView } from './features/features/FeatureView'
import { MaterialLibrary } from './features/materials/MaterialLibrary'

type Menu = 'home' | 'board' | 'features' | 'materials'

function App() {
  const [menu, setMenu] = useState<Menu>('home')
  // 기능 화면에 열려 있는 기능. 보드의 '기능 열기'와 기능 목록 선택이 같은 값을 쓴다. (04회차 #14 조립)
  const [openFeatureId, setOpenFeatureId] = useState<string | null>(null)

  const openFeature = (featureId: string) => {
    setOpenFeatureId(featureId)
    setMenu('features')
  }

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
          <BoardView onOpenFeature={openFeature} />
        </section>

        <section hidden={menu !== 'features'}>
          <FeatureView openFeatureId={openFeatureId} onSelectFeature={setOpenFeatureId} />
        </section>

        <section hidden={menu !== 'materials'}>
          <MaterialLibrary />
        </section>
      </main>
    </>
  )
}

export default App