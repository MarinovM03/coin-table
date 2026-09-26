import { describe, expect, it } from 'vitest';
import { commandFor } from './keys';

describe('commandFor', () => {
  it('maps the US layout', () => {
    expect(commandFor({ code: 'Digit1', key: '1' })).toBe('myth');
    expect(commandFor({ code: 'Space', key: ' ' })).toBe('send');
    expect(commandFor({ code: 'KeyC', key: 'c' })).toBe('camera');
    expect(commandFor({ code: 'Slash', key: '/' })).toBe('hide');
    expect(commandFor({ code: 'Slash', key: '?' })).toBe('how');
    expect(commandFor({ code: 'BracketRight', key: ']' })).toBe('fee-up');
  });

  it('follows the printed character on AZERTY', () => {
    // The key labelled M sits where US keyboards have ";".
    expect(commandFor({ code: 'Semicolon', key: 'm' })).toBe('mute');
    // The "1" key types "&" unless Shift is held; digits still go by position.
    expect(commandFor({ code: 'Digit1', key: '&' })).toBe('myth');
  });

  it('handles QWERTZ, where / is Shift+7 and [ is AltGr+8', () => {
    expect(commandFor({ code: 'Digit7', key: '/' })).toBe('hide');
    expect(commandFor({ code: 'Digit8', key: '[' })).toBe('fee-down');
  });

  it('ignores movement and unknown keys', () => {
    expect(commandFor({ code: 'KeyW', key: 'w' })).toBeNull();
    expect(commandFor({ code: 'KeyZ', key: 'z' })).toBeNull();
  });
});
