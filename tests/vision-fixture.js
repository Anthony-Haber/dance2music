// Deterministic detector substitute for exercising the real live-page controls.
const point = i => ({ x: 0.2 + i / 100, y: 0.2 + i / 100, z: -i / 100, visibility: 0.95, presence: 0.9 });
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = { createFromOptions: async (_fileset, options) => {
  if (!options.baseOptions.modelAssetBuffer.length) throw new Error('Missing model bytes');
  await new Promise(resolve => setTimeout(resolve, 300));
  let frame = 0;
  return { close() {}, detectForVideo(_video, _time, callback) {
    callback(++frame % 7 === 0 ? { landmarks: [], worldLandmarks: [] } : {
      landmarks: [Array.from({ length: 33 }, (_, i) => point(i))],
      worldLandmarks: [Array.from({ length: 33 }, (_, i) => point(i))],
    });
  } };
} };
export const GestureRecognizer = { createFromOptions: async (_fileset, options) => {
  if (!options.baseOptions.modelAssetBuffer.length) throw new Error('Missing hand model bytes');
  await new Promise(resolve => setTimeout(resolve, 100));
  return { recognizeForVideo() {
    const n = options.numHands;
    return {
      landmarks: Array.from({ length: n }, () => Array.from({ length: 21 }, (_, i) => point(i))),
      worldLandmarks: Array.from({ length: n }, () => Array.from({ length: 21 }, (_, i) => point(i))),
      handedness: Array.from({ length: n }, (_, i) => [{ categoryName: i ? 'Right' : 'Left', score: 0.95 }]),
      gestures: Array.from({ length: n }, () => [{ categoryName: 'Open_Palm', score: 0.9 }]),
    };
  } };
} };
