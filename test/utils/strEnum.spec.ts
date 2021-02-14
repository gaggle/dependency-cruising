import { strEnum } from '../../src/utils/strEnum'

describe('strEnum', () => {
  it('should create an enum with string values', () => {
    const Direction = strEnum(['North', 'South'])
    expect(Direction.North).toEqual('North')
  })
})
