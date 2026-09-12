'use strict';
const { faker } = require('@faker-js/faker');

function hashToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; 
  }
  return Math.abs(hash);
}

class FakeMap {
  constructor() {
    this.map = new Map();
  }

  _normalize(value) {
    return value.trim().toLowerCase();
  }

  _generate(type, value) {
    faker.seed(hashToSeed(`${type}::${this._normalize(value)}`));

    switch (type) {
      case 'NAME':
        return faker.person.fullName();
      case 'EMAIL':
        return faker.internet.email().toLowerCase();
      case 'PHONE':
        return faker.phone.number();
      case 'SSN':
        return faker.string.numeric(3) + '-' + faker.string.numeric(2) + '-' + faker.string.numeric(4);
      case 'CREDIT_CARD':
        return faker.finance.creditCardNumber();
      case 'IP_ADDRESS':
        return faker.internet.ipv4();
      case 'DATE_OF_BIRTH':
        return faker.date.birthdate().toISOString().slice(0, 10);
      case 'COMPANY':
        return faker.company.name();
      case 'ADDRESS':
        return `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}`;
      default:
        return '[REDACTED]';
    }
  }

  
   
  getFake(type, value) {
    const key = `${type}::${this._normalize(value)}`;
    if (!this.map.has(key)) {
      this.map.set(key, this._generate(type, value));
    }
    return this.map.get(key);
  }

  
  export() {
    const out = [];
    for (const [key, fake] of this.map.entries()) {
      const [type, value] = key.split('::');
      out.push({ type, real: value, fake });
    }
    return out;
  }
}

module.exports = { FakeMap, hashToSeed };