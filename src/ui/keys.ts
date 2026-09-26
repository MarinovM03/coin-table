export type Command =
  | 'myth'
  | 'reality'
  | 'send'
  | 'enter'
  | 'next-coin'
  | 'prev-coin'
  | 'pick'
  | 'clear'
  | 'fee-down'
  | 'fee-up'
  | 'camera'
  | 'reset'
  | 'hide'
  | 'how'
  | 'mute'
  | 'labels'
  | 'escape';

export function commandFor(e: Pick<KeyboardEvent, 'code' | 'key'>): Command | null {
  // Digits by position: on AZERTY the "1" key types "&" unless Shift is held.
  switch (e.code) {
    case 'Digit1':
    case 'Numpad1':
      return 'myth';
    case 'Digit2':
    case 'Numpad2':
      return 'reality';
    case 'Space':
      return 'send';
    case 'Enter':
    case 'NumpadEnter':
      return 'enter';
    case 'ArrowRight':
      return 'next-coin';
    case 'ArrowLeft':
      return 'prev-coin';
    case 'NumpadDivide':
      return 'hide';
    case 'Escape':
      return 'escape';
  }
  switch (e.key.toLowerCase()) {
    case 'p':
      return 'pick';
    case 'x':
      return 'clear';
    case '[':
    case '{':
      return 'fee-down';
    case ']':
    case '}':
      return 'fee-up';
    case 'c':
      return 'camera';
    case 'r':
      return 'reset';
    case '/':
      return 'hide';
    case 'h':
    case '?':
      return 'how';
    case 'm':
      return 'mute';
    case 'l':
      return 'labels';
  }
  // Layouts that need AltGr for brackets or slash also get the US key positions.
  switch (e.code) {
    case 'BracketLeft':
      return 'fee-down';
    case 'BracketRight':
      return 'fee-up';
    case 'Slash':
    case 'IntlRo':
      return 'hide';
  }
  return null;
}
