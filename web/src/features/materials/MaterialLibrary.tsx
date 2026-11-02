import { useState } from 'react'
import { SAMPLE_MATERIALS, type MaterialSample } from './sampleMaterials'

type Props = { materials?: MaterialSample[] }

export function MaterialLibrary({ materials = SAMPLE_MATERIALS }: Props) {
  // 선택한 자료는 객체가 아니라 ID로만 기억한다 (이름이 같아도 구분하기 위해)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = materials.find((m) => m.material_id === selectedId) ?? null

  return (
    <section style={{ display: 'flex', gap: 16, textAlign: 'left' }}>
      <div style={{ width: 240 }}>
        <h2>받은 자료함</h2>
        <p style={{ color: '#b45309' }}>예시 데이터 · 새로고침하면 초기화됩니다</p>
        {materials.length === 0 ? (
          <p>아직 받은 자료가 없습니다. Studio에서 코드를 보내면 여기에 나타납니다.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {materials.map((m) => (
              <li key={m.material_id}>
                <button
                  onClick={() => setSelectedId(m.material_id)}
                  aria-pressed={m.material_id === selectedId}
                  style={{ width: '100%', fontWeight: m.material_id === selectedId ? 700 : 400 }}
                >
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ flex: 1 }}>
        {selected === null ? (
          <p>왼쪽에서 자료를 선택하면 원문이 보입니다.</p>
        ) : (
          <>
            <h3>{selected.name}</h3>
            <p>
              {selected.source_path} · {selected.script_type}
            </p>
            {/* 원문은 가공하지 않고 그대로. pre가 공백·줄바꿈을 지켜준다 */}
            <pre style={{ background: '#111', color: '#eee', padding: 12, whiteSpace: 'pre', overflowX: 'auto' }}>
              <code>{selected.raw_code}</code>
            </pre>
          </>
        )}
      </div>
    </section>
  )
}
