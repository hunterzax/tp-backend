import csv
import os

csv_file = '/Users/zax/Documents/Project_TPA_SCAN/tp-backend/Outstanding+Issues3.csv'
base_path_prefix = '/Users/zax/Documents/Project_TPA_SCAN/VA146/TPA-F02/'
local_base_path = '/Users/zax/Documents/Project_TPA_SCAN/tp-backend/'

issues_by_file = {}

with open(csv_file, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Debugging keys if needed
        # if not issues_by_file:
        #     print(row.keys())
            
        file_path = row.get('File')
        if not file_path:
            continue
        
        # Map path
        if file_path.startswith(base_path_prefix):
            relative_path = file_path[len(base_path_prefix):]
            local_path = os.path.join(local_base_path, relative_path)
        else:
            local_path = file_path 

        if local_path not in issues_by_file:
            issues_by_file[local_path] = []
        
        issues_by_file[local_path].append({
            'cid': row.get('CID'),
            'type': row.get('Type'),
            'function': row.get('Function'),
        })

print(f"Found {len(issues_by_file)} files with issues.")
for fpath, issues in sorted(issues_by_file.items()):
    # Count issues by type
    types = {}
    for i in issues:
        t = i['type']
        types[t] = types.get(t, 0) + 1
    print(f"{fpath}: {len(issues)} issues {types}")
