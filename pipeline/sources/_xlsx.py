"""Read the cells of an .xlsx sheet with the standard library (zipfile + ElementTree)."""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def sheet_rows(path: Path, sheet_name: str) -> list[list[str]]:
    """Every row of the named sheet as a list of strings (empty cells as ""), in column order."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(t.text or "" for t in si.iter(_M + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    rid = next(s.get(_R + "id") for s in wb.find(_M + "sheets") if s.get("name") == sheet_name)
    part = target[rid].lstrip("/")
    part = part if part.startswith("xl/") else f"xl/{part}"
    out = []
    for row in ET.fromstring(z.read(part)).find(_M + "sheetData"):
        vals: list[str] = []
        for c in row:
            col = 0
            for ch in "".join(ch for ch in c.get("r", "") if ch.isalpha()):
                col = col * 26 + ord(ch) - 64
            while len(vals) < col - 1:
                vals.append("")
            v = c.find(_M + "v")
            if v is None:
                isv = c.find(_M + "is")
                vals.append("".join(t.text or "" for t in isv.iter(_M + "t")) if isv is not None else "")
            else:
                vals.append(shared[int(v.text)] if c.get("t") == "s" else (v.text or ""))
        out.append(vals)
    return out
