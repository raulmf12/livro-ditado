import { describe, expect, it } from 'vitest'
import { AudioClock } from './latency.ts'

describe('AudioClock', () => {
  it('acha quando o trecho de áudio saiu', () => {
    const clock = new AudioClock()
    for (let i = 1; i <= 30; i++) clock.record(100, 1_000 + i * 100) // 3 s de áudio
    expect(clock.sentAt(1_000)).toBe(2_000) // o pedaço que termina em 1.000 ms saiu em t=2.000
    expect(clock.sentAt(1_050)).toBe(2_100) // fica no pedaço seguinte
    expect(clock.sentAt(3_000)).toBe(4_000)
  })

  it('não inventa tempo para áudio que ainda não saiu', () => {
    const clock = new AudioClock()
    clock.record(100, 10)
    expect(clock.sentAt(500)).toBeNull()
  })

  it('descarta o mais antigo para não crescer sem limite', () => {
    const clock = new AudioClock(10)
    for (let i = 1; i <= 100; i++) clock.record(100, i)
    expect(clock.sentAt(10_000)).toBe(100)
    expect(clock.sentAt(100)).toBeNull()
  })
})
