from datetime import date

from bt.ingest.form345 import parse, raw_xml_filename

FORM3 = b"""<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0206</schemaVersion>
  <documentType>3</documentType>
  <periodOfReport>2021-07-13</periodOfReport>
  <noSecuritiesOwned>1</noSecuritiesOwned>
  <issuer>
    <issuerCik>0001759509</issuerCik>
    <issuerName>Lyft, Inc.</issuerName>
    <issuerTradingSymbol>LYFT</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001234567</rptOwnerCik>
      <rptOwnerName>Doe Jane Q</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerAddress><rptOwnerStreet1>1 Example St</rptOwnerStreet1></reportingOwnerAddress>
    <reportingOwnerRelationship>
      <isDirector>true</isDirector>
      <isOfficer>0</isOfficer>
      <isTenPercentOwner>0</isTenPercentOwner>
      <isOther>0</isOther>
    </reportingOwnerRelationship>
  </reportingOwner>
</ownershipDocument>
"""


def test_parse_form3_director():
    [rel] = parse(FORM3)
    assert rel.form == "3"
    assert rel.issuer_cik == "0001759509" and rel.issuer_symbol == "LYFT"
    assert rel.period_of_report == date(2021, 7, 13)
    assert rel.owner_cik == "0001234567" and rel.owner_name == "Doe Jane Q"
    assert rel.is_director and not rel.is_officer and not rel.is_ten_percent_owner
    assert not hasattr(rel, "address")


def test_raw_xml_filename_strips_xsl_dir():
    assert raw_xml_filename("xslF345X05/wk-form3_1626.xml") == "wk-form3_1626.xml"
    assert raw_xml_filename("doc3.xml") == "doc3.xml"
