"""Document text extraction and verbatim-quote verification.

Every extracted fact (deterministic, LLM or manual) carries a quote. A quote counts as
verified only if it occurs in the source document after normalizing whitespace and
typographic variants, never after paraphrase-tolerant fuzzy matching.
"""

from __future__ import annotations

import re
import unicodedata

from lxml import html as lxml_html

_BLOCK_TAGS = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "td", "th"}
_TRANSLATE = str.maketrans({
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',  # curly quotes
    "\u2013": "-", "\u2014": "-", "\u2012": "-", "\u2212": "-",  # dashes, minus
    "\u00a0": " ", "\u2009": " ", "\u202f": " ",                 # non-breaking/thin spaces
    "\u200b": "", "\u00ad": "",                                  # zero-width space, soft hyphen
})


def html_to_text(raw: bytes) -> str:
    """Visible text of an HTML/iXBRL filing with block boundaries as newlines."""
    doc = lxml_html.fromstring(raw)
    for bad in doc.xpath("//script|//style|//*[local-name()='header' and contains(@style,'display:none')]"):
        bad.drop_tree()
    for hidden in doc.xpath("//*[contains(translate(@style,' ',''),'display:none')]"):
        hidden.drop_tree()
    for el in doc.iter():
        if isinstance(el.tag, str) and el.tag.split("}")[-1].lower() in _BLOCK_TAGS:
            el.tail = "\n" + (el.tail or "")
    text = doc.text_content()
    text = unicodedata.normalize("NFKC", text)
    lines = (re.sub(r"[ \t\f\v\u00a0]+", " ", ln).strip() for ln in text.splitlines())
    return "\n".join(ln for ln in lines if ln)


def normalize_for_match(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).translate(_TRANSLATE)
    return re.sub(r"\s+", " ", s).strip()


def find_quote(document_text: str, quote: str) -> int:
    """Offset of `quote` in the normalized document text, or -1 when absent."""
    q = normalize_for_match(quote)
    if not q:
        return -1
    return normalize_for_match(document_text).find(q)


def document_text(raw: bytes, filename: str) -> str:
    name = filename.lower()
    if name.endswith((".htm", ".html")):
        return html_to_text(raw)
    if name.endswith(".xml"):
        return re.sub(r"<[^>]+>", " ", raw.decode("utf-8", "replace"))
    return raw.decode("utf-8", "replace")
