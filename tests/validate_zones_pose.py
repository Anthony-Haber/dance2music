"""Test-only conversion; never installs browser data in the Zones cache."""
import json
from pathlib import Path
import sys
import tempfile

import numpy as np

sys.path.insert(0, sys.argv[1])
from core.pose_cache import commit_pose_take, load_pose_take

rows = json.loads(Path(sys.argv[2]).read_text())
arrays = {
    'frame_index': np.array([r['frame_index'] for r in rows], dtype=np.int64),
    'timestamps_s': np.array([r['timestamp_s'] for r in rows], dtype=np.float64),
    'task_timestamp_ms': np.array([int(r['task_timestamp_ms']) for r in rows], dtype=np.int64),
    'detected': np.array([r['pose']['detected'] for r in rows], dtype=bool),
}
for name in ('image_landmarks', 'world_landmarks', 'visibility', 'presence'):
    arrays[name] = np.array([r['pose'][name] for r in rows], dtype=np.float32)
visibility, presence = arrays['visibility'], arrays['presence']
confidence = np.where(np.isfinite(visibility) & np.isfinite(presence), np.minimum(visibility, presence),
                      np.where(np.isfinite(visibility), visibility, np.where(np.isfinite(presence), presence, 0)))
arrays['landmark_valid'] = arrays['detected'][:, None] & np.isfinite(arrays['image_landmarks']).all(axis=2) & (confidence >= 0.5)
with tempfile.TemporaryDirectory(prefix='dance2music-pose-contract-') as temp:
    key = 'sha256:' + 'b' * 64
    commit_pose_take(key, {'source': {'source_id': 'test-fixture'}, 'partial': False}, arrays, cache_root=Path(temp))
    entry = load_pose_take(key, cache_root=Path(temp))
    assert entry is not None
    assert entry.arrays['landmark_valid'][0].all()
    assert not entry.arrays['landmark_valid'][30].any()
    assert np.isnan(entry.arrays['presence']).all()
print('PASS Zones v0.2 pose dtype/shape/timing/cache validation using temporary artifacts')
