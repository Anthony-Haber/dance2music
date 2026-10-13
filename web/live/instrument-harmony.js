// Translation of instrument/harmony.py. Ordered pairs are (left, right).
export const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const INTERVALS = {
  major: [0, 4, 7], minor: [0, 3, 7], dominant7: [0, 4, 7, 10], major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10], minor_major7: [0, 3, 7, 11], half_diminished7: [0, 3, 6, 10],
  diminished7: [0, 3, 6, 9], major6: [0, 4, 7, 9], minor6: [0, 3, 7, 9],
  major69: [0, 4, 7, 9, 14], minor69: [0, 3, 7, 9, 14], major9: [0, 4, 7, 11, 14],
  minor9: [0, 3, 7, 10, 14], dominant9: [0, 4, 7, 10, 14],
  major13: [0, 4, 7, 11, 14, 21], minor13: [0, 3, 7, 10, 14, 21],
  dominant13: [0, 4, 7, 10, 14, 21], minor11: [0, 3, 7, 10, 14, 17],
  sus4: [0, 5, 7], dominant7sus4: [0, 5, 7, 10], augmented: [0, 4, 8],
  dominant7b9: [0, 4, 7, 10, 13], dominant7sharp9: [0, 4, 7, 10, 15],
  major7sharp11: [0, 4, 7, 11, 18],
};
export const SUFFIXES = {
  major: '', minor: 'm', dominant7: '7', major7: 'maj7', minor7: 'm7',
  minor_major7: 'm(maj7)', half_diminished7: 'm7b5', diminished7: 'dim7', major6: '6',
  minor6: 'm6', major69: '6/9', minor69: 'm6/9', major9: 'maj9', minor9: 'm9',
  dominant9: '9', major13: 'maj13', minor13: 'm13', dominant13: '13', minor11: 'm11',
  sus4: 'sus4', dominant7sus4: '7sus4', augmented: 'aug', dominant7b9: '7b9',
  dominant7sharp9: '7#9', major7sharp11: 'maj7#11',
};
export const CHORD_SIGNS = ['Open_Palm', 'Pointing_Up', 'Victory', 'Thumb_Up', 'Thumb_Down'];
export const QUALITY_ROWS = [
  ['major', 'minor6', 'half_diminished7', 'major6', 'major69'],
  ['minor', 'minor11', 'minor9', 'minor13', 'minor69'],
  ['diminished7', 'dominant7b9', 'augmented', 'dominant7sharp9', 'dominant7sus4'],
  ['major7', 'major9', 'major7sharp11', 'major13', 'minor_major7'],
  ['minor7', 'dominant9', 'sus4', 'dominant7', 'dominant13'],
];
export const mod12 = n => ((n % 12) + 12) % 12;
// Native visual palette: HSV(root/12, 0.55, 1), expressed as CSS RGB.
export function rootColor(root) {
  const hue = root / 2, low = 0.45, falling = 1 - 0.55 * (hue % 1), rising = low + 0.55 * (hue % 1);
  const rgb = [[1, rising, low], [falling, 1, low], [low, 1, rising],
    [low, falling, 1], [rising, low, 1], [1, low, falling]][Math.floor(hue) % 6];
  return '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
}
export const symbol = (root, quality) => ROOT_NAMES[root] + SUFFIXES[quality];
export function gestureQuality(left, right) {
  return QUALITY_ROWS[CHORD_SIGNS.indexOf(right)]?.[CHORD_SIGNS.indexOf(left)] ?? null;
}
export function rootRegion(frame, deadZone) {
  if (frame.hands.length !== 2 || !frame.torso_center || !frame.torso_px) return null;
  const dx = (frame.hands[0].wrist[0] + frame.hands[1].wrist[0]) / 2 - frame.torso_center[0];
  const dy = (frame.hands[0].wrist[1] + frame.hands[1].wrist[1]) / 2 - frame.torso_center[1];
  if (Math.hypot(dx, dy) <= deadZone * frame.torso_px) return null;
  const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(angle / (Math.PI / 6) + 0.5) % 12;
}

function bitCount(n) { let count = 0; while (n) { n &= n - 1; count++; } return count; }
function assignmentCosts(moves, maximum) {
  const full = (1 << moves.length) - 1, costs = Array(full + 1).fill(10000);
  costs[full] = 0;
  for (let mask = full - 1; mask >= 0; mask--) {
    const row = moves[bitCount(mask)];
    for (let col = 0; col < row.length; col++) {
      const bit = 1 << col;
      if (!(mask & bit) && row[col] <= maximum)
        costs[mask] = Math.min(costs[mask], row[col] + costs[mask | bit]);
    }
  }
  return costs;
}

// Minimum total movement, then maximum movement, then lexicographic note tuple.
// O(n*2^n) assignments, matching the native synth's oscillator identities.
export function voiceLead(previous, root, quality, registerShift = 0) {
  if (!Number.isInteger(root) || root < 0 || root > 11 || !INTERVALS[quality])
    throw new RangeError('Use a supported quality and root 0–11');
  if (!Number.isInteger(registerShift) || registerShift % 12)
    throw new RangeError('Register shift must be whole octaves');
  const intervals = INTERVALS[quality], initial = intervals.map(i => 48 + registerShift + root + i);
  if (initial.some(n => n < 0 || n > 127)) throw new RangeError('Chord exceeds MIDI range');
  if (previous.length !== intervals.length) return initial;
  const low = Math.max(0, 48 + registerShift), high = Math.min(127, 83 + registerShift);
  const candidates = previous.map(old => intervals.map(i => {
    let best = null;
    for (let n = low + mod12(root + i - low); n <= high; n += 12)
      if (best === null || Math.abs(n - old) < Math.abs(best - old)) best = n;
    return best;
  }));
  const moves = candidates.map((row, i) => row.map(n => Math.abs(n - previous[i])));
  let lower = 0, upper = Math.max(...moves.flat());
  const optimum = assignmentCosts(moves, upper)[0];
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (assignmentCosts(moves, middle)[0] === optimum) upper = middle;
    else lower = middle + 1;
  }
  const costs = assignmentCosts(moves, lower), notes = []; let mask = 0;
  for (let row = 0; row < previous.length; row++) {
    let chosen = -1;
    for (let col = 0; col < previous.length; col++) {
      const bit = 1 << col;
      if (!(mask & bit) && moves[row][col] <= lower &&
          moves[row][col] + costs[mask | bit] === costs[mask] &&
          (chosen < 0 || candidates[row][col] < candidates[row][chosen])) chosen = col;
    }
    notes.push(candidates[row][chosen]); mask |= 1 << chosen;
  }
  return notes;
}
