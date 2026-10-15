import struct

from bt.ingest.logos import domain, image_size


def test_image_size_png_and_ico():
    png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 128, 64) + b"\x08\x06\x00\x00\x00"
    assert image_size(png) == (128, 64)
    ico = b"\x00\x00\x01\x00" + struct.pack("<H", 2) + bytes([16, 16]) + b"\x00" * 14 + bytes([0, 0]) + b"\x00" * 14
    assert image_size(ico) == (256, 256)
    assert image_size(b"<svg") is None


def test_domain_strips_www_and_ir():
    assert domain("https://www.boeing.com/") == "boeing.com"
    assert domain("http://investors.lyft.com/x") == "lyft.com"


def test_proxy_domain_prefers_company_site():
    from bt.ingest.logos import proxy_domain
    raw = (b"vote at www.proxyvote.com or www.virtualshareholdermeeting.com/WRB2026; see www.wrberkley.com and "
           b"investors.wrberkley.com; www.wrberkley.com")
    assert proxy_domain(raw, "BERKLEY W R CORP", ["WRB"]) == "wrberkley.com"
    assert proxy_domain(b"www.proxyvote.com", "Acme Corp", ["ACME"]) is None


def test_looks_like_rejects_generic_word_matches():
    from bt.ingest.logos import looks_like
    assert not looks_like("dfinsolutions.com", "ADVANTAGE SOLUTIONS INC.", ["ADV"])
    assert looks_like("advantagesolutions.net", "ADVANTAGE SOLUTIONS INC.", ["ADV"])
    assert looks_like("maac.com", "Mid-America Apartment Communities, Inc.", ["MAA"])
    assert looks_like("mechanicsbank.com", "Mechanics Bancorp", [])
