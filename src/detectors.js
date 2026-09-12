'use strict';


const nlp = require('compromise');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{2,5}[\s-]?\d{3,5}[\s-]?\d{0,5}\b/g;

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

const CC_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;

const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

const DOB_CONTEXT_RE = /\b(?:date of birth|born on|born|d\.?o\.?b\.?)\b[:\s]*([A-Za-z0-9,./\- ]{6,20})/gi;

const COMPANY_SUFFIX_RE =
  /\b([A-Z][A-Za-z&.,'\- ]{1,60}\b(?:Private Limited|Pvt\.?\s?Ltd\.?|Limited|Ltd\.?|LLP|LLC|Inc\.?|Corp\.?|Corporation|Trust))\b/g;

const ADDRESS_CONTEXT_RE = /\b\d{3}\s?\d{3}\b/g;

function luhnCheck(digitsOnly) {
  let sum = 0;
  let alt = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let d = parseInt(digitsOnly[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function findAll(regex, text, type, filter) {
  const out = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(text)) !== null) {
    const value = m[1] !== undefined ? m[1] : m[0];
    if (filter && !filter(value, m)) continue;
    const groupIndex = m[1] !== undefined ? m.index + m[0].indexOf(m[1]) : m.index;
    out.push({ type, value, index: groupIndex, length: value.length });
  }
  return out;
}

function detectEmails(text) {
  return findAll(EMAIL_RE, text, 'EMAIL');
}

function detectPhones(text) {
  return findAll(PHONE_RE, text, 'PHONE', (value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 13;
  });
}

function detectSSNs(text) {
  return findAll(SSN_RE, text, 'SSN');
}

function detectCreditCards(text) {
  return findAll(CC_CANDIDATE_RE, text, 'CREDIT_CARD', (value) => {
    const digits = value.replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    return luhnCheck(digits);
  });
}

function detectIPs(text) {
  return findAll(IPV4_RE, text, 'IP_ADDRESS');
}

function detectDOBs(text) {
  return findAll(DOB_CONTEXT_RE, text, 'DATE_OF_BIRTH');
}

function detectCompanies(text) {
  return findAll(COMPANY_SUFFIX_RE, text, 'COMPANY');
}

function detectAddresses(text) {
  const out = [];
  let m;
  const re = new RegExp(ADDRESS_CONTEXT_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 60);
    const end = Math.min(text.length, m.index + m[0].length + 10);
    const value = text.slice(start, end).trim();
    out.push({ type: 'ADDRESS', value, index: start, length: end - start });
  }
  return out;
}

function detectNames(text) {
  const doc = nlp(text);
  const people = doc.people().out('array');
  const out = [];
  for (const name of people) {
    if (!name || name.trim().split(/\s+/).length < 2) continue;
    let searchFrom = 0;
    let idx;
    while ((idx = text.indexOf(name, searchFrom)) !== -1) {
      out.push({ type: 'NAME', value: name, index: idx, length: name.length });
      searchFrom = idx + name.length;
    }
  }
  return out;
}

function detectAll(text) {
  const all = [
    ...detectEmails(text),
    ...detectPhones(text),
    ...detectSSNs(text),
    ...detectCreditCards(text),
    ...detectIPs(text),
    ...detectDOBs(text),
    ...detectCompanies(text),
    ...detectNames(text),
    ...detectAddresses(text),
  ];

  all.sort((a, b) => a.index - b.index || b.length - a.length);

  const resolved = [];
  let lastEnd = -1;
  for (const match of all) {
    if (match.index >= lastEnd) {
      resolved.push(match);
      lastEnd = match.index + match.length;
    }
  }
  return resolved;
}

module.exports = {
  detectAll,
  detectEmails,
  detectPhones,
  detectSSNs,
  detectCreditCards,
  detectIPs,
  detectDOBs,
  detectCompanies,
  detectNames,
  detectAddresses,
  luhnCheck,
};