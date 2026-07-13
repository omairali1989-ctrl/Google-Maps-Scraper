"""
Shared test path setup.

The backend mixes top-level imports (``from settings import ...``,
``from db import ...``) with package imports (``from app.scraper import ...``).
Putting both the repo root and ``app/`` on sys.path lets either style resolve,
mirroring how the app runs in production (app/ is on the path via main.py).
"""

import os
import sys

_here = os.path.dirname(__file__)
_root = os.path.abspath(os.path.join(_here, "../../"))
_app = os.path.join(_root, "app")

for p in (_root, _app):
    if p not in sys.path:
        sys.path.insert(0, p)
