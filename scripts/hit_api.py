"""临时：直接打后端确认服务端稳定"""
import sys, urllib.request, urllib.parse, json
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

CASES = [
    ('幼犬疫苗', True),
    ('幼犬疫苗', False),
    ('猫呕吐带血', True),
    ('猫呕吐带血', False),
]

for q, rerank in CASES:
    params = urllib.parse.urlencode({'q': q, 'top_k': 3, 'rerank': str(rerank).lower()})
    url = f'http://127.0.0.1:8000/api/vet/search?{params}'
    data = json.loads(urllib.request.urlopen(url).read())
    print(f'\n=== "{q}"  rerank={rerank} ===')
    for i, x in enumerate(data['results']):
        print(f'  #{i+1} [{x["score"]:.3f}] {x["title"]}')
