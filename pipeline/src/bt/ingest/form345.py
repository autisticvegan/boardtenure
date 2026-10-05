"""Forms 3/4/5 (insider ownership reports) — the one fully structured SEC source of
director relationships. Each reporting owner carries a durable CIK and explicit
isDirector/isOfficer flags; a Form 3's periodOfReport is the "date of event requiring
statement", i.e. the day the person became an insider.

Reporting-owner addresses are deliberately not extracted.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from lxml import etree


@dataclass(frozen=True)
class InsiderRelationship:
    form: str  # '3', '4', '5', '3/A', ...
    issuer_cik: str
    issuer_symbol: str | None
    period_of_report: date | None
    owner_cik: str
    owner_name: str  # SEC conformed name, usually 'LAST FIRST MIDDLE'
    is_director: bool
    is_officer: bool
    officer_title: str | None
    is_ten_percent_owner: bool
    is_other: bool
    other_text: str | None
    xml_path: str  # locator of the relationship element, for evidence


def _flag(el: etree._Element | None, tag: str) -> bool:
    if el is None:
        return False
    v = (el.findtext(tag) or "").strip().lower()
    return v in ("1", "true")


def _text(el: etree._Element | None, path: str) -> str | None:
    if el is None:
        return None
    v = el.findtext(path)
    return v.strip() if v and v.strip() else None


def parse(xml: bytes) -> list[InsiderRelationship]:
    root = etree.fromstring(xml, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    if root.tag != "ownershipDocument":
        raise ValueError(f"not an ownershipDocument: <{root.tag}>")
    form = _text(root, "documentType") or "?"
    period = _text(root, "periodOfReport")
    issuer = root.find("issuer")
    out = []
    for i, owner in enumerate(root.findall("reportingOwner"), start=1):
        rel = owner.find("reportingOwnerRelationship")
        out.append(
            InsiderRelationship(
                form=form,
                issuer_cik=f"{int(_text(issuer, 'issuerCik') or 0):010d}",
                issuer_symbol=_text(issuer, "issuerTradingSymbol"),
                period_of_report=date.fromisoformat(period) if period else None,
                owner_cik=f"{int(_text(owner, 'reportingOwnerId/rptOwnerCik') or 0):010d}",
                owner_name=_text(owner, "reportingOwnerId/rptOwnerName") or "",
                is_director=_flag(rel, "isDirector"),
                is_officer=_flag(rel, "isOfficer"),
                officer_title=_text(rel, "officerTitle"),
                is_ten_percent_owner=_flag(rel, "isTenPercentOwner"),
                is_other=_flag(rel, "isOther"),
                other_text=_text(rel, "otherText"),
                xml_path=f"/ownershipDocument/reportingOwner[{i}]/reportingOwnerRelationship",
            )
        )
    return out


def raw_xml_filename(primary_document: str) -> str:
    """EDGAR lists the XSL-rendered view (e.g. 'xslF345X05/wk-form3_1.xml') as the primary
    document; the raw XML is the same filename at the folder root."""
    return primary_document.rsplit("/", 1)[-1]
