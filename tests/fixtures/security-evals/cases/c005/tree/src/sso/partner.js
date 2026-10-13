const { SAML } = require("@node-saml/node-saml")
const { partnerCert, partnerEntryPoint } = require("../config")

const saml = new SAML({
  idpCert: partnerCert,
  entryPoint: partnerEntryPoint,
  issuer: "app",
  audience: "app",
  wantAssertionsSigned: true,
  wantAuthnResponseSigned: true,
})

async function loginPartner(body) {
  const { profile } = await saml.validatePostResponseAsync(body)
  return { email: profile.nameID }
}

module.exports = { loginPartner }
