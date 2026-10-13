const { DOMParser } = require("@xmldom/xmldom")
const xpath = require("xpath")
const { SignedXml } = require("xml-crypto")
const { idpCert } = require("../config")

function login(samlResponseB64) {
  const xml = Buffer.from(samlResponseB64, "base64").toString()
  const doc = new DOMParser().parseFromString(xml)
  const signature = xpath.select("//*[local-name()='Signature']", doc)[0]
  const sig = new SignedXml({ publicCert: idpCert })
  sig.loadSignature(signature)
  if (!sig.checkSignature(xml)) throw new Error("bad signature")
  const nameId = xpath.select("string(//*[local-name()='NameID'])", doc)
  return { email: nameId }
}

module.exports = { login }
