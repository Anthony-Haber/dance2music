#!/usr/bin/env python3
"""What shapes does she actually dance?

My seven labels (`reach`, `low`, `turn`…) are rules I wrote after watching
a clip for an afternoon. The rope earned its eleven movements the other
way round: record, cluster, look, name. This does that for the dance —
windows of pose, reduced and clustered across all three clips at once, so
the vocabulary is discovered rather than assumed, and so we can see
whether the three clips really use the same one.

    python vocabulary.py videos/VIDEO-*.mp4 [--k 6]

Writes to `output/_vocabulary/`:
    clusters.json     which window belongs to which shape, per clip
    sheet.png         every shape, four frames of it, for naming
    timelines.png     when each shape happens, in all three clips
    bank.json         a kNN bank in the rope's format, so the live
                      classifier can use these shapes as they are
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from dance_pose import (out_dir, _fill_gaps, _smooth, L_SH, R_SH, L_HIP, R_HIP,  # noqa: E402
                        L_WR, R_WR, L_EL, R_EL, L_KN, R_KN, L_AN, R_AN)

from config import OUT as _OUT  # noqa: E402
OUT = os.path.join(_OUT, '_vocabulary')
# the joints that say what a shape is (hands, elbows, knees, feet, head)
SHAPE_JOINTS = [L_WR, R_WR, L_EL, R_EL, L_KN, R_KN, L_AN, R_AN, 0]
WINDOW_S, HOP_S = 1.6, 0.4       # a dance shape lasts about this long


def pose_features(video):
    """(N, D) windows of body shape + how it is changing, and their times."""
    d = np.load(os.path.join(out_dir(video), 'landmarks.npz'))
    W, t, fps = _fill_gaps(d['W']), d['t'], float(d['fps'])
    sho = (W[:, L_SH] + W[:, R_SH]) / 2
    hip = (W[:, L_HIP] + W[:, R_HIP]) / 2
    torso = np.maximum(0.05, np.linalg.norm(sho - hip, axis=1))[:, None, None]
    P = (W[:, SHAPE_JOINTS] - hip[:, None, :]) / torso          # body-scaled, hip-centred
    # depth from a single camera is the least trustworthy axis; keep it,
    # but let height and width decide what a shape is
    P[:, :, 2] *= 0.3
    V = np.gradient(P, axis=0) * fps
    for a in (P, V):
        for j in range(a.shape[1]):
            for c in range(3):
                a[:, j, c] = _smooth(a[:, j, c], max(3, int(fps / 6)))
    F = np.concatenate([P.reshape(len(P), -1), 0.35 * V.reshape(len(V), -1)], axis=1)
    w, h = int(WINDOW_S * fps), max(1, int(HOP_S * fps))
    starts = range(0, max(1, len(F) - w), h)
    # a window is the shape at five moments through it: the pose and its arc
    rows, times = [], []
    for s in starts:
        seg = F[s:s + w]
        if len(seg) < w:
            break
        idx = np.linspace(0, w - 1, 5).astype(int)
        rows.append(seg[idx].reshape(-1))
        times.append(float(t[s + w // 2]))
    return np.asarray(rows, np.float32), np.asarray(times), fps


def _arm_columns(dim):
    """Columns of the window vector that belong to hands and elbows."""
    per_joint = 3
    n_joints = len(SHAPE_JOINTS)
    arm_joints = [0, 1, 2, 3]                       # L/R wrist, L/R elbow
    cols = []
    for moment in range(5):                          # five moments per window
        base_pos = moment * (2 * n_joints * per_joint)
        for j in arm_joints:
            cols += [base_pos + j * per_joint + c for c in range(per_joint)]
    return [c for c in cols if c < dim]


def build(videos, k=None, sub=1, seed=0):
    from sklearn.cluster import KMeans
    from sklearn.decomposition import PCA
    from sklearn.metrics import silhouette_score
    from sklearn.preprocessing import StandardScaler
    import umap

    F, times, owner = [], [], []
    for v in videos:
        f, t, _fps = pose_features(v)
        F.append(f)
        times.append(t)
        owner += [os.path.basename(v)] * len(f)
        print(f'  {os.path.basename(v):34} {len(f):4d} windows')
    F = np.vstack(F)
    times = np.concatenate(times)
    owner = np.array(owner)
    Z = StandardScaler().fit_transform(F)
    Z = PCA(n_components=min(40, Z.shape[1]), random_state=seed).fit_transform(Z)
    E = umap.UMAP(n_neighbors=25, min_dist=0.05, n_components=2,
                  random_state=seed).fit_transform(Z)

    best = None
    for kk in ([k] if k else range(3, 9)):
        # silhouette rewards the coarsest split (upright vs floor); when a
        # k is asked for, it is asked for
        km = KMeans(kk, n_init=10, random_state=seed).fit(Z)
        s = silhouette_score(Z, km.labels_)
        print(f'  k={kk}  silhouette {s:.3f}')
        if best is None or s > best[0]:
            best = (s, kk, km)
    s, k, km = best
    print(f'→ {k} shapes (silhouette {s:.3f})')
    lab = km.labels_
    if sub > 1:
        # the biggest cluster is "upright", which for music is three things:
        # arms down, arms open, an arm reaching. Split it on the arms alone.
        big = np.bincount(lab, minlength=k).argmax()
        m = lab == big
        arms = F[m][:, _arm_columns(F.shape[1])]
        sk = KMeans(sub, n_init=10, random_state=seed).fit(
            StandardScaler().fit_transform(arms))
        extra = sk.labels_
        lab = lab.copy()
        lab[m] = np.where(extra == 0, big, k + extra - 1)
        k = k + sub - 1
        print(f'   upright split into {sub} by the arms → {k} shapes')
    # order shapes by how much they are used, so shape 0 is the commonest
    order = np.argsort(-np.bincount(lab, minlength=k))
    remap = {old: new for new, old in enumerate(order)}
    lab = np.array([remap[x] for x in lab])
    # centres from the data, since a sub-split makes the fitted ones stale
    centres = np.stack([Z[lab == c].mean(axis=0) if np.any(lab == c) else Z.mean(axis=0)
                        for c in range(k)])
    d_to_centre = np.linalg.norm(Z - centres[lab], axis=1)
    os.makedirs(OUT, exist_ok=True)
    out = {'k': int(k), 'silhouette': float(s), 'window_s': WINDOW_S, 'hop_s': HOP_S,
           'videos': [os.path.basename(v) for v in videos],
           'windows': [{'video': str(o), 't': float(tt), 'shape': int(l), 'd': float(dd)}
                       for o, tt, l, dd in zip(owner, times, lab, d_to_centre)]}
    json.dump(out, open(os.path.join(OUT, 'clusters.json'), 'w'), indent=1)
    np.savez_compressed(os.path.join(OUT, 'embedding.npz'), E=E, Z=Z, lab=lab,
                        times=times, owner=owner)
    return out, videos


def sheet(clusters, videos, per=4):
    """Four frames of each shape, so it can be looked at and named."""
    from PIL import Image, ImageDraw
    by_video = {os.path.basename(v): v for v in videos}
    rows = []
    for shape in range(clusters['k']):
        picks = sorted((w for w in clusters['windows'] if w['shape'] == shape),
                       key=lambda w: w['d'])
        # spread the examples over the takes, not four frames of one moment
        chosen, seen = [], []
        for w in picks:
            if any(w['video'] == c['video'] and abs(w['t'] - c['t']) < 4 for c in chosen):
                continue
            chosen.append(w)
            seen.append(w['video'])
            if len(chosen) == per:
                break
        ims = []
        for w in chosen:
            p = os.path.join(OUT, f"_s{shape}_{len(ims)}.png")
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(w['t']),
                            '-i', by_video[w['video']], '-frames:v', '1',
                            '-vf', 'scale=200:-2', p], check=False)
            if os.path.exists(p):
                ims.append((Image.open(p).convert('RGB'), w))
        if not ims:
            continue
        wid = sum(i.width for i, _ in ims)
        hei = max(i.height for i, _ in ims)
        row = Image.new('RGB', (wid + 120, hei), (18, 17, 15))
        d = ImageDraw.Draw(row)
        d.text((10, hei // 2 - 6), f'shape {shape}', fill=(224, 122, 79))
        n = sum(1 for w in clusters['windows'] if w['shape'] == shape)
        d.text((10, hei // 2 + 10), f'{100 * n / len(clusters["windows"]):.0f}% of time',
               fill=(154, 144, 134))
        x = 120
        for im, w in ims:
            row.paste(im, (x, 0))
            d.text((x + 4, 4), f"{w['video'][-8:-4]} {w['t']:.0f}s", fill=(239, 233, 223))
            x += im.width
        rows.append(row)
    W = max(r.width for r in rows)
    H = sum(r.height for r in rows)
    out = Image.new('RGB', (W, H), (18, 17, 15))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height
    p = os.path.join(OUT, 'sheet.png')
    out.save(p)
    for f in os.listdir(OUT):
        if f.startswith('_s'):
            os.remove(os.path.join(OUT, f))
    print(p)


def timelines(clusters):
    """When each shape happens, and whether the clips share a vocabulary."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    vids = clusters['videos']
    k = clusters['k']
    cmap = plt.get_cmap('turbo')
    fig, axes = plt.subplots(len(vids) + 1, 1, figsize=(14, 2.2 * len(vids) + 2.6),
                             facecolor='#12110f',
                             gridspec_kw={'height_ratios': [1] * len(vids) + [1.3]})
    share = np.zeros((len(vids), k))
    for ax, v in zip(axes, vids):
        ws = [w for w in clusters['windows'] if w['video'] == v]
        for w in ws:
            ax.axvspan(w['t'] - clusters['hop_s'] / 2, w['t'] + clusters['hop_s'] / 2,
                       color=cmap(w['shape'] / max(1, k - 1)), lw=0)
        for s in range(k):
            share[vids.index(v), s] = sum(1 for w in ws if w['shape'] == s) / max(1, len(ws))
        ax.set_facecolor('#12110f')
        ax.set_yticks([])
        ax.set_ylabel(v[-12:-4], color='#9a9086', fontsize=8, rotation=0, ha='right', va='center')
        ax.tick_params(colors='#9a9086', labelsize=8)
        for sp in ax.spines.values():
            sp.set_color('#2e2b27')
    ax = axes[-1]
    ax.set_facecolor('#12110f')
    w = 0.8 / len(vids)
    for i, v in enumerate(vids):
        ax.bar(np.arange(k) + i * w, 100 * share[i], width=w, label=v[-12:-4],
               color=[cmap(s / max(1, k - 1)) for s in range(k)],
               edgecolor='#12110f', alpha=0.55 + 0.2 * i)
    ax.set_xticks(np.arange(k) + 0.4 - w / 2)
    ax.set_xticklabels([f'shape {s}' for s in range(k)], color='#9a9086', fontsize=8)
    ax.set_ylabel('% of clip', color='#9a9086', fontsize=8)
    ax.tick_params(colors='#9a9086', labelsize=8)
    ax.legend(fontsize=7, facecolor='#1b1917', edgecolor='#2e2b27', labelcolor='#efe9df')
    for sp in ax.spines.values():
        sp.set_color('#2e2b27')
    fig.suptitle('when each shape happens · and how much each clip uses it',
                 color='#efe9df', fontsize=11)
    fig.tight_layout()
    p = os.path.join(OUT, 'timelines.png')
    fig.savefig(p, dpi=120, facecolor='#12110f')
    plt.close(fig)
    # how alike are the three clips' vocabularies?
    print('\nvocabulary overlap (1 = identical use of shapes):')
    for i in range(len(vids)):
        for j in range(i + 1, len(vids)):
            ov = float(np.minimum(share[i], share[j]).sum())
            print(f'  {vids[i][-12:-4]} vs {vids[j][-12:-4]}: {ov:.2f}')
    print(p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('videos', nargs='+')
    ap.add_argument('--k', type=int, default=None)
    ap.add_argument('--sub', type=int, default=1,
                    help='split the biggest (upright) cluster into this many by the arms')
    a = ap.parse_args()
    cl, vids = build(a.videos, a.k, a.sub)
    sheet(cl, vids)
    timelines(cl)


if __name__ == '__main__':
    main()
