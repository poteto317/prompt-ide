import { describe, it, expect } from 'vitest'
import { createCliSessionReservations } from '../cliSessionReservations'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-9222-222222222222'

describe('createCliSessionReservations', () => {
  it('予約できたら解除の関数を返し、同じ ID の 2 回目は null(別の ID は予約できる)', () => {
    const reservations = createCliSessionReservations()
    const release = reservations.tryReserve(ID)
    expect(release).toEqual(expect.any(Function))
    expect(reservations.has(ID)).toBe(true)
    expect(reservations.tryReserve(ID)).toBeNull()
    expect(reservations.tryReserve(OTHER)).toEqual(expect.any(Function))
  })

  it('解除すると同じ ID をもう一度予約できる', () => {
    const reservations = createCliSessionReservations()
    reservations.tryReserve(ID)?.()
    expect(reservations.has(ID)).toBe(false)
    expect(reservations.tryReserve(ID)).toEqual(expect.any(Function))
  })

  it('解除の関数を 2 回呼んでも、その後に別の起動が取り直した予約は外さない', () => {
    const reservations = createCliSessionReservations()
    const first = reservations.tryReserve(ID)
    first?.()
    const second = reservations.tryReserve(ID)
    expect(second).not.toBeNull()
    first?.()
    expect(reservations.has(ID)).toBe(true)
  })
})
