"""Which map the pipeline builds: the Santiago Metropolitan Region (1 km hexes) or continental Chile (5 km hexes).

Choose with the environment variable CHILECIV_MAP=rm|chile (default rm). Each map has its own data folder
(data/ or data/chile/) and web data folder (web/data/ or web/chile/data/), so the two never overwrite each other.
"""

from __future__ import annotations

import os

MAP = os.environ.get("CHILECIV_MAP", "rm")

CONFIGS = {
    "rm": {
        "name": "Región Metropolitana",
        "name_en": "Santiago Metropolitan Region",
        "abbr": "RM",
        "regions": {"13"},  # INE region codes kept; None = all
        "state_level": "provincia",  # what plays the role of a US state
        # (lon0, lat0, lon1, lat1): bbox fits the projection; window is what is downloaded (bbox plus the map margin)
        "bbox": (-71.85, -34.40, -69.65, -32.80),
        "window": (-72.00, -34.60, -69.45, -32.60),
        "albers": {"lat1": -34.0, "lat2": -33.2, "lat0": -33.6, "lon0": -70.75},
        "hex_km": 1.0,
        "srtm_stride": 1,  # 15 arc-second samples
        "worldcover_level": 4,  # 1/16 overview, ~148 m pixels
        "wonders": {"protected_area": 6, "historic_monument": 12, "university": 8, "tallest_building": 3},
    },
    "chile": {
        "name": "Chile",
        "name_en": "Chile",
        "abbr": "CL",
        "regions": None,
        "state_level": "region",
        # Continental Chile, Chiloé and Tierra del Fuego; Rapa Nui, Juan Fernández, the Desventuradas and the
        # Antarctic Territory fall outside, as usaciv leaves out Alaska and Hawaii.
        "bbox": (-75.8, -56.0, -66.4, -17.4),
        "window": (-76.6, -56.6, -65.6, -16.8),
        "albers": {"lat1": -50.0, "lat2": -24.0, "lat0": -37.0, "lon0": -71.0},
        "hex_km": 5.0,
        "srtm_stride": 4,  # one sample per arc-minute (~1.85 km), ~19 per hex
        "worldcover_level": 5,  # 1/32 overview, ~300 m pixels
        "wonders": {"protected_area": 12, "historic_monument": 20, "university": 10, "tallest_building": 3},
    },
}

if MAP not in CONFIGS:
    raise SystemExit(f"CHILECIV_MAP must be one of {sorted(CONFIGS)}, got {MAP!r}")
CFG = CONFIGS[MAP]


def keep_region(code: str) -> bool:
    """True if an INE region code ("13", "5", "05") belongs to this map."""
    regs = CFG["regions"]
    return regs is None or str(code).lstrip("0") in {r.lstrip("0") for r in regs}
