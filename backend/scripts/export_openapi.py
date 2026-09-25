"""Write the OpenAPI schema to frontend/shared/openapi.json (then run `npm run gen:api` in frontend/web)."""

import json
from pathlib import Path

from app.main import app

out = Path(__file__).resolve().parents[2] / "frontend" / "shared" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2), encoding="utf-8")
print(f"wrote {out}")
