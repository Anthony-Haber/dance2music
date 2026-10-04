import json
from pathlib import Path

from graphify.analyze import god_nodes, suggest_questions, surprising_connections
from graphify.build import build_from_json
from graphify.cache import save_semantic_cache
from graphify.cluster import cluster, score_all
from graphify.diagnostics import diagnose_extraction, format_diagnostic_report
from graphify.export import to_json
from graphify.report import generate


def main():
    out = Path('graphify-out')
    chunks = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(out.glob('.graphify_chunk_*.json'))]
    if len(chunks) != 2:
        raise RuntimeError('Expected two completed semantic chunks')
    new = {k: [item for c in chunks for item in c.get(k, [])] for k in ('nodes', 'edges', 'hyperedges')}
    new.update(input_tokens=0, output_tokens=0, token_usage_available=False)
    saved = save_semantic_cache(new['nodes'], new['edges'], new['hyperedges'], root='.')
    print(f'Cached {saved} files')
    cache_path = out / '.graphify_cached.json'
    cached = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    sem = {k: cached.get(k, []) + new[k] for k in ('nodes', 'edges', 'hyperedges')}
    sem['nodes'] = list({n['id']: n for n in sem['nodes']}.values())
    sem.update(input_tokens=0, output_tokens=0, token_usage_available=False)
    (out / '.graphify_semantic.json').write_text(json.dumps(sem, ensure_ascii=False), encoding='utf-8')
    ast = json.loads((out / '.graphify_ast.json').read_text(encoding='utf-8'))
    seen = {n['id'] for n in ast['nodes']}
    extraction = {
        'nodes': ast['nodes'] + [n for n in sem['nodes'] if n['id'] not in seen],
        'edges': ast['edges'] + sem['edges'],
        'hyperedges': sem['hyperedges'],
        'input_tokens': 0, 'output_tokens': 0, 'token_usage_available': False,
    }
    (out / '.graphify_extract.json').write_text(json.dumps(extraction, ensure_ascii=False), encoding='utf-8')
    detection = json.loads((out / '.graphify_detect.json').read_text(encoding='utf-8'))
    graph = build_from_json(extraction, root='.', directed=False)
    if graph.number_of_nodes() == 0:
        raise RuntimeError('Empty extraction; existing graph preserved')
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    labels = {cid: f'Community {cid}' for cid in communities}
    questions = suggest_questions(graph, communities, labels)
    if not to_json(graph, communities, str(out / 'graph.json')):
        raise RuntimeError('Graph shrink guard refused export; existing graph preserved')
    tokens = {'input': 0, 'output': 0}
    report = generate(graph, communities, cohesion, labels, gods, surprises, detection, tokens, '.', suggested_questions=questions)
    (out / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
    analysis = {
        'communities': {str(k): v for k, v in communities.items()},
        'cohesion': {str(k): v for k, v in cohesion.items()},
        'gods': gods, 'surprises': surprises, 'questions': questions,
    }
    (out / '.graphify_analysis.json').write_text(json.dumps(analysis, ensure_ascii=False), encoding='utf-8')
    health = diagnose_extraction(extraction, directed=False, root='.')
    (out / 'health.json').write_text(json.dumps(health, indent=2, ensure_ascii=False), encoding='utf-8')
    print(format_diagnostic_report(health))
    print(f'Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, {len(communities)} communities')
    for cid, ids in communities.items():
        print(json.dumps({'community': cid, 'size': len(ids), 'labels': [graph.nodes[n].get('label', n) for n in ids][:35]}, ensure_ascii=True))


if __name__ == '__main__':
    main()
