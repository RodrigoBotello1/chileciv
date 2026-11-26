"""Well-known project directories."""

from pathlib import Path

from .mapcfg import MAP

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" if MAP == "rm" else ROOT / "data" / MAP
RAW = DATA / "raw"  # untouched downloads, one folder per source (git-ignored)
INTERIM = DATA / "interim"  # per-source cleaned JSON (git-ignored)
WEB = ROOT / "web"
WEB_DATA = WEB / "data" if MAP == "rm" else WEB / MAP / "data"  # what the browser loads
