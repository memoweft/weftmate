import { createPublicKey, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';

/** Signed synthetic domain certificate. No external issuer, openssl or stored key. */
export function syntheticCertificate(expired, privateKey = generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey) {
  const der = (tag,...parts) => {const content=Buffer.concat(parts.map(part=>Buffer.isBuffer(part)?part:Buffer.from(part)));const length=content.length;return Buffer.concat([Buffer.from([tag]),length<128?Buffer.from([length]):length<256?Buffer.from([0x81,length]):Buffer.from([0x82,length>>8,length&255]),content]);};
  const seq = (...parts) => der(0x30,...parts), oid = hex => der(6,Buffer.from(hex,'hex'));
  const algorithm = seq(oid('2a8648ce3d040302'));
  const name = seq(der(0x31,seq(oid('550403'),der(0x0c,'r0-2.invalid'))));
  const dates = expired ? ['20200101000000Z','20200102000000Z'] : ['20200101000000Z','20400101000000Z'];
  const tbs = seq(der(2,Buffer.from([1])),algorithm,name,seq(...dates.map(date=>der(0x18,date))),name,createPublicKey(privateKey).export({type:'spki',format:'der'}));
  const certificate = seq(tbs,algorithm,der(3,Buffer.from([0]),sign('sha256',tbs,privateKey)));
  const pem = '-----BEGIN CERTIFICATE-----\n'+certificate.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';
  const parsed = new X509Certificate(pem); if (!parsed.checkHost('r0-2.invalid')) throw Error('Synthetic certificate invalid');
  return pem;
}
