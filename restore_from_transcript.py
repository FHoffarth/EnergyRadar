import json
import os

transcript_path = r'C:\Users\Flo\.gemini\antigravity\brain\bee07d01-190e-425a-aff0-f4f955df577b\.system_generated\logs\transcript_full.jsonl'
targets = ['backup.py', 'export.py', 'MemoryScreen.qml', 'weather.py', 'test_backup.py', 'test_export.py']

for line in open(transcript_path, 'r', encoding='utf-8'):
    if 'write_to_file' in line:
        step = json.loads(line)
        if 'tool_calls' in step:
            for call in step['tool_calls']:
                func = call.get('function', call)
                if func['name'] == 'default_api:write_to_file':
                    args = json.loads(func['arguments'])
                    target = args['TargetFile']
                    if any(x in target for x in targets):
                        print(f'Found {target}, size {len(args["CodeContent"])}')
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        with open(target, 'w', encoding='utf-8') as f:
                            f.write(args['CodeContent'])
