import {scoreTone} from './score-color';
describe('assignment outcome colors',()=>{
  it('uses the assignment threshold and preserves failing severity',()=>{
    expect(scoreTone(81,100,100)).toBe('amber');
    expect(scoreTone(100,100,100)).toBe('green');
    expect(scoreTone(36,100,100)).toBe('red');
    expect(scoreTone(60,100,60)).toBe('green');
    expect(scoreTone(0,100,0)).toBe('green');
    expect(scoreTone(0,0,0)).toBe('red');
  });
});
