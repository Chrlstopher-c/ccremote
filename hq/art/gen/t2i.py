"""Workflow Qwen-Image 2.1 turbo texte → image (sans référence) pour un objet du décor."""
import json
import sys

sys.path.insert(0, '/mnt/projects/minimax-h3-studio/scripts')
from workflow_qwen21 import api_photo_qwen21  # noqa: E402

out, name, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
wf = api_photo_qwen21('PLACEHOLDER', [], w, h)
wf['461']['inputs']['filename_prefix'] = 'agent-hq/' + name
json.dump(wf, open(out, 'w'), indent=1)
