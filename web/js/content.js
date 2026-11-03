// Words, QSO pieces and the NIGHT COPY story.

export const CW_WORDS = [
  'CQ', 'DE', 'K', 'KN', 'R', 'TU', 'TNX', 'FER', 'UR', 'RST', 'NAME', 'QTH', 'HW', 'ES', 'FB', 'OM', 'YL',
  'GM', 'GA', 'GE', 'GN', 'PSE', 'AGN', 'BK', 'RIG', 'ANT', 'WX', 'HR', 'SRI', 'CUL', 'GL', 'DX', 'TEST',
  'QRZ', 'QRS', 'QRQ', 'QSB', 'QRM', 'QRN', 'QSL', 'QSY', 'QRP', 'QRT', '73', '88', '5NN', '599', '579',
  'WY6Y', 'POTA', 'SOTA', 'NR', 'ABT', 'WID', 'TMW',
];

export const WORDS = [
  'THE', 'AND', 'YOU', 'FOR', 'ARE', 'NOT', 'ALL', 'ANY', 'CAN', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET',
  'HAS', 'HIM', 'HOW', 'MAN', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'SHE', 'USE', 'SET', 'RUN',
  'TEN', 'SUN', 'RAIN', 'NIGHT', 'TOWER', 'SIGNAL', 'RADIO', 'KEY', 'COPY', 'SEND', 'RELAY', 'STATIC',
  'CODE', 'MASK', 'TRACE', 'NODE', 'WIRE', 'FENCE', 'CITY', 'STORM', 'NOISE', 'TUNE', 'SKIP', 'FADE',
  'PAPER', 'MUSE', 'TRUE', 'MUST', 'REST', 'NEAR', 'SAME', 'TERM', 'STEP', 'STOP', 'SEEN', 'MEET', 'TEAM',
  'UPPER', 'MASTER', 'MARK', 'SPARK', 'TURN', 'RETURN', 'SURE', 'NAMES', 'PART', 'SNAP', 'TRAP', 'NEST',
  'PANT', 'RUST', 'MUTE', 'PRESS', 'SPREE', 'TEMPT', 'TENSE', 'ENTER', 'SMART', 'STREAM', 'MEMENTO',
  'LIGHT', 'WATCH', 'WALL', 'LOW', 'WILL', 'JUST', 'JOIN', 'ZONE', 'FIVE', 'FROM', 'YOUR', 'FLOW',
  'GLOW', 'GHOST', 'VOICE', 'QUIET', 'HUNT', 'HOUSE', 'BEACON', 'BLACK', 'CLOCK', 'DATA', 'DOOR', 'EXIT',
];

export const NAMES = ['BOB', 'JIM', 'TOM', 'ANN', 'SUE', 'MIKE', 'JOE', 'AL', 'ED', 'BILL', 'DAVE', 'KEN', 'RON',
  'SAM', 'TED', 'PAT', 'DAN', 'MAX', 'RAY', 'LEE', 'TIM', 'KIM', 'JAN', 'ROB', 'STU', 'PETE', 'MARK', 'RUSS'];
export const QTHS = ['TX', 'OK', 'KS', 'CA', 'NY', 'FL', 'OH', 'MO', 'AR', 'NM', 'CO', 'AZ', 'WA', 'OR', 'MN',
  'TULSA', 'DALLAS', 'AUSTIN', 'DENVER', 'RENO', 'SALEM', 'MESA', 'TAOS', 'ENID', 'NORMAN', 'PARIS'];

export function rand(a) { return a[Math.floor(Math.random() * a.length)]; }

export function canSay(word, set) {
  for (const c of word) if (!set.has(c)) return false;
  return true;
}

export function callsign() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const r = () => L[Math.floor(Math.random() * 26)];
  const pre = rand(['K', 'W', 'N', 'A', 'K', 'W']);
  const two = pre === 'A' ? r() : (Math.random() < 0.4 ? r() : '');
  return pre + two + Math.floor(Math.random() * 10) + r() + r() + (Math.random() < 0.6 ? r() : '');
}

// ---- story ---------------------------------------------------------------------

// Each chapter covers a slice of the Koch order. Clearing its boss (Faux)
// opens the next slice. Lines are [speaker, text]; speaker picks the portrait.
export const CHAPTERS = [
  {
    title: 'STATIC AT THE FENCE', letters: 5, art: 'scene-01-tower', bossArt: 'bg-faux',
    intro: [
      ['NIGHTOP', 'Rain on the fence wire. The tower on the hill is keying again. Slow. Steady. Like it wants to be heard.'],
      ['VERA', 'Faux killed the packet relays at midnight. Whatever he is moving now, he is moving it the old way. Tones.'],
      ['NIGHTOP', 'Then I learn to hear it.'],
      ['VERA', 'Start with two. K and M. Do not count dots. Listen for the shape, the way you know a voice.'],
    ],
    outro: [
      ['FAUX', 'Someone is copying my traffic.'],
      ['VERA', 'He felt that. Good. Every letter you own is one he cannot hide behind.'],
    ],
  },
  {
    title: 'THE SHACK', letters: 10, art: 'scene-02-shack', bossArt: 'bg-faux',
    intro: [
      ['NIGHTOP', 'The shack smells like hot dust and solder. The rig hums each time the tower opens up.'],
      ['VERA', 'Five letters is not a language yet. But it is a start. He is sending node names now.'],
      ['NIGHTOP', 'I can almost feel the spacing. The gaps say as much as the tones.'],
    ],
    outro: [
      ['NIGHTOP', 'A fragment decodes clean: RELAY NODE, SOUTH TUNNEL.'],
      ['VERA', 'The old exchange under Fifth. My sister used to say it still breathes.'],
    ],
  },
  {
    title: 'RELAY TUNNEL', letters: 15, art: 'scene-10-relay-tunnel', bossArt: 'bg-faux',
    intro: [
      ['VERA', 'Down here the relays still click. Every one of them is a letter he trusted nobody would read.'],
      ['NIGHTOP', 'Then we read all of them.'],
    ],
    outro: [
      ['FAUX', 'You are a hobbyist with a paddle. Go home.'],
      ['NIGHTOP', 'He sends faster when he is scared. I heard every word.'],
    ],
  },
  {
    title: 'SIGNAL CITY', letters: 20, art: 'scene-06-cityscape', bossArt: 'bg-faux',
    intro: [
      ['RUNNER', 'Car is warm. Wipers are shot. Where to?'],
      ['VERA', 'Wherever the tones are loudest. He is relaying through the rooftops now.'],
    ],
    outro: [
      ['NIGHTOP', 'Twenty letters. The city is starting to sound like sentences.'],
      ['VERA', 'Then it is time you heard what my sister sent before she went quiet.'],
    ],
  },
  {
    title: 'MEET IN THE RAIN', letters: 25, art: 'scene-04-rain-meet', bossArt: 'bg-faux',
    intro: [
      ['VERA', 'Her last message was not packet. It was CW. Hand sent. Shaky.'],
      ['NIGHTOP', 'Then I copy it the way she sent it. By hand. By ear.'],
    ],
    outro: [
      ['VERA', 'Numbers. Bearings. She was hunting his transmitter.'],
      ['NIGHTOP', 'Then we finish her hunt.'],
    ],
  },
  {
    title: 'FOX HUNT', letters: 30, art: 'scene-15-foxhunt-bearing', bossArt: 'bg-faux',
    intro: [
      ['RUNNER', 'Beam says northeast. Then it says south. He is hopping.'],
      ['NIGHTOP', 'Three bearings and a good ear. That is all a fox hunt ever was.'],
    ],
    outro: [
      ['NIGHTOP', 'The lines cross at the old civic tower. The director\'s floor.'],
      ['FAUX', 'You should not have come up here.'],
    ],
  },
  {
    title: 'THE DIRECTOR\'S ROOM', letters: 35, art: 'scene-09-director-room', bossArt: 'bg-faux',
    intro: [
      ['VERA', 'Ledgers. Call lists. He was spoofing honest stations to cover what he did.'],
      ['NIGHTOP', 'Every spoof has a fist. His is too perfect. Machines do not hesitate.'],
    ],
    outro: [
      ['FAUX', 'Nobody will believe a midnight operator over the city.'],
      ['VERA', 'They will believe the logs. And we have all of them.'],
    ],
  },
  {
    title: 'THRESHOLD', letters: 41, art: 'scene-12-threshold-faux', bossArt: 'bg-faux',
    intro: [
      ['NIGHTOP', 'Last letters. Last relay. He is sending everything at once to drown us out.'],
      ['VERA', 'Then copy through it. You know these sounds now. They are yours.'],
    ],
    outro: [
      ['NIGHTOP', 'The tower goes quiet. For the first time in years the city hears its own voice.'],
      ['VERA', 'You can copy anything now, NightOp. Go find a real one. 14.050 is open tonight.'],
    ],
  },
];

export function chapterFor(unlocked) {
  return CHAPTERS.findIndex((c) => unlocked <= c.letters);
}

// Morse patterns, for teaching how to SEND a letter (receive stays sound-only).
export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-',
};

/** Spoken form, the way hams say it: "dah dah" for M. */
export function sayPattern(ch) {
  return (MORSE[ch] || '').split('').map((e) => (e === '.' ? 'dit' : 'dah')).join(' ');
}
